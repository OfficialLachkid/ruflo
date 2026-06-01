# Services Runtime Spine

## Goal

Provide the smallest runtime shape that makes Discord-driven orchestration and Ruflo learning operational.

## Phase-1 Flow

1. `discord-bot` listens to `#commands`, `#voice-commands`, and `#approvals`.
2. `transcription-worker` converts uploaded audio into transcript text and metadata.
3. `task-router` turns text or transcript input into a normalized task and approval decision.
4. Ruflo session wrappers retrieve patterns before execution and store durable outcomes after execution.
5. Human-facing updates are posted back into `#parsed-tasks`, `#task-queue`, `#approvals`, `#alerts`, and `#daily-summary`.

## Services

- `discord-bot`: Discord gateway, validation, acknowledgments, and event publishing.
- `transcription-worker`: audio download, normalization, transcription, and confidence metadata.
- `task-router`: task normalization, approval gating, queue state, and memory write-back preparation.

## Supporting Config

- `config/discord/.env.example`
- `config/discord/channel-map.example.json`
- `config/discord/approval-rules.example.json`
- `config/runtime/memory-namespaces.json`

## Supporting Scripts

- `scripts/session-start.ps1`
- `scripts/session-end.ps1`
- `scripts/sync-vault.ps1`

## Phase-1 Constraint

This is a runtime skeleton, not the finished Discord product.

The next implementation step is to build one narrow end-to-end workflow on top of this shape:

- command or voice note intake
- task parsing
- approval gate
- execution
- memory write-back
