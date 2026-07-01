import process from 'node:process';
import WebSocket from 'ws';
import { processDiscordEvent } from './intake.mjs';
import {
  buildAcknowledgementDiscordPayload,
  buildNoticeDiscordPayload,
  buildOutboundEventDiscordPayload,
  upgradeLegacyDiscordPayload,
} from './message-formatting.mjs';
import { normalizeTaskMessage } from '../../task-router/src/router.mjs';
import { buildExecutionPlan, buildExecutionStartedEvents, executeTask } from '../../task-router/src/executor.mjs';
import { processTranscriptionRequest } from '../../transcription-worker/src/worker.mjs';
import { recordOpsMetric } from '../../lib/metrics-store.mjs';
import {
  buildApprovalButtons,
  buildResolvedApprovalButtons,
  buildResolvedApprovalContent,
  normalizeInteractionAsApprovalMessage,
} from './approval-buttons.mjs';
import {
  buildGatewayConnectionUrl,
  createEmptySessionState,
  getReconnectPlan,
  hasResumableSession,
} from './gateway-state.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/';
const GATEWAY_INTENTS =
  (1 << 0) | // GUILDS
  (1 << 9) | // GUILD_MESSAGES
  (1 << 15); // MESSAGE_CONTENT

const DISCORD_INTERACTION_CALLBACK_CHANNEL_MESSAGE_WITH_SOURCE = 4;
const DISCORD_INTERACTION_CALLBACK_UPDATE_MESSAGE = 7;
const DISCORD_MESSAGE_FLAG_EPHEMERAL = 1 << 6;

function assertLiveRuntimeConfig(config) {
  const missing = [];

  if (!config.env.DISCORD_BOT_TOKEN) {
    missing.push('DISCORD_BOT_TOKEN');
  }

  if (!config.guildId) {
    missing.push('DISCORD_GUILD_ID');
  }

  for (const [key, channelId] of Object.entries({
    commands: config.channelIds.commands,
    parsedTasks: config.channelIds.parsedTasks,
    taskQueue: config.channelIds.taskQueue,
    approvals: config.channelIds.approvals,
    alerts: config.channelIds.alerts,
    dailySummary: config.channelIds.dailySummary,
    systemLogs: config.channelIds.systemLogs,
  })) {
    if (!channelId) {
      missing.push(`channelIds.${key}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Live Discord runtime is missing required config: ${missing.join(', ')}`);
  }
}

function buildAuthHeaders(token) {
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  };
}

async function sendDiscordApiRequest(token, path, body) {
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: buildAuthHeaders(token),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function sendDiscordInteractionCallback(interactionId, interactionToken, body) {
  const response = await fetch(`${DISCORD_API_BASE_URL}/interactions/${interactionId}/${interactionToken}/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord interaction callback failed (${response.status}): ${errorText}`);
  }
}

function truncateMessage(content) {
  const text = String(content || '').trim();
  if (text.length <= 2000) {
    return text;
  }

  return `${text.slice(0, 1997)}...`;
}

function buildVoiceTranscriptEvent(message, transcriptionResult) {
  return {
    channelKey: 'parsedTasks',
    type: 'voice_transcript',
    body: `Transcript from ${message.author.displayName || message.author.username || message.author.id}: ${transcriptionResult.transcript}`,
    metadata: {
      sourceMessageId: message.messageId || '',
      confidence: transcriptionResult.confidence,
      language: transcriptionResult.language || '',
      segmentCount: transcriptionResult.segmentCount || 0,
    },
  };
}

