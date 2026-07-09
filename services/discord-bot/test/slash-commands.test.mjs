import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGuildSlashCommands,
  isSupportedSlashCommandInteraction,
  normalizeInteractionAsHelpMessage,
  normalizeSupportedSlashCommandInteraction,
} from '../src/slash-commands.mjs';

test('buildGuildSlashCommands returns the supported slash commands', () => {
  const commands = buildGuildSlashCommands();

  assert.equal(commands.length, 5);
  assert.deepEqual(commands.map((command) => command.name), ['commands', 'help', 'health', 'status', 'sync']);
});

test('isSupportedSlashCommandInteraction accepts supported slash commands', () => {
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
    data: { name: 'health' },
  }), true);

  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'status' },
  }), true);

  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'sync' },
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
    channelKey: 'commands',
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

test('normalizeSupportedSlashCommandInteraction converts a health slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-2',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-2',
    data: {
      name: 'health',
      options: [
        {
          name: 'target',
          value: 'tailscale',
        },
      ],
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
    channelId: 'channel-2',
    channelKey: 'commands',
    messageId: 'interaction-2',
    content: 'check tailscale health',
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

test('normalizeSupportedSlashCommandInteraction converts a sync slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-3',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-3',
    data: {
      name: 'sync',
      options: [
        {
          name: 'target',
          value: 'mac_runtime_safe_sync',
        },
      ],
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

  assert.equal(message?.content, 'sync the mac');
  assert.equal(message?.channelKey, 'commands');
});
