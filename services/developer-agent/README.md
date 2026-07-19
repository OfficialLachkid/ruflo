# O.R.I.O.N. Developer Agent

The developer-agent workflow turns an explicitly approved Discord task into an isolated GitHub issue-to-draft-PR lifecycle.

## Operator Entry Points

- Discord text: `create issue for developer: <objective>`
- Discord slash command: `/create-developer-issue objective:<objective>`
- Monitoring adapter: emit the same structured task with `runtime_action=developer_agent_workflow` and preserve the alert as the objective/source context.

Every entry point must enter the normal task queue and approval flow. Monitoring alerts must not invoke Claude or write to GitHub directly. They should create an approval request first so failures cannot cause issue spam or consume Claude quota silently.

## Lifecycle

1. O.R.I.O.N. creates an approval-gated developer task.
2. After approval, the workflow validates GitHub CLI authentication.
3. It creates a structured GitHub issue from the task and attachments.
4. It fetches current `origin/main` and creates an isolated `agent/*` branch and worktree.
5. Claude receives the issue, task context, and isolated worktree path. Claude may edit and test, but may not commit, push, open PRs, or merge.
6. Deterministic code validates the changes, creates a Conventional Commit, rebases safely when needed, runs repository guards, and pushes the branch.
7. It opens a draft PR linked to the issue and posts the result to `#github`.
8. GitHub Actions reports source and target branches plus CI state to `#ci`.
9. A human reviews and promotes the draft. Merge is never automatic in this workflow.

## Configuration

Configure these only in the Mac runtime environment:

```dotenv
DEVELOPER_AGENT_ENABLED=true
DEVELOPER_AGENT_REMOTE=origin
DEVELOPER_AGENT_BASE_BRANCH=main
DEVELOPER_AGENT_WORKTREES_PATH=/Users/Agent/.ruflo/runtime/developer-worktrees
DEVELOPER_AGENT_STATE_PATH=/Users/Agent/.ruflo/runtime/developer-agent
DISCORD_CI_CHANNEL_ID=1527300397423792281
```

The paths are optional. By default they resolve under the existing Ruflo runtime temporary directory.

## Safety And Recovery

- Approval is checked again inside the workflow before any Claude or GitHub write.
- Commands use argument arrays with `shell: false`; task text is not interpolated into a shell command.
- Per-task state is written atomically so blocked Claude runs can be retried.
- A per-task lock prevents duplicate concurrent execution.
- Work begins from the latest fetched base branch and refuses conflicted rebases.
- The workflow opens draft PRs only and never merges.
- Secrets, Conventional Commit format, script size, tests, and whitespace are validated before push.
