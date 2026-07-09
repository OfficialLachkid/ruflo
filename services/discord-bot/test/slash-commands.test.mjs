import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGuildSlashCommands,
  isSupportedSlashCommandInteraction,
  normalizeInteractionAsHelpMessage,
} from '../src/slash-commands.mjs';

test('buildGuildSlashCommands returns the supported help commands', () => {
  const commands = buildGuildSlashCommands();

  assert.equal(commands.length, 2);
  assert.deepEqual(commands.map((command) => command.name), ['commands', 'help']);
});

test('isSupportedSlashCommandInteraction accepts commands and help', () => {
  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'commands' },
  }), true);

  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'help' },
  }), true);

  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'unknown' },
  }), false);
});

test('normalizeInteractionAsHelpMessage converts slash commands into operator help messages', () => {
  const message = normalizeInteractionAsHelpMessage({
    id: 'interaction-1',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    data: {
      name: 'commands',
    },
    member: {
      nick: 'Valen',
      roles: ['role-1'],
      user: {
        id: 'user-1',
        username: 'vbjservices',
        global_name: 'VBJ Services',
      },
    },
  });

  assert.deepEqual(message, {
    guildId: 'guild-1',
    channelId: 'channel-1',
    messageId: 'interaction-1',
    content: '/commands',
    attachments: [],
    author: {
      id: 'user-1',
      username: 'vbjservices',
      displayName: 'Valen',
      roleIds: ['role-1'],
      isOperator: false,
    },
  });
});
