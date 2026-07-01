import { normalizeTaskMessage, parseApprovalResponse } from '../../task-router/src/router.mjs';

const AUDIO_CONTENT_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
]);

function resolveChannelKey(message, config) {
  if (message.channelKey) {
    return message.channelKey;
  }

  const match = Object.entries(config.channelIds).find(([, channelId]) => channelId && channelId === message.channelId);
  return match ? match[0] : '';
}

function isAuthorizedOperator(message, config) {
  if (message.author?.isOperator === true) {
    return true;
  }

  if (message.author?.id && config.operatorUserIds.includes(message.author.id)) {
    return true;
  }

  if (config.operatorRoleId && Array.isArray(message.author?.roleIds)) {
    return message.author.roleIds.includes(config.operatorRoleId);
  }

  return false;
}

function event(channelKey, type, body, metadata = {}) {
  return {
    channelKey,
    type,
    body,
    metadata,
  };
}

function buildAuthorIdentity(message) {
  const authorId = message.author?.id || '';
  const displayName = message.author?.displayName || '';
  const username = message.author?.username || '';

  return {
    authorId,
    displayName,
    username,
    mention: authorId ? `<@${authorId}>` : '',
  };
}

function buildRejectedOperatorEvent(message, reason) {
  const author = buildAuthorIdentity(message);
  const humanLabel = [author.displayName, author.username].filter(Boolean).join(' / ') || 'unknown user';
  const body = author.authorId
    ? `${reason} ${author.mention} (${humanLabel})`
    : `${reason} (${humanLabel})`;

  return event('alerts', 'rejected_message', body, author);
}

function buildParsedTaskEvent(task) {
  return event(
    'parsedTasks',
    'parsed_task_preview',
    `Parsed ${task.task_id} for ${task.target_agent}: ${task.summary}`,
    { task }
  );
}

function buildQueueEvent(task) {
  return event(
    'taskQueue',
    'task_queue_update',
    `${task.task_id} is ${task.status} with priority ${task.priority}.`,
    { taskId: task.task_id, status: task.status, priority: task.priority }
  );
}

function buildApprovalEvent(task) {
  return event(
    'approvals',
    'approval_request',
    `Approval needed for ${task.task_id}: ${task.summary}`,
    {
      taskId: task.task_id,
      summary: task.summary,
      targetAgent: task.target_agent,
      domain: task.domain,
      priority: task.priority,
      submittedBy: task.submitted_by,
      approvalReason: task.approval_reason,
      responsePattern: ['approve TASK-123', 'reject TASK-123 because <reason>'],
    }
  );
}

function validateMessage(message, config) {
  if (config.guildId && message.guildId && config.guildId !== message.guildId) {
    return { accepted: false, reason: 'Message came from an unexpected guild.' };
  }

  if (!isAuthorizedOperator(message, config)) {
    return { accepted: false, reason: 'Message sender is not an approved operator.' };
  }

  return { accepted: true, reason: '' };
}

function hasAudioAttachment(message) {
  return (message.attachments || []).some((attachment) => {
    if (!attachment.contentType) {
      return false;
    }

    return AUDIO_CONTENT_TYPES.has(attachment.contentType.toLowerCase());
  });
}

export function processDiscordEvent(message, config) {
  const validation = validateMessage(message, config);
  const channelKey = resolveChannelKey(message, config);

  if (!validation.accepted) {
    return {
      accepted: false,
      route: 'rejected',
      reason: validation.reason,
      outboundEvents: [buildRejectedOperatorEvent(message, validation.reason)],
    };
  }

  if (!channelKey) {
    return {
      accepted: false,
      route: 'rejected',
      reason: 'Message channel is not mapped to the phase-1 bot surface.',
      outboundEvents: [event('alerts', 'unexpected_channel', 'Message channel is not mapped.', { channelId: message.channelId || '' })],
    };
  }

  if (channelKey === 'commands') {
    const { task, writeBackCandidates } = normalizeTaskMessage({ ...message, channelKey }, config);
    const outboundEvents = [
      event('systemLogs', 'accepted_command', `Accepted ${task.task_id} from ${task.submitted_by}.`, { taskId: task.task_id }),
      buildParsedTaskEvent(task),
      buildQueueEvent(task),
    ];

    if (task.approval_required) {
      outboundEvents.push(buildApprovalEvent(task));
    }

    return {
      accepted: true,
      route: 'command',
      normalizedTask: task,
      writeBackCandidates,
      outboundEvents,
    };
  }

  if (channelKey === 'approvals') {
    const decision = parseApprovalResponse(message);
    const outboundEvents = decision.valid
      ? [
          event('taskQueue', 'approval_outcome', `${decision.decision} ${decision.taskId}`, decision),
          event('systemLogs', 'approval_outcome', `Approval ${decision.decision} for ${decision.taskId}`, decision),
        ]
      : [
          event('alerts', 'invalid_approval_message', decision.reason, { content: message.content || '' }),
        ];

    return {
      accepted: decision.valid,
      route: 'approval',
      decision,
      outboundEvents,
    };
  }

  if (channelKey === 'voiceCommands') {
    if (!hasAudioAttachment(message)) {
      return {
        accepted: false,
        route: 'voice',
        reason: 'Voice command message did not include a supported audio attachment.',
        outboundEvents: [event('alerts', 'voice_attachment_missing', 'Expected an uploaded audio attachment in #voice-commands.')],
      };
    }

    return {
      accepted: true,
      route: 'voice',
      transcriptionRequest: {
        sourceMessageId: message.messageId || '',
        submittedBy: message.author?.displayName || message.author?.username || message.author?.id || 'unknown',
        attachments: message.attachments || [],
      },
      outboundEvents: [
        event('systemLogs', 'voice_command_received', 'Voice command accepted for transcription.', { messageId: message.messageId || '' }),
      ],
    };
  }

  return {
    accepted: false,
    route: 'ignored',
    reason: `Channel '${channelKey}' is not handled in the phase-1 narrow workflow.`,
    outboundEvents: [],
  };
}
