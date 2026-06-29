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
      isOperator: false,
      roleIds: [],
    },
  }, config);

  assert.equal(result.accepted, false);
  assert.equal(result.route, 'rejected');
});
