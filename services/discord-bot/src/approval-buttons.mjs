const DISCORD_COMPONENT_TYPE_ACTION_ROW = 1;
const DISCORD_COMPONENT_TYPE_BUTTON = 2;
const DISCORD_BUTTON_STYLE_SUCCESS = 3;
const DISCORD_BUTTON_STYLE_DANGER = 4;

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

export function buildResolvedApprovalButtons(taskId, decision) {
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
          label: decision === 'approve' ? 'Approved' : 'Approve',
          custom_id: `approve:${taskId}`,
          disabled: true,
        },
        {
          type: DISCORD_COMPONENT_TYPE_BUTTON,
          style: DISCORD_BUTTON_STYLE_DANGER,
          label: decision === 'reject' ? 'Rejected' : 'Reject',
          custom_id: `reject:${taskId}`,
          disabled: true,
        },
      ],
    },
  ];
}

export function buildResolvedApprovalContent(originalContent, decision, actorDisplayName) {
  const base = String(originalContent || '').trim();
  const actor = String(actorDisplayName || 'operator').trim();
  const resolution = `Decision: ${String(decision || '').toUpperCase()} by ${actor}.`;

  if (!base) {
    return resolution;
  }

  if (base.includes(resolution)) {
    return base;
  }

  return `${base}\n\n${resolution}`;
}

export function normalizeInteractionAsApprovalMessage(interaction) {
  const action = parseApprovalButtonCustomId(interaction?.data?.custom_id);
  if (!action) {
    return null;
  }

  const content = action.decision === 'approve'
    ? `approve ${action.taskId}`
    : `reject ${action.taskId} because rejected via approval button`;

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
