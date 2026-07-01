const MAX_DISCORD_MESSAGE_LENGTH = 2000;

function truncateMessage(content) {
  const text = String(content || '').trim();
  if (text.length <= MAX_DISCORD_MESSAGE_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_DISCORD_MESSAGE_LENGTH - 3)}...`;
}

function percent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '';
  }

  return `${Math.round(value * 100)}%`;
}

function lines(...items) {
  return items.filter(Boolean).join('\n');
}

function quote(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  return `> ${text}`;
}

function formatTaskMetadata(task = {}) {
  return lines(
    task.task_id ? `Task: \`${task.task_id}\`` : '',
    task.target_agent ? `Agent: \`${task.target_agent}\`` : '',
    task.domain ? `Domain: \`${task.domain}\`` : '',
    task.priority ? `Priority: \`${task.priority}\`` : '',
    task.status ? `Status: \`${task.status}\`` : ''
  );
}

function formatParsedTaskPreview(outboundEvent) {
  const task = outboundEvent.metadata?.task || {};
  return lines(
    `**Parsed Task**`,
    formatTaskMetadata(task),
    task.summary ? `Summary: ${task.summary}` : '',
    task.approval_required ? `Approval: required` : `Approval: not required`
  );
}

function formatApprovalRequest(outboundEvent) {
  const taskId = outboundEvent.metadata?.taskId || '';
  const reason = outboundEvent.metadata?.approvalReason || '';
  const summaryMatch = /^Approval needed for [^:]+:\s*(.*)$/u.exec(outboundEvent.body || '');
  const summary = summaryMatch ? summaryMatch[1] : '';

  return lines(
    `**Approval Needed**`,
    taskId ? `Task: \`${taskId}\`` : '',
    summary ? `Summary: ${summary}` : '',
    reason ? `Reason: ${reason}` : '',
    'Action: use the buttons below or reply with `approve TASK-ID` / `reject TASK-ID because <reason>`'
  );
}

function formatQueueUpdate(outboundEvent) {
  const taskId = outboundEvent.metadata?.taskId || '';
  const status = outboundEvent.metadata?.status || '';
  const priority = outboundEvent.metadata?.priority || '';
  const action = outboundEvent.metadata?.action || '';

  return lines(
    `**Queue Update**`,
    taskId ? `Task: \`${taskId}\`` : '',
    status ? `Status: \`${status}\`` : '',
    priority ? `Priority: \`${priority}\`` : '',
    action ? `Action: \`${action}\`` : '',
    outboundEvent.body && !outboundEvent.body.startsWith(`${taskId} is`) ? outboundEvent.body : ''
  );
}

function formatVoiceTranscript(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const transcript = String(outboundEvent.body || '').replace(/^Transcript from .*?:\s*/u, '');

  return lines(
    `**Voice Transcript**`,
    quote(transcript),
    metadata.confidence !== undefined ? `Confidence: ${percent(metadata.confidence)}` : '',
    metadata.language ? `Language: \`${metadata.language}\`` : '',
    metadata.segmentCount ? `Segments: \`${metadata.segmentCount}\`` : ''
  );
}

function formatExecutionResult(outboundEvent) {
  const metadata = outboundEvent.metadata || {};

  return lines(
    `**Execution Result**`,
    metadata.taskId ? `Task: \`${metadata.taskId}\`` : '',
    metadata.action ? `Action: \`${metadata.action}\`` : '',
    metadata.state ? `State: \`${metadata.state}\`` : '',
    metadata.activeCount !== undefined ? `Active Count: \`${metadata.activeCount}\`` : '',
    metadata.processCount !== undefined ? `Process Count: \`${metadata.processCount}\`` : '',
    metadata.runs !== undefined ? `Runs: \`${metadata.runs}\`` : '',
    metadata.lastExitCode !== undefined ? `Last Exit Code: \`${metadata.lastExitCode}\`` : '',
    metadata.tailscaleIp ? `Tailscale IP: \`${metadata.tailscaleIp}\`` : '',
    metadata.dnsName ? `Tailscale DNS: \`${metadata.dnsName}\`` : '',
    metadata.dockerContext ? `Docker Context: \`${metadata.dockerContext}\`` : '',
    metadata.dockerServerVersion ? `Docker Version: \`${metadata.dockerServerVersion}\`` : '',
    metadata.colimaState ? `Colima State: \`${metadata.colimaState}\`` : '',
    metadata.activeModelCount !== undefined ? `Active Models: \`${metadata.activeModelCount}\`` : '',
    metadata.mountPoint ? `Mount Point: \`${metadata.mountPoint}\`` : '',
    metadata.availableKb !== undefined ? `Available KB: \`${metadata.availableKb}\`` : '',
    metadata.totalKb !== undefined ? `Total KB: \`${metadata.totalKb}\`` : '',
    metadata.githubHost ? `GitHub Host: \`${metadata.githubHost}\`` : '',
    metadata.githubAccount ? `GitHub Account: \`${metadata.githubAccount}\`` : '',
    metadata.gitProtocol ? `Git Protocol: \`${metadata.gitProtocol}\`` : '',
    metadata.logPath ? `Log Path: \`${metadata.logPath}\`` : '',
    outboundEvent.body || ''
  );
}

function formatRejectedOperator(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const humanName = [metadata.displayName, metadata.username].filter(Boolean).join(' / ');

  return lines(
    `**Unauthorized Operator Blocked**`,
    metadata.mention ? `User: ${metadata.mention}` : '',
    humanName ? `Identity: ${humanName}` : '',
    metadata.authorId ? `User ID: \`${metadata.authorId}\`` : '',
    outboundEvent.body || ''
  );
}

function formatSystemLog(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  return lines(
    `**System Log**`,
    outboundEvent.body || '',
    metadata.taskId ? `Task: \`${metadata.taskId}\`` : '',
    metadata.action ? `Action: \`${metadata.action}\`` : '',
    metadata.state ? `State: \`${metadata.state}\`` : ''
  );
}

function formatAlert(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  return lines(
    `**Alert**`,
    outboundEvent.body || '',
    Array.isArray(metadata.warnings) && metadata.warnings.length > 0
      ? `Warnings: ${metadata.warnings.join(' | ')}`
      : ''
  );
}

export function formatOutboundEventMessage(outboundEvent) {
  let formatted = '';

  switch (outboundEvent.type) {
    case 'parsed_task_preview':
      formatted = formatParsedTaskPreview(outboundEvent);
      break;
    case 'approval_request':
      formatted = formatApprovalRequest(outboundEvent);
      break;
    case 'task_queue_update':
    case 'approval_outcome':
      formatted = formatQueueUpdate(outboundEvent);
      break;
    case 'voice_transcript':
      formatted = formatVoiceTranscript(outboundEvent);
      break;
    case 'task_execution_result':
      formatted = formatExecutionResult(outboundEvent);
      break;
    case 'rejected_message':
      formatted = formatRejectedOperator(outboundEvent);
      break;
    case 'voice_transcription_failed':
    case 'task_execution_failed':
    case 'invalid_approval_message':
    case 'voice_attachment_missing':
    case 'unexpected_channel':
      formatted = formatAlert(outboundEvent);
      break;
    case 'accepted_command':
    case 'accepted_transcribed_command':
    case 'task_execution_started':
    case 'task_execution_completed':
      formatted = formatSystemLog(outboundEvent);
      break;
    default:
      formatted = outboundEvent.body || outboundEvent.type || 'Event received.';
      break;
  }

  return truncateMessage(formatted);
}
