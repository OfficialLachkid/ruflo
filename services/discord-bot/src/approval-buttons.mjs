const DISCORD_COMPONENT_TYPE_ACTION_ROW = 1;
const DISCORD_COMPONENT_TYPE_BUTTON = 2;
const DISCORD_COMPONENT_TYPE_TEXT_INPUT = 4;
const DISCORD_BUTTON_STYLE_SUCCESS = 3;
const DISCORD_BUTTON_STYLE_DANGER = 4;
const DISCORD_TEXT_INPUT_STYLE_PARAGRAPH = 2;
const DISCORD_INTERACTION_TYPE_MESSAGE_COMPONENT = 3;
const DISCORD_INTERACTION_TYPE_MODAL_SUBMIT = 5;
const APPROVAL_REJECT_MODAL_PREFIX = 'reject-modal:';

export function parseApprovalButtonCustomId(customId) {
  const match = /^(approve|reject):(TASK-[A-Z0-9-]+)$/u.exec(String(customId || ''));
  if (!match) {
    return null;
  }

  return {
    decision: match[1],
    taskId: match[2],
  };
}

export function buildApprovalButtons(taskId) {
  if (!taskId) {
    return [];
  }

  return [
    {
      type: DISCORD_COMPONENT_TYPE_ACTION_ROW,
      components: [
        {
          type: DISCORD_COMPONENT_TYPE_BUTTON,
          style: DISCORD_BUTTON_STYLE_SUCCESS,
          label: 'Approve',
          custom_id: `approve:${taskId}`,
        },
        {
          type: DISCORD_COMPONENT_TYPE_BUTTON,
          style: DISCORD_BUTTON_STYLE_DANGER,
          label: 'Reject',
          custom_id: `reject:${taskId}`,
        },
      ],
    },
  ];
}

export function shouldOpenRejectApprovalModal(interaction) {
  const action = parseApprovalButtonCustomId(interaction?.data?.custom_id);
  return interaction?.type === DISCORD_INTERACTION_TYPE_MESSAGE_COMPONENT && action?.decision === 'reject';
}

export function buildApprovalRejectModal(taskId) {
  if (!taskId) {
    return null;
  }

  return {
    custom_id: `${APPROVAL_REJECT_MODAL_PREFIX}${taskId}`,
    title: 'Reject Email Draft',
    components: [
      {
        type: DISCORD_COMPONENT_TYPE_ACTION_ROW,
        components: [
          {
            type: DISCORD_COMPONENT_TYPE_TEXT_INPUT,
            custom_id: 'rejection_reason',
            style: DISCORD_TEXT_INPUT_STYLE_PARAGRAPH,
            label: 'What should be improved before this is sent?',
            placeholder: 'State the required revision feedback.',
            min_length: 5,
            max_length: 1000,
            required: true,
          },
        ],
      },
    ],
  };
}

export function buildResolvedApprovalButtons(taskId, decision) {
  if (!taskId || !decision) {
    return [];
  }

  return [];
}

export function buildResolvedApprovalContent(originalContent, decision, actorDisplayName) {
  const base = String(originalContent || '').trim();
  const actor = String(actorDisplayName || 'operator').trim();
  const resolutionText = `Decision: ${String(decision || '').toUpperCase()} by ${actor}.`;
  const resolution = `**${resolutionText}**`;

  if (!base) {
    return resolution;
  }

  if (base.includes(resolution)) {
    return base;
  }

  if (base.includes(resolutionText)) {
    return base.replace(resolutionText, resolution);
  }

  return `${base}\n\n${resolution}`;
}

export function normalizeInteractionAsApprovalMessage(interaction) {
  const action = interaction?.type === DISCORD_INTERACTION_TYPE_MODAL_SUBMIT
    ? parseRejectApprovalModalInteraction(interaction)
    : parseApprovalButtonCustomId(interaction?.data?.custom_id);
  if (!action) {
    return null;
  }

  const content = action.decision === 'approve'
    ? `approve ${action.taskId}`
    : `reject ${action.taskId} because ${action.reason || 'rejected via approval button'}`;

  return {
    guildId: interaction.guild_id || '',
    channelId: interaction.channel_id || '',
    messageId: interaction.message?.id || '',
    content,
    attachments: [],
    author: {
      id: interaction.member?.user?.id || interaction.user?.id || '',
      username: interaction.member?.user?.username || interaction.user?.username || '',
      displayName: interaction.member?.nick || interaction.member?.user?.global_name || interaction.user?.global_name || interaction.member?.user?.username || interaction.user?.username || '',
      roleIds: Array.isArray(interaction.member?.roles) ? interaction.member.roles : [],
      isOperator: false,
    },
  };
}

function parseRejectApprovalModalInteraction(interaction) {
  const customId = String(interaction?.data?.custom_id || '');
  const match = new RegExp(`^${APPROVAL_REJECT_MODAL_PREFIX}(TASK-[A-Z0-9-]+)$`, 'u').exec(customId);
  if (!match) {
    return null;
  }

  const reason = extractRejectApprovalReason(interaction?.data?.components);
  if (!reason) {
    return {
      decision: 'reject',
      taskId: match[1],
      reason: '',
    };
  }

  return {
    decision: 'reject',
    taskId: match[1],
    reason,
  };
}

function extractRejectApprovalReason(components = []) {
  for (const row of Array.isArray(components) ? components : []) {
    for (const component of Array.isArray(row?.components) ? row.components : []) {
      if (component?.custom_id === 'rejection_reason') {
        return String(component.value || '').replace(/\s+/gu, ' ').trim();
      }
    }
  }

  return '';
}
