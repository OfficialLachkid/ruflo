import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApprovalButtons, normalizeInteractionAsApprovalMessage, parseApprovalButtonCustomId } from '../src/approval-buttons.mjs';

test('parseApprovalButtonCustomId understands approve and reject actions', () => {
  assert.deepEqual(
    parseApprovalButtonCustomId('approve:TASK-202606291339-2AA8A8F209'),
    {
      decision: 'approve',
      taskId: 'TASK-202606291339-2AA8A8F209',
    }
  );

  assert.deepEqual(
    parseApprovalButtonCustomId('reject:TASK-202606291339-2AA8A8F209'),
    {
      decision: 'reject',
      taskId: 'TASK-202606291339-2AA8A8F209',
    }
  );

  assert.equal(parseApprovalButtonCustomId('noop:TASK-123'), null);
});

test('buildApprovalButtons creates green approve and red reject buttons', () => {
  const components = buildApprovalButtons('TASK-202606291339-2AA8A8F209');
  assert.equal(components.length, 1);
  assert.equal(components[0].components[0].label, 'Approve');
  assert.equal(components[0].components[0].style, 3);
  assert.equal(components[0].components[1].label, 'Reject');
  assert.equal(components[0].components[1].style, 4);
});

test('normalizeInteractionAsApprovalMessage converts a button click into approval text', () => {
  const message = normalizeInteractionAsApprovalMessage({
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    data: {
      custom_id: 'reject:TASK-202606291339-2AA8A8F209',
    },
    message: {
      id: 'message-1',
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
    messageId: 'message-1',
    content: 'reject TASK-202606291339-2AA8A8F209 because rejected via approval button',
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
