import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import { processDiscordEvent } from '../src/intake.mjs';

test('processDiscordEvent routes commands into parsed task, queue, and approval events', () => {
  const config = loadRuntimeConfig();
  const result = processDiscordEvent({
    guildId: config.guildId || 'DISCORD_GUILD_ID',
    channelKey: 'commands',
    channelId: config.channelIds.commands || 'DISCORD_COMMANDS_CHANNEL_ID',
    content: 'Please deploy the latest fix to production.',
    author: {
      id: 'operator-1',
      displayName: 'VBJ Services',
      isOperator: true,
      roleIds: [],
    },
  }, config);

  assert.equal(result.accepted, true);
  assert.equal(result.route, 'command');
  assert.equal(result.outboundEvents.some((item) => item.channelKey === 'parsedTasks'), true);
  assert.equal(result.outboundEvents.some((item) => item.channelKey === 'taskQueue'), true);
  assert.equal(result.outboundEvents.some((item) => item.channelKey === 'approvals'), true);
});

test('processDiscordEvent rejects unauthorized senders', () => {
  const config = loadRuntimeConfig();
  const result = processDiscordEvent({
    guildId: config.guildId || 'DISCORD_GUILD_ID',
    channelKey: 'commands',
    channelId: config.channelIds.commands || 'DISCORD_COMMANDS_CHANNEL_ID',
    content: 'Run this command.',
    author: {
      id: 'random-user',
      displayName: 'Unknown',
      username: 'intruder',
      isOperator: false,
      roleIds: [],
    },
  }, config);

  assert.equal(result.accepted, false);
  assert.equal(result.route, 'rejected');
  assert.equal(result.outboundEvents[0].channelKey, 'alerts');
  assert.match(result.outboundEvents[0].body, /<@random-user>/u);
  assert.equal(result.outboundEvents[0].metadata.authorId, 'random-user');
  assert.equal(result.outboundEvents[0].metadata.displayName, 'Unknown');
  assert.equal(result.outboundEvents[0].metadata.username, 'intruder');
});

test('processDiscordEvent splits multi-line command messages into multiple normalized tasks', () => {
  const config = loadRuntimeConfig();
  const result = processDiscordEvent({
    guildId: config.guildId || 'DISCORD_GUILD_ID',
    channelKey: 'commands',
    channelId: config.channelIds.commands || 'DISCORD_COMMANDS_CHANNEL_ID',
    content: 'check disk space\ncheck ollama health\ncheck tailscale health',
    author: {
      id: 'operator-1',
      displayName: 'VBJ Services',
      isOperator: true,
      roleIds: [],
    },
  }, config);

  assert.equal(result.accepted, true);
  assert.equal(result.route, 'command');
  assert.equal(result.normalizedTasks.length, 3);
  assert.equal(result.outboundEvents.filter((item) => item.channelKey === 'parsedTasks').length, 3);
  assert.equal(result.outboundEvents.filter((item) => item.channelKey === 'taskQueue').length, 3);
});
