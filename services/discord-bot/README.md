# Discord Bot Service

## Purpose

Own the Discord gateway layer for phase 1.

## Responsibilities

- validate channel and operator access
- receive typed commands from `#commands`
- receive uploaded voice notes from `#voice-commands`
- receive approval decisions from `#approvals`
- acknowledge accepted work
- post human-facing events back to Discord

## Inputs

- Discord message events
- Discord attachment metadata
- task state updates from the task router
- alert and summary events from orchestration workflows

## Outputs

- parsed task previews in `#parsed-tasks`
- queue updates in `#task-queue`
- approval cards in `#approvals`
- alerts in `#alerts`
- daily rollups in `#daily-summary`

## Required Config

- `config/discord/.env.example`
- `config/discord/channel-map.example.json`
- `config/discord/approval-rules.example.json`

## First Build Milestone

Deliver a bot that:

- accepts a text message in `#commands`
- validates the sender and channel
- emits a normalized task request to the task router
- posts a structured preview into `#parsed-tasks`