function buildTranscribedTaskEvents(task) {
  const outboundEvents = [
    {
      channelKey: 'systemLogs',
      type: 'accepted_transcribed_command',
      body: `Accepted transcribed ${task.task_id} from ${task.submitted_by}.`,
      metadata: { taskId: task.task_id },
    },
    {
      channelKey: 'parsedTasks',
      type: 'parsed_task_preview',
      body: `Parsed ${task.task_id} for ${task.target_agent}: ${task.summary}`,
      metadata: { task },
    },
    {
      channelKey: 'taskQueue',
      type: 'task_queue_update',
      body: `${task.task_id} is ${task.status} with priority ${task.priority}.`,
      metadata: { taskId: task.task_id, status: task.status, priority: task.priority },
    },
  ];

  if (task.approval_required) {
    outboundEvents.push({
      channelKey: 'approvals',
      type: 'approval_request',
      body: `Approval needed for ${task.task_id}: ${task.summary}`,
      metadata: {
        taskId: task.task_id,
        approvalReason: task.approval_reason,
        responsePattern: ['approve TASK-123', 'reject TASK-123 because <reason>'],
      },
    });
  }

  return outboundEvents;
}

function channelMention(channelId, fallbackLabel) {
  return channelId ? `<#${channelId}>` : fallbackLabel;
}

function buildSourceAcknowledgement(result, config) {
  if (!result?.accepted) {
    return '';
  }

  if (result.route === 'command') {
    const tasks = Array.isArray(result.normalizedTasks) && result.normalizedTasks.length > 0
      ? result.normalizedTasks
      : result.normalizedTask?.task_id
        ? [result.normalizedTask]
        : [];
    const parsedTasksChannel = channelMention(config?.channelIds?.parsedTasks, '#parsed-tasks');
    const approvalsChannel = channelMention(config?.channelIds?.approvals, '#approvals');
    const runtimeSummary = result.commandRuntimeSummary || {};

    if (tasks.length > 1) {
      if (runtimeSummary.awaitingApprovalCount > 0) {
        return `Accepted ${tasks.length} tasks. Parsed tasks posted to ${parsedTasksChannel}. Approval requests posted to ${approvalsChannel}.`;
      }

      return `Accepted ${tasks.length} tasks. Parsed tasks posted to ${parsedTasksChannel}.`;
    }

    if (tasks[0]?.task_id) {
      if (tasks[0].approval_required) {
        return `Accepted ${tasks[0].task_id}. Parsed task posted to ${parsedTasksChannel}. Approval request posted to ${approvalsChannel}.`;
      }

      return `Accepted ${tasks[0].task_id}. Parsed task posted to ${parsedTasksChannel}.`;
    }
  }

  if (result.route === 'approval' && result.decision?.taskId) {
    return `Registered ${result.decision.decision} for ${result.decision.taskId}.`;
  }

  if (result.route === 'voice') {
    return 'Voice note accepted. Transcription handoff prepared.';
  }

  return '';
}

function normalizeDiscordMessage(message) {
  return {
    guildId: message.guild_id || '',
    channelId: message.channel_id || '',
    messageId: message.id || '',
    content: message.content || '',
    attachments: Array.isArray(message.attachments)
      ? message.attachments.map((attachment) => ({
          id: attachment.id || '',
          url: attachment.url || '',
          proxyUrl: attachment.proxy_url || '',
          filename: attachment.filename || '',
          contentType: attachment.content_type || '',
          size: attachment.size || 0,
        }))
      : [],
    author: {
      id: message.author?.id || '',
      username: message.author?.username || '',
      displayName: message.member?.nick || message.author?.global_name || message.author?.username || '',
      roleIds: Array.isArray(message.member?.roles) ? message.member.roles : [],
      isOperator: false,
    },
  };
}

async function postChannelMessage(token, channelId, payloadOrContent) {
  if (!channelId || !payloadOrContent) {
    return null;
  }

  const body = upgradeLegacyDiscordPayload(
    typeof payloadOrContent === 'string'
      ? { content: payloadOrContent }
      : payloadOrContent
  );

  return sendDiscordApiRequest(token, `/channels/${channelId}/messages`, body);
}

