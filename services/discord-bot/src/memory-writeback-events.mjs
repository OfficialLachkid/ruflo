export function buildMemoryWriteBackCandidateEvent(task, candidates = []) {
  if (!task?.task_id || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  return {
    channelKey: 'memoryUpdates',
    type: 'memory_writeback_candidates',
    body: `Prepared ${candidates.length} memory write-back candidate(s) for ${task.task_id}.`,
    metadata: {
      taskId: task.task_id,
      summary: task.summary,
      targetAgent: task.target_agent,
      domain: task.domain,
      candidateCount: candidates.length,
      candidates,
    },
  };
}
