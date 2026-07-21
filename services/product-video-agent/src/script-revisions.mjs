import { createStableId } from './ids.mjs';
import {
  OperatorScriptInputSchema,
  OutputManifestSchema,
  ScriptRevisionSchema,
  ScriptVariantSchema,
  WorkflowApprovalSchema,
} from './schemas.mjs';

export function applyOperatorScriptRevision(manifestInput, options) {
  const manifest = OutputManifestSchema.parse(manifestInput);
  const content = OperatorScriptInputSchema.parse(options.content);
  const variant = manifest.script_variants.find((item) => (
    item.script_variant_id === options.scriptVariantId
  ));
  if (!variant) {
    throw new Error(`Script variant ${options.scriptVariantId} was not found.`);
  }
  if (!String(options.actor || '').trim()) {
    throw new Error('Script revision requires an operator identity.');
  }
  if (!String(options.reason || '').trim()) {
    throw new Error('Script revision requires a reason.');
  }

  const spokenText = `${content.hook} ${content.body} ${content.call_to_action}`;
  const revisedVariant = ScriptVariantSchema.parse({
    ...variant,
    ...content,
    spoken_text: spokenText,
    generation_provider: 'operator_revision',
    status: 'awaiting_approval',
    approval_status: 'pending',
  });
  const revision = ScriptRevisionSchema.parse({
    revision_id: createStableId('script-revision', {
      scriptVariantId: variant.script_variant_id,
      spokenText,
      revisedAt: options.revisedAt,
    }),
    script_variant_id: variant.script_variant_id,
    previous_spoken_text: variant.spoken_text,
    revised_spoken_text: spokenText,
    revised_by: options.actor,
    reason: options.reason,
    revised_at: options.revisedAt,
  });
  const workflowApprovals = manifest.workflow_approvals.map((approval) => {
    if (approval.stage !== 'script' || approval.subject_id !== variant.script_variant_id) {
      return approval;
    }
    return WorkflowApprovalSchema.parse({
      ...approval,
      state: 'pending',
      blocking_reasons: [],
      decided_at: null,
      decided_by: null,
      decision_reason: '',
    });
  });

  return OutputManifestSchema.parse({
    ...manifest,
    script_variants: manifest.script_variants.map((item) => (
      item.script_variant_id === variant.script_variant_id ? revisedVariant : item
    )),
    script_revisions: [...manifest.script_revisions, revision],
    workflow_approvals: workflowApprovals,
    notes: [
      ...manifest.notes,
      `Operator revised script ${variant.script_variant_id}; approval was reset to pending.`,
    ],
  });
}
