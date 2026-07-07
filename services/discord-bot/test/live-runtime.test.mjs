import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApprovalButtons,
  buildResolvedApprovalButtons,
  buildResolvedApprovalContent,
  normalizeInteractionAsApprovalMessage,
  parseApprovalButtonCustomId,
} from '../src/approval-buttons.mjs';
import {
  attachImageContextToTasks,
  buildImageContextKey,
  mergeImageAttachments,
  shouldScheduleDeferredDiscordBotRestart,
} from '../src/live-runtime.mjs';

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

test('buildResolvedApprovalButtons removes the approval buttons after resolution', () => {
  const components = buildResolvedApprovalButtons('TASK-202606291339-2AA8A8F209', 'approve');
  assert.deepEqual(components, []);
});

test('buildResolvedApprovalContent appends a visible resolution line', () => {
  assert.equal(
    buildResolvedApprovalContent('Approval needed for TASK-202606291339-2AA8A8F209: Deploy to production', 'approve', 'Valen'),
    'Approval needed for TASK-202606291339-2AA8A8F209: Deploy to production\n\n**Decision: APPROVE by Valen.**'
  );
});

test('shouldScheduleDeferredDiscordBotRestart only triggers for deferred Mac sync completions', () => {
  assert.equal(shouldScheduleDeferredDiscordBotRestart({
    outcome: 'completed',
    executionPlan: {
      action: 'mac_runtime_safe_sync',
    },
    executionResult: {
      report: {
        restartDiscordBotDeferred: true,
      },
    },
  }), true);

  assert.equal(shouldScheduleDeferredDiscordBotRestart({
    outcome: 'completed',
    executionPlan: {
      action: 'disk_space_health_check',
    },
    executionResult: {
      report: {
        restartDiscordBotDeferred: true,
      },
    },
  }), false);
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

test('mergeImageAttachments de-duplicates image attachments by id', () => {
  const merged = mergeImageAttachments(
    [{ id: 'img-1', filename: 'a.png' }],
    [{ id: 'img-1', filename: 'a.png' }, { id: 'img-2', filename: 'b.png' }]
  );

  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'img-1');
  assert.equal(merged[1].id, 'img-2');
});

test('attachImageContextToTasks updates task image metadata', () => {
  const tasks = [{
    task_id: 'TASK-1',
    image_attachment_count: 0,
    image_attachments: [],
    image_attachment_filenames: [],
  }];

  attachImageContextToTasks(tasks, [
    { id: 'img-1', filename: 'screen-1.png', contentType: 'image/png' },
    { id: 'img-2', filename: 'screen-2.png', contentType: 'image/png' },
  ]);

  assert.equal(tasks[0].image_attachment_count, 2);
  assert.deepEqual(tasks[0].image_attachment_filenames, ['screen-1.png', 'screen-2.png']);
});

test('buildImageContextKey scopes image context by author and channel', () => {
  assert.equal(
    buildImageContextKey({
      channelId: 'channel-1',
      author: { id: 'user-1' },
    }),
    'user-1:channel-1'
  );
});
