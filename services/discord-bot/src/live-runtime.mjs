import process from 'node:process';
import WebSocket from 'ws';
import { processDiscordEvent } from './intake.mjs';
import { normalizeTaskMessage } from '../../task-router/src/router.mjs';
import { buildExecutionPlan, buildExecutionStartedEvents, executeTask } from '../../task-router/src/executor.mjs';
import { processTranscriptionRequest } from '../../transcription-worker/src/worker.mjs';
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

const MAX_DISCORD_MESSAGE_LENGTH = 2000;
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
  if (text.length <= MAX_DISCORD_MESSAGE_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_DISCORD_MESSAGE_LENGTH - 3)}...`;
}

function formatMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Object.keys(metadata).length === 0) {
    return '';
  }

  const text = JSON.stringify(metadata, null, 2);
  if (text.length > 1200) {
    return `\n\`\`\`json\n${text.slice(0, 1150)}\n...\n\`\`\``;
  }

  return `\n\`\`\`json\n${text}\n\`\`\``;
}

function formatOutboundEventMessage(outboundEvent) {
  const body = truncateMessage(outboundEvent.body || outboundEvent.type || 'Event received.');
  const metadata = formatMetadata(outboundEvent.metadata);
  return truncateMessage(`${body}${metadata}`);
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

function buildSourceAcknowledgement(result) {
  if (!result?.accepted) {
    return '';
  }

  if (result.route === 'command' && result.normalizedTask?.task_id) {
    return `Accepted ${result.normalizedTask.task_id}. Parsed task posted to #parsed-tasks.`;
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

async function postChannelMessage(token, channelId, content) {
  if (!channelId || !content) {
    return null;
  }

  return sendDiscordApiRequest(token, `/channels/${channelId}/messages`, { content });
}

async function fanOutOutboundEvents(token, config, outboundEvents = []) {
  for (const outboundEvent of outboundEvents) {
    const targetChannelId = config.channelIds[outboundEvent.channelKey];
    if (!targetChannelId) {
      process.stderr.write(`No Discord channel mapped for outbound key '${outboundEvent.channelKey}'.\n`);
      continue;
    }

    const content = formatOutboundEventMessage(outboundEvent);
    const body = { content };

    if (outboundEvent.type === 'approval_request' && outboundEvent.metadata?.taskId) {
      body.components = buildApprovalButtons(outboundEvent.metadata.taskId);
    }

    await sendDiscordApiRequest(token, `/channels/${targetChannelId}/messages`, body);
  }
}

function createGatewayConnection() {
  return new WebSocket(DISCORD_GATEWAY_URL);
}

export async function runLiveDiscordBot(config) {
  assertLiveRuntimeConfig(config);

  const token = config.env.DISCORD_BOT_TOKEN;
  const resolvedApprovals = new Map();
  const pendingTasks = new Map();
  let sessionState = createEmptySessionState();
  let sequence = null;
  let heartbeatTimer = null;
  let initialHeartbeatTimer = null;
  let activeSocket = null;
  let shuttingDown = false;
  let reconnectTimer = null;
  let lastHeartbeatAck = true;
  let resumeNextConnection = false;

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
          if (config.channelIds.systemLogs) {
            await postChannelMessage(token, config.channelIds.systemLogs, 'Discord bot runtime connected on the Mac.');
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
        const result = processDiscordEvent(message, config);
        const acknowledgement = buildSourceAcknowledgement(result);

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
          }
        }

        if (acknowledgement) {
          await postChannelMessage(token, message.channelId, acknowledgement);
        }

        await fanOutOutboundEvents(token, config, result.outboundEvents);

        if (result.route === 'command' && result.normalizedTask) {
          rememberPendingTaskIfNeeded(result.normalizedTask);
          if (!result.normalizedTask.approval_required) {
            await maybeExecuteNormalizedTask(result.normalizedTask);
          }
        }

        if (result.route === 'approval' && result.accepted && result.decision?.decision) {
          await resolvePendingTask(result.decision);
        }

        if (result.route === 'voice' && result.transcriptionRequest) {
          const transcriptionResult = await processTranscriptionRequest(result.transcriptionRequest, config);

          if (transcriptionResult.status !== 'completed') {
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
          rememberPendingTaskIfNeeded(transcribedCommand.task);
          if (!transcribedCommand.task.approval_required) {
            await maybeExecuteNormalizedTask(transcribedCommand.task);
          }
        }
      } catch (error) {
        process.stderr.write(`Discord bot runtime error: ${error.message}\n`);
        try {
          await postChannelMessage(
            token,
            config.channelIds.alerts,
            truncateMessage(`Discord bot runtime error: ${error.message}`)
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

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const maybeExecuteNormalizedTask = async (task) => {
    const executionPlan = buildExecutionPlan(task);
    if (!executionPlan) {
      return;
    }

    await fanOutOutboundEvents(token, config, buildExecutionStartedEvents(task, executionPlan));
    const execution = await executeTask(task, config);
    await fanOutOutboundEvents(token, config, execution.outboundEvents);
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

    if (decision.decision === 'reject') {
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

    await maybeExecuteNormalizedTask(pendingTask);
  };

  connect();

  await new Promise(() => {});
}
