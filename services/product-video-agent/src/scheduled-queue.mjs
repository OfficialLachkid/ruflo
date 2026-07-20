import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { createStableId } from './ids.mjs';
import { resolveInsideRoot } from './paths.mjs';

const IsoDateTimeSchema = z.string().datetime({ offset: true });
const OptionalPathSchema = z.string().min(1).nullable();

export const ScheduledProductVideoJobSchema = z.object({
  job_id: z.string().min(1),
  action: z.enum(['local_preview', 'approved_narration', 'approved_render']),
  input_file: OptionalPathSchema,
  config_path: z.string().min(1),
  manifest_path: OptionalPathSchema,
  script_variant_id: OptionalPathSchema,
  output_manifest_path: OptionalPathSchema,
  status: z.enum(['pending', 'deferred', 'running', 'completed', 'failed']),
  attempts: z.number().int().nonnegative(),
  not_before: IsoDateTimeSchema,
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
  last_error: z.string(),
}).strict().superRefine((job, context) => {
  if (job.action !== 'local_preview' && (!job.manifest_path || !job.script_variant_id || !job.output_manifest_path)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Approved narration/render jobs require manifest, script variant, and output manifest paths.',
    });
  }
});

const QueueSchema = z.array(ScheduledProductVideoJobSchema);

export function resolveScheduledQueuePath(projectRoot, queuePath) {
  return resolveInsideRoot(
    projectRoot,
    queuePath || 'data/runtime/product-video-agent/scheduled-jobs.json',
    'Scheduled product-video queue path',
  );
}

export async function readScheduledQueue(projectRoot, queuePath) {
  const absolutePath = resolveScheduledQueuePath(projectRoot, queuePath);
  try {
    return QueueSchema.parse(JSON.parse(await readFile(absolutePath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeScheduledQueue(projectRoot, queue, queuePath) {
  const absolutePath = resolveScheduledQueuePath(projectRoot, queuePath);
  const temporaryPath = `${absolutePath}.tmp-${process.pid}`;
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(QueueSchema.parse(queue), null, 2)}\n`, 'utf8');
  await rename(temporaryPath, absolutePath);
  return absolutePath;
}

export function createScheduledProductVideoJob(input, now = new Date().toISOString()) {
  return ScheduledProductVideoJobSchema.parse({
    job_id: createStableId('scheduled-orion-job', { ...input, createdAt: now }),
    action: input.action,
    input_file: input.input_file || null,
    config_path: input.config_path || 'services/product-video-agent/config.example.json',
    manifest_path: input.manifest_path || null,
    script_variant_id: input.script_variant_id || null,
    output_manifest_path: input.output_manifest_path || null,
    status: 'pending',
    attempts: 0,
    not_before: input.not_before || now,
    created_at: now,
    updated_at: now,
    last_error: '',
  });
}

export function claimNextScheduledJob(queue, now = new Date().toISOString()) {
  const index = queue.findIndex((job) => (
    ['pending', 'deferred'].includes(job.status) && Date.parse(job.not_before) <= Date.parse(now)
  ));
  if (index === -1) return { queue, job: null };
  const job = ScheduledProductVideoJobSchema.parse({
    ...queue[index],
    status: 'running',
    attempts: queue[index].attempts + 1,
    updated_at: now,
    last_error: '',
  });
  return {
    job,
    queue: queue.map((item, itemIndex) => itemIndex === index ? job : item),
  };
}

export function resolveScheduledJob(queue, jobId, resolution) {
  return queue.map((job) => job.job_id === jobId
    ? ScheduledProductVideoJobSchema.parse({ ...job, ...resolution })
    : job);
}