async function fanOutOutboundEvents(token, config, outboundEvents = []) {
  for (const outboundEvent of outboundEvents) {
    const targetChannelId = config.channelIds[outboundEvent.channelKey];
    if (!targetChannelId) {
      process.stderr.write(`No Discord channel mapped for outbound key '${outboundEvent.channelKey}'.\n`);
      continue;
    }

    if (outboundEvent.type === 'approval_request') {
      outboundEvent.metadata = {
        ...outboundEvent.metadata,
        approverMentions: buildApprovalMentions(config),
        approverUserIds: config.operatorUserIds || [],
        approverRoleIds: config.operatorRoleId ? [config.operatorRoleId] : [],
      };
    }

    const body = upgradeLegacyDiscordPayload(buildOutboundEventDiscordPayload(outboundEvent));

    if (outboundEvent.type === 'approval_request' && outboundEvent.metadata?.taskId) {
      body.components = buildApprovalButtons(outboundEvent.metadata.taskId);
    }

    await sendDiscordApiRequest(token, `/channels/${targetChannelId}/messages`, body);
  }
}

function buildApprovalMentions(config) {
  if (Array.isArray(config.operatorUserIds) && config.operatorUserIds.length > 0) {
    return config.operatorUserIds.map((userId) => `<@${userId}>`).join(' ');
  }

  if (config.operatorRoleId) {
    return `<@&${config.operatorRoleId}>`;
  }

  return '';
}

function createGatewayConnection() {
  return new WebSocket(DISCORD_GATEWAY_URL);
}

function computeElapsedMs(timestamp) {
  if (!timestamp) {
    return 0;
  }

  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Date.now() - parsed);
}

