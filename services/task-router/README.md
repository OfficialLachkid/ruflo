# Task Router

## Purpose

Turn free-form text or transcript input into a normalized task that can be queued, approved, executed, and learned from.

## Responsibilities

- normalize inbound text into a task object
- infer target agent or workflow
- assign priority and domain
- decide whether approval is required
- emit queue state transitions
- prepare durable memory write-back payloads

## Normalized Task Minimum

- `task_id`
- `source_type`
- `source_channel`
- `submitted_by`
- `submitted_at`
- `summary`
- `full_text`
- `target_agent`
- `domain`
- `priority`
- `approval_required`
- `approval_reason`
- `status`

## Approval Sources

- `config/discord/approval-rules.example.json`
- business or infrastructure policies captured in the vault

## Memory Write-Back Rule

Only emit durable write-back candidates for:

- decisions
- normalized task summaries
- execution results
- successful patterns
- important failures or gotchas
