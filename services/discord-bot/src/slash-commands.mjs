const DISCORD_INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const HELP_COMMAND_NAMES = new Set(['commands', 'help']);

function buildAuthorFromInteraction(interaction) {
  return {
    id: interaction.member?.user?.id || interaction.user?.id || '',
    username: interaction.member?.user?.username || interaction.user?.username || '',
    displayName:
      interaction.member?.nick
      || interaction.member?.user?.global_name
      || interaction.user?.global_name
      || interaction.member?.user?.username
      || interaction.user?.username
      || '',
    roleIds: Array.isArray(interaction.member?.roles) ? interaction.member.roles : [],
    isOperator: false,
  };
}

export function buildGuildSlashCommands() {
  return [
    {
      name: 'commands',
      description: 'Show the current Ruflo operator command guide.',
      type: 1,
    },
    {
      name: 'help',
      description: 'Show the current Ruflo operator command guide.',
      type: 1,
    },
  ];
}

export function isSupportedSlashCommandInteraction(interaction) {
  return interaction?.type === DISCORD_INTERACTION_TYPE_APPLICATION_COMMAND
    && HELP_COMMAND_NAMES.has(String(interaction?.data?.name || '').toLowerCase());
}

export function normalizeInteractionAsHelpMessage(interaction) {
  if (!isSupportedSlashCommandInteraction(interaction)) {
    return null;
  }

  const commandName = String(interaction.data?.name || 'commands').toLowerCase();

  return {
    guildId: interaction.guild_id || '',
    channelId: interaction.channel_id || '',
    messageId: interaction.id || '',
    content: `/${commandName}`,
    attachments: [],
    author: buildAuthorFromInteraction(interaction),
  };
}