function estimateTextTokens(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

export async function runLiveDiscordBot(config) {
  assertLiveRuntimeConfig(config);

  const token = config.env.DISCORD_BOT_TOKEN;
  const resolvedApprovals = new Map();
  const pendingTasks = new Map();
  const executionQueue = [];
  let sessionState = createEmptySessionState();
  let sequence = null;
  let heartbeatTimer = null;
  let initialHeartbeatTimer = null;
  let activeSocket = null;
  let shuttingDown = false;
  let reconnectTimer = null;
  let lastHeartbeatAck = true;
  let resumeNextConnection = false;
  let activeExecutionTaskId = '';
  let executionDrainPromise = null;

  const clearHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    if (initialHeartbeatTimer) {
      clearTimeout(initialHeartbeatTimer);
      initialHeartbeatTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (shuttingDown || reconnectTimer) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 5000);
  };

  const sendGatewayPayload = (payload) => {
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    activeSocket.send(JSON.stringify(payload));
  };

  const sendHeartbeat = () => {
    if (!lastHeartbeatAck) {
      process.stderr.write('Discord heartbeat ACK timeout. Terminating socket and attempting resume.\n');
      resumeNextConnection = hasResumableSession(sessionState, sequence);
      activeSocket?.terminate();
      return;
    }

    lastHeartbeatAck = false;
    sendGatewayPayload({ op: 1, d: sequence });
  };

  const identify = () => {
    process.stdout.write('Discord gateway identify requested.\n');
    sendGatewayPayload({
      op: 2,
      d: {
        token,
        intents: GATEWAY_INTENTS,
        properties: {
          os: process.platform,
          browser: 'ruflo',
          device: 'ruflo',
        },
      },
    });
  };

  const resume = () => {
    process.stdout.write('Discord gateway resume requested.\n');
    sendGatewayPayload({
      op: 6,
      d: {
        token,
        session_id: sessionState.sessionId,
        seq: sequence,
      },
    });
  };

  const connect = () => {
    const gatewayUrl = resumeNextConnection && sessionState.resumeGatewayUrl
      ? buildGatewayConnectionUrl(sessionState.resumeGatewayUrl)
      : buildGatewayConnectionUrl(DISCORD_GATEWAY_URL);

    activeSocket = new WebSocket(gatewayUrl);

    activeSocket.on('open', () => {
      process.stdout.write(`Discord gateway connected (${resumeNextConnection ? 'resume' : 'identify'} mode).\n`);
    });

    activeSocket.on('message', async (rawMessage) => {
      try {
        const payload = JSON.parse(rawMessage.toString());

        if (payload.s !== null && payload.s !== undefined) {
          sequence = payload.s;
        }

        if (payload.op === 10) {
          clearHeartbeat();
          lastHeartbeatAck = true;
          const heartbeatInterval = payload.d.heartbeat_interval;
          const initialDelay = Math.floor(heartbeatInterval * Math.random());
          heartbeatTimer = setInterval(sendHeartbeat, heartbeatInterval);
          initialHeartbeatTimer = setTimeout(sendHeartbeat, initialDelay);

          if (resumeNextConnection && hasResumableSession(sessionState, sequence)) {
            resume();
          } else {
            resumeNextConnection = false;
            identify();
          }
          return;
        }

        if (payload.op === 11) {
          lastHeartbeatAck = true;
          return;
        }

        if (payload.op === 1) {
          sendHeartbeat();
          return;
        }

        if (payload.op === 7) {
          process.stderr.write('Discord gateway requested reconnect.\n');
          resumeNextConnection = hasResumableSession(sessionState, sequence);
          activeSocket?.close();
          return;
        }

        if (payload.op === 9) {
          const resumable = payload.d === true;
          process.stderr.write(`Discord gateway invalid session (resumable=${resumable}).\n`);
          resumeNextConnection = resumable && hasResumableSession(sessionState, sequence);
          if (!resumable) {
            sessionState = createEmptySessionState();
            sequence = null;
          }
          activeSocket?.close();
          return;
        }

        if (payload.op !== 0) {
          return;
        }

        if (payload.t === 'READY') {
          sessionState = {
            sessionId: payload.d.session_id || '',
            resumeGatewayUrl: payload.d.resume_gateway_url || '',
          };
          resumeNextConnection = false;
          process.stdout.write(`Discord bot ready as ${payload.d.user?.username || 'bot'}.\n`);
          safeRecordMetric('discord_runtime_ready', {
            user: payload.d.user?.username || 'bot',
            sessionId: payload.d.session_id || '',
          });
          if (config.channelIds.systemLogs) {
            await postChannelMessage(token, config.channelIds.systemLogs, buildNoticeDiscordPayload({
              title: 'System Log',
              description: 'Discord bot runtime connected on the Mac.',
            }));
          }
          return;
        }

        if (payload.t === 'RESUMED') {
          resumeNextConnection = false;
          process.stdout.write('Discord gateway resumed previous session.\n');
          return;
        }

        if (payload.t === 'INTERACTION_CREATE') {
          const approvalMessage = normalizeInteractionAsApprovalMessage(payload.d);
          if (!approvalMessage) {
            await sendDiscordInteractionCallback(payload.d.id, payload.d.token, {
              type: DISCORD_INTERACTION_CALLBACK_CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: 'This button is not supported by the current bot runtime.',
                flags: DISCORD_MESSAGE_FLAG_EPHEMERAL,
              },
            });
            return;
          }

          const result = processDiscordEvent(approvalMessage, config);
          const actorName = approvalMessage.author.displayName || approvalMessage.author.username || approvalMessage.author.id || 'operator';

          if (result.route === 'approval' && result.decision?.taskId) {
            const existingResolution = resolvedApprovals.get(result.decision.taskId);
            if (existingResolution) {
              await sendDiscordInteractionCallback(payload.d.id, payload.d.token, {
                type: DISCORD_INTERACTION_CALLBACK_CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                  content: truncateMessage(
                    `${result.decision.taskId} was already resolved as ${existingResolution.decision.toUpperCase()} by ${existingResolution.actor}.`
                  ),
                  flags: DISCORD_MESSAGE_FLAG_EPHEMERAL,
                },
              });
              return;
            }
          }

          const acknowledgement = result.accepted
            ? buildSourceAcknowledgement(result)
            : result.reason || 'Approval action was rejected.';

          if (result.accepted && result.route === 'approval' && result.decision?.taskId) {
            resolvedApprovals.set(result.decision.taskId, {
              decision: result.decision.decision,
              actor: actorName,
            });
            const pendingTask = pendingTasks.get(result.decision.taskId);
            const approvalWaitMs = computeElapsedMs(pendingTask?.submitted_at);
            safeRecordMetric('approval_button_resolution', {
              taskId: result.decision.taskId,
              decision: result.decision.decision,
              actor: actorName,
              actorId: approvalMessage.author?.id || '',
              approvalWaitMs,
            });
            safeRecordMetric('approval_decision_received', {
              taskId: result.decision.taskId,
              decision: result.decision.decision,
              actor: actorName,
              actorId: approvalMessage.author?.id || '',
              source: 'button',
              approvalWaitMs,
            });

            await sendDiscordInteractionCallback(payload.d.id, payload.d.token, {
              type: DISCORD_INTERACTION_CALLBACK_UPDATE_MESSAGE,
              data: {
                content: truncateMessage(
                  buildResolvedApprovalContent(payload.d.message?.content, result.decision.decision, actorName)
                ),
                components: buildResolvedApprovalButtons(result.decision.taskId, result.decision.decision),
              },
            });
          } else {
            await sendDiscordInteractionCallback(payload.d.id, payload.d.token, {
              type: DISCORD_INTERACTION_CALLBACK_CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: truncateMessage(acknowledgement || 'Registered interaction.'),
                flags: DISCORD_MESSAGE_FLAG_EPHEMERAL,
              },
            });
          }

          await fanOutOutboundEvents(token, config, result.outboundEvents);
          if (result.accepted && result.route === 'approval' && result.decision?.decision) {
            await resolvePendingTask(result.decision);
          }
          return;
        }

        if (payload.t !== 'MESSAGE_CREATE') {
          return;
        }

        if (payload.d.author?.bot) {
          return;
        }

        const message = normalizeDiscordMessage(payload.d);
        const receivedAtMs = Date.now();
        const result = processDiscordEvent(message, config);

        if (!result.accepted) {
          safeRecordMetric('discord_event_rejected', {
            route: result.route,
            reason: result.reason || '',
            channelId: message.channelId || '',
            authorId: message.author?.id || '',
            username: message.author?.username || '',
            displayName: message.author?.displayName || '',
            mention: message.author?.id ? `<@${message.author.id}>` : '',
          });
        }

        if (result.route === 'approval' && result.decision?.taskId) {
          const existingResolution = resolvedApprovals.get(result.decision.taskId);
          if (existingResolution) {
            await postChannelMessage(
              token,
              message.channelId,
              truncateMessage(`${result.decision.taskId} was already resolved as ${existingResolution.decision.toUpperCase()} by ${existingResolution.actor}.`)
            );
            return;
          }

          if (result.accepted) {
            const actorName = message.author.displayName || message.author.username || message.author.id || 'operator';
            resolvedApprovals.set(result.decision.taskId, {
              decision: result.decision.decision,
              actor: actorName,
            });
            const pendingTask = pendingTasks.get(result.decision.taskId);
            const approvalWaitMs = computeElapsedMs(pendingTask?.submitted_at);
            safeRecordMetric('approval_text_resolution', {
              taskId: result.decision.taskId,
              decision: result.decision.decision,
              actor: actorName,
              actorId: message.author?.id || '',
              approvalWaitMs,
            });
            safeRecordMetric('approval_decision_received', {
              taskId: result.decision.taskId,
              decision: result.decision.decision,
              actor: actorName,
              actorId: message.author?.id || '',
              source: 'text',
              approvalWaitMs,
            });
          }
        }

        if (result.route === 'command') {
          const tasks = Array.isArray(result.normalizedTasks) && result.normalizedTasks.length > 0
            ? result.normalizedTasks
            : result.normalizedTask?.task_id
              ? [result.normalizedTask]
              : [];
          const queueBacklogBefore = (activeExecutionTaskId ? 1 : 0) + executionQueue.length;
          const executionStates = [];

          for (const task of tasks) {
            safeRecordMetric('command_accepted', {
              taskId: task.task_id,
              domain: task.domain,
              priority: task.priority,
              approvalRequired: task.approval_required,
              targetAgent: task.target_agent,
              authorId: message.author?.id || '',
              submittedBy: task.submitted_by,
              sourceType: task.source_type,
              estimatedInputTokens: estimateTextTokens(task.full_text),
              estimatedCostUsd: 0,
            });
            recordTaskStateChange(task, task.status);
            rememberPendingTaskIfNeeded(task);

            if (task.approval_required) {
              executionStates.push({
                taskId: task.task_id,
                state: 'awaiting_approval',
                action: '',
                queuePosition: 0,
                blockedByTaskId: '',
              });
              continue;
            }

            executionStates.push(queueExecutableTask(task));
          }

          result.commandRuntimeSummary = {
            taskCount: tasks.length,
            queueBacklogBefore,
            activeExecutionTaskId,
            executionStates,
            awaitingApprovalCount: executionStates.filter((item) => item.state === 'awaiting_approval').length,
            queuedCount: executionStates.filter((item) => item.state === 'queued').length,
            startingCount: executionStates.filter((item) => item.state === 'starting').length,
            noExecutorCount: executionStates.filter((item) => item.state === 'no_executor').length,
          };
        }

        const acknowledgement = buildSourceAcknowledgement(result, config);

        if (acknowledgement) {
          await postChannelMessage(token, message.channelId, buildAcknowledgementDiscordPayload(result, acknowledgement));
          safeRecordMetric('source_acknowledged', {
            route: result.route,
            channelId: message.channelId || '',
            taskId: result.normalizedTask?.task_id || result.decision?.taskId || '',
            latencyMs: Math.max(0, Date.now() - receivedAtMs),
            sourceType: result.normalizedTask?.source_type || '',
          });
        }

        await fanOutOutboundEvents(token, config, result.outboundEvents);

        if (result.route === 'command') {
          ensureExecutionDrain();
        }

        if (result.route === 'approval' && result.accepted && result.decision?.decision) {
          await resolvePendingTask(result.decision);
        }

        if (result.route === 'voice' && result.transcriptionRequest) {
          safeRecordMetric('voice_note_received', {
            sourceMessageId: result.transcriptionRequest.sourceMessageId || '',
            submittedBy: result.transcriptionRequest.submittedBy || '',
            attachmentCount: Array.isArray(result.transcriptionRequest.attachments)
              ? result.transcriptionRequest.attachments.length
              : 0,
          });

          const transcriptionStartedAt = Date.now();
          const transcriptionResult = await processTranscriptionRequest(result.transcriptionRequest, config);

          if (transcriptionResult.status !== 'completed') {
            safeRecordMetric('voice_transcription_failed', {
              status: transcriptionResult.status,
              sourceMessageId: message.messageId || '',
              warnings: transcriptionResult.warnings || [],
              latencyMs: Date.now() - transcriptionStartedAt,
            });
            await fanOutOutboundEvents(token, config, [
              {
                channelKey: 'alerts',
                type: 'voice_transcription_failed',
                body: `Voice transcription ${transcriptionResult.status} for ${message.author.displayName || message.author.username || message.author.id}.`,
                metadata: {
                  sourceMessageId: message.messageId || '',
                  warnings: transcriptionResult.warnings || [],
                },
              },
            ]);
            return;
          }

          safeRecordMetric('voice_transcription_completed', {
            sourceMessageId: message.messageId || '',
            confidence: transcriptionResult.confidence,
            language: transcriptionResult.language || '',
            segmentCount: transcriptionResult.segmentCount || 0,
            latencyMs: Date.now() - transcriptionStartedAt,
          });

          await fanOutOutboundEvents(token, config, [
            buildVoiceTranscriptEvent(message, transcriptionResult),
          ]);

          const transcribedCommand = normalizeTaskMessage({
            guildId: message.guildId,
            channelKey: 'commands',
            channelId: config.channelIds.commands,
            content: transcriptionResult.transcript,
            author: message.author,
          }, config);

          await fanOutOutboundEvents(token, config, buildTranscribedTaskEvents(transcribedCommand.task));
          safeRecordMetric('transcribed_command_accepted', {
            taskId: transcribedCommand.task.task_id,
            domain: transcribedCommand.task.domain,
            priority: transcribedCommand.task.priority,
            approvalRequired: transcribedCommand.task.approval_required,
            targetAgent: transcribedCommand.task.target_agent,
            authorId: message.author?.id || '',
            submittedBy: transcribedCommand.task.submitted_by,
            sourceType: transcribedCommand.task.source_type,
            estimatedInputTokens: estimateTextTokens(transcribedCommand.task.full_text),
            estimatedCostUsd: 0,
          });
          recordTaskStateChange(transcribedCommand.task, transcribedCommand.task.status);
          rememberPendingTaskIfNeeded(transcribedCommand.task);
          if (!transcribedCommand.task.approval_required) {
            queueExecutableTask(transcribedCommand.task);
            ensureExecutionDrain();
          }
        }
      } catch (error) {
        process.stderr.write(`Discord bot runtime error: ${error.message}\n`);
        try {
          await postChannelMessage(
            token,
            config.channelIds.alerts,
            buildNoticeDiscordPayload({
              title: '⚠️ Runtime Error',
              description: `Discord bot runtime error: ${error.message}`,
              color: 0xED4245,
              footerText: 'Ruflo runtime',
            })
          );
        } catch (postError) {
          process.stderr.write(`Could not post alert: ${postError.message}\n`);
        }
      }
    });

    activeSocket.on('close', (code, reasonBuffer) => {
      clearHeartbeat();
      const reason = reasonBuffer?.toString() || 'no reason';
      process.stderr.write(`Discord gateway closed (${code}): ${reason}\n`);
      const reconnectPlan = getReconnectPlan({
        closeCode: code,
        shuttingDown,
        sessionState,
        sequence,
      });
      resumeNextConnection = reconnectPlan.shouldResume;
      if (reconnectPlan.shouldReconnect) {
        scheduleReconnect();
      } else {
        process.stderr.write('Discord gateway close code is not reconnectable; leaving socket closed.\n');
      }
    });

    activeSocket.on('error', (error) => {
      process.stderr.write(`Discord gateway error: ${error.message}\n`);
    });
  };

  const shutdown = () => {
    shuttingDown = true;
    clearHeartbeat();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    activeSocket?.close(1000, 'shutdown');
  };

  const safeRecordMetric = (eventType, payload = {}) => {
    try {
      recordOpsMetric(config, eventType, payload);
    } catch (error) {
      process.stderr.write(`Could not record metrics event '${eventType}': ${error.message}\n`);
    }
  };

  const recordTaskStateChange = (task, status, extra = {}) => {
    if (!task?.task_id) {
      return;
    }

    safeRecordMetric('task_state_changed', {
      taskId: task.task_id,
      status,
      domain: task.domain || '',
      priority: task.priority || '',
      approvalRequired: Boolean(task.approval_required),
      targetAgent: task.target_agent || '',
      sourceType: task.source_type || '',
      submittedBy: task.submitted_by || '',
      ...extra,
    });
  };

  const queueExecutableTask = (task) => {
    const executionPlan = buildExecutionPlan(task);
    if (!executionPlan) {
      return {
        taskId: task.task_id,
        state: 'no_executor',
        action: '',
        queuePosition: 0,
        blockedByTaskId: '',
      };
    }

    const blockedByTaskId = activeExecutionTaskId || executionQueue[0]?.task.task_id || '';
    const queuePosition = (activeExecutionTaskId ? 1 : 0) + executionQueue.length;
    const state = queuePosition === 0 ? 'starting' : 'queued';

    executionQueue.push({ task, executionPlan });

    if (!executionDrainPromise) {
      executionDrainPromise = drainExecutionQueue();
    }

    return {
      taskId: task.task_id,
      state,
      action: executionPlan.action,
      queuePosition,
      blockedByTaskId,
    };
  };

  const ensureExecutionDrain = () => {
    if (!executionDrainPromise && executionQueue.length > 0) {
      executionDrainPromise = drainExecutionQueue();
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const runExecutableTask = async (task, executionPlan) => {
    activeExecutionTaskId = task.task_id;
    await fanOutOutboundEvents(token, config, buildExecutionStartedEvents(task, executionPlan));
    recordTaskStateChange(task, 'running', {
      action: executionPlan.action,
      queueDwellMs: computeElapsedMs(task.submitted_at),
    });
    safeRecordMetric('task_execution_started', {
      taskId: task.task_id,
      action: executionPlan.action,
      domain: task.domain || '',
      targetAgent: task.target_agent || '',
      queueDwellMs: computeElapsedMs(task.submitted_at),
    });
    const executionStartedAt = Date.now();
    const execution = await executeTask(task, config);
    const executionDurationMs = Date.now() - executionStartedAt;
    safeRecordMetric('task_execution_finished', {
      taskId: task.task_id,
      action: execution.executionPlan?.action || executionPlan.action,
      outcome: execution.outcome || '',
      state: execution.executionResult?.report?.state || '',
      error: execution.error?.message || '',
      durationMs: executionDurationMs,
    });
    recordTaskStateChange(task, execution.outcome === 'completed' ? 'completed' : 'failed', {
      action: execution.executionPlan?.action || executionPlan.action,
      state: execution.executionResult?.report?.state || '',
      durationMs: executionDurationMs,
    });
    await fanOutOutboundEvents(token, config, execution.outboundEvents);
  };

  const drainExecutionQueue = async () => {
    try {
      while (executionQueue.length > 0) {
        const next = executionQueue.shift();
        if (!next) {
          continue;
        }

        await runExecutableTask(next.task, next.executionPlan);
        activeExecutionTaskId = '';
      }
    } finally {
      activeExecutionTaskId = '';
      executionDrainPromise = null;
    }
  };

  const rememberPendingTaskIfNeeded = (task) => {
    if (task?.approval_required && task?.task_id) {
      pendingTasks.set(task.task_id, task);
    }
  };

  const resolvePendingTask = async (decision) => {
    if (!decision?.taskId) {
      return;
    }

    const pendingTask = pendingTasks.get(decision.taskId);
    if (!pendingTask) {
      return;
    }

    pendingTasks.delete(decision.taskId);
    const approvalWaitMs = computeElapsedMs(pendingTask?.submitted_at);

    if (decision.decision === 'reject') {
      recordTaskStateChange(pendingTask, 'rejected', {
        approvalWaitMs,
      });
      await fanOutOutboundEvents(token, config, [
        {
          channelKey: 'taskQueue',
          type: 'task_queue_update',
          body: `${decision.taskId} was rejected and will not execute.`,
          metadata: {
            taskId: decision.taskId,
            status: 'rejected',
          },
        },
      ]);
      return;
    }

    recordTaskStateChange(pendingTask, 'approved', {
      approvalWaitMs,
    });
    queueExecutableTask(pendingTask);
    ensureExecutionDrain();
  };

  connect();

  await new Promise(() => {});
}
