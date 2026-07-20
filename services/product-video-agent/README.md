# O.R.I.O.N. Product Video Agent

Phase 0 contracts plus a short-form-first Phase 1/2 local production foundation.

## What exists

The service imports one manual fixture, normalizes it into provider-independent records, scores the product, creates local script/TTS/caption/render plans, applies asset-rights and content-hash gates, creates workflow and publication approvals, and writes a reviewable manifest.

The default dry run executes no marketplace API, browser automation, model, TTS, FFmpeg, Supabase, affiliate, Discord, or publishing call. An explicit local-preview command may call only the loopback Ollama endpoint. Approved narration and rendering are separate commands that reject unresolved workflow approvals. The fixture is synthetic and no credentials are required.

The active targets are YouTube Shorts, Instagram Reels, and TikTok. Script jobs are limited to 10-60 seconds. Long-form output is disabled and deferred; its current planning target is 2-5 minutes.

## Run

From the repository root:

```bash
npm run product-video:dry-run
```

The default manifest is written under `data/runtime/product-video-agent/<run-id>/manifest.json`. That runtime directory is already ignored by Git.

Useful options:

```bash
node services/product-video-agent/index.mjs --no-persist --print-manifest
node services/product-video-agent/index.mjs --input-file path/to/manual-product.json
node services/product-video-agent/index.mjs --run-at 2026-07-20T12:00:00.000Z
```

Inspect the Mac-local stack without generating content:

```bash
npm run product-video:doctor
```

Generate three local scripts with the configured Ollama model:

```bash
npm run product-video:local-preview
```

This opt-in command sets the manifest mode to `local_preview`. Generated scripts remain pending operator approval. It cannot start TTS, FFmpeg, asset acquisition, or publishing.

Generate Discord-compatible approval payloads without sending anything:

```bash
npm run product-video:approval-cards
node services/product-video-agent/index.mjs --approval-cards --manifest data/runtime/product-video-agent/<run-id>/manifest.json
```

The checked-in `config.example.json` contains no secrets. It uses the Mac's installed `llama3.1:8b`, Piper, faster-whisper, and FFmpeg through the repository-local `.venv-product-video` environment. Local execution remains zero-cost but must be explicitly requested.

## Contracts and adapters

`src/schemas.mjs` defines product, source, score, asset provenance, voice-license, script, voice-over, word timing, caption, render, workflow approval, affiliate, publication, analytics, and output-manifest contracts.

`ProductProviderAdapter` is the marketplace/provider boundary. The Phase 1 implementation is `FixtureProductProviderAdapter`; future permitted marketplace integrations must normalize to the same contracts without leaking provider-specific payloads downstream.

`ProductVideoStateStore` is the persistence boundary. `FileProductVideoStateStore` is active. `SupabaseProductVideoStateStore` is an explicit non-operational stub so later persistence can be added without changing pipeline entities. Backend Supabase credentials must remain runtime-only.

## Asset and Amazon video policy

A visible product video is not automatically reusable media. Amazon-, merchant-, customer-, or creator-hosted assets stay blocked when rights are unverified, evidence is absent, operator approval is pending, or the local file is unavailable.

The dry run creates an asset-acquisition plan for each referenced file. A plan may become download-eligible only after all of these are true:

- the source permits the retrieval method and no anti-bot control is bypassed;
- the rights holder or applicable license explicitly permits the planned reuse;
- the evidence and attribution requirements are stored on the asset record;
- the asset-usage approval state is `approved`.

The fixture deliberately includes an Amazon video reference with `rights_status: unverified`; its acquisition plan is blocked and it is excluded from publication-candidate render jobs. A separate repository-authored PPM image is rights-verified, operator-approved, and SHA-256 checked so the renderer can be tested without third-party media. Validated remote download execution remains deferred.

Amazon footage may be used only in the isolated internal editor-test mode when an operator manually supplies the local file. That mode does not download media, accepts only `manual_upload`/fixture files with a matching SHA-256 hash and explicit internal approval, forces an `INTERNAL TEST - DO NOT PUBLISH` watermark, sets `publication_eligible: false`, and cannot unlock a publication. Use `fixtures/internal-editor-test-asset.example.json` as the asset-record template and set `render.purpose` to `internal_editor_test` in a local config. Never upload the resulting render to a third-party platform.

Mac preparation for an internal editor test:

```bash
mkdir -p data/runtime/product-video-agent/internal-tests
shasum -a 256 data/runtime/product-video-agent/internal-tests/<filename>.mp4
```

Add the manually supplied file and resulting hash to the product import record. Do not automate Amazon media retrieval or bypass login, anti-bot, DRM, or access controls.

Research note, 2026-07-20: Amazon's current [Operating Agreement](https://affiliate-program.amazon.com/help/operating/agreement/), [Program Policies and IP License](https://affiliate-program.amazon.com/help/operating/policies), and [Participation Requirements](https://affiliate-program.amazon.com/help/operating/participation/) do not provide a clear grant to download arbitrary page-visible listing videos and repost them to third-party short-form platforms. The IP license is limited to Program Content Amazon makes available under its program and restricts downloading, redistribution, and sublicensing. Treat a listing video as unverified unless the specific Amazon program/API terms or the rights holder provide written permission for the intended platform use. This operational rule is not legal advice and must be rechecked against the applicable marketplace and account terms.

## Selected voices

The default is `en_US-ljspeech-high`, a single-speaker US English female voice. Its [upstream Piper model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/high/MODEL_CARD) identifies the LJ Speech training dataset as public domain.

The alternate is `en_US-norman-medium`, a single-speaker US English male voice. Its [upstream Piper model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/norman/medium/MODEL_CARD) identifies the training recordings as public-domain LibriVox material and states that the voice was trained from scratch. The Piper voice repository is MIT-licensed and the local Piper engine is GPL-3.0. The commercial-use reviews are recorded under `voices/`.

`voice.assignment_strategy` is `round_robin`, so the example's three script variants use female, male, female narrators. Set it to `default_only` to use `voice.default_profile_id` for every video. Each voice job records its profile, model, and license record.

`en_US-lessac-medium` is intentionally not used. Its linked dataset license is research-only and explicitly excludes commercial use, which is incompatible with affiliate content.

Both selected voices are practical first local narrators, but voice quality is subjective. Generate and listen to samples before production use; adding another voice requires a reviewed license record.

## Local assembly

The recommended local stack is:

- Ollama with the locally installed `llama3.1:8b` model for short-form script previews;
- Piper with alternating US female and male profiles for zero-cost speech generation;
- faster-whisper `small.en` for word-level narration timing;
- ASS karaoke captions for animated word highlighting;
- FFmpeg for deterministic 1080x1920 H.264/AAC assembly;
- a JSON editing template such as `vertical-product-v1.template.json` for pacing, safe zones, captions, and audio rules.

This keeps deterministic work outside the language model. The first renderer uses one approved visual, narration audio, and word-timed ASS captions. Music is disabled until a rights-approved local track exists. Remotion remains a later option only if template complexity outgrows maintainable FFmpeg filters.

The existing local faster-whisper worker is the preferred first caption-timing source after Piper produces narration. This avoids adding a cloud alignment provider.

Mac engine setup:

```bash
brew install ffmpeg-full
python3 -m venv .venv-product-video
.venv-product-video/bin/python -m pip install --upgrade pip
.venv-product-video/bin/python -m pip install -r services/product-video-agent/requirements.txt
mkdir -p data/runtime/product-video-agent/models/piper
.venv-product-video/bin/python -m piper.download_voices en_US-ljspeech-high en_US-norman-medium --data-dir data/runtime/product-video-agent/models/piper
.venv-product-video/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('small.en', device='cpu', compute_type='int8')"
npm run product-video:doctor
```

`ffmpeg-full` is keg-only and can coexist with the smaller Homebrew `ffmpeg` formula. O.R.I.O.N. auto-detects its Apple Silicon or Intel Homebrew path because the regular formula omits the ASS/libass caption filter. The doctor rejects FFmpeg builds without that filter.

The voice download creates both `.onnx` models and `.onnx.json` configurations. The faster-whisper prefetch downloads the local alignment model once. Neither command uses paid inference. To create samples, approve a fixture script and run the normal approved-narration command; the resulting WAV paths and selected profiles are recorded in the manifest.

### Mac resource profile

The lead Mac mini is an Apple M4 with 10 CPU cores, 16 GB unified memory, and 125 GiB free disk as checked on 2026-07-20. Keep local assembly sequential: `llama3.1:8b` uses about 4.9 GB when loaded, so the configuration sends `keep_alive: 0s` to unload it after each script response; faster-whisper then runs `small.en` on CPU with `int8`; Piper and FFmpeg run afterward.

Heavy Ruflo jobs share a machine-wide `local-ai-heavy` lock under the Mac user runtime directory. This coordinates scheduled/manual leadgen, qualification, Discord-triggered leadgen, and O.R.I.O.N. even when they run from different Git worktrees. O.R.I.O.N. also calls Ollama's local `/api/ps` endpoint immediately before work and defers when any model is loaded or a configured conflicting process is active.

```bash
npm run product-video:preflight
```

The command exits with status `0` when the local model/runtime is free and `75` when the job should be deferred without being treated as a permanent failure.

### Scheduled queue

The scheduled runner consumes only explicitly queued local actions: local script preview, approved narration, and approved rendering. Asset acquisition, paid services, publishing, and account actions are not accepted queue actions.

```bash
# Queue a local script preview.
npm run product-video:enqueue -- --action local_preview --input-file services/product-video-agent/fixtures/example-product.json

# Inspect one queue window manually.
npm run product-video:scheduled-run

# After this branch is merged to main, install launchd windows at 01:00, 13:00, 17:00, and 21:00.
npm run product-video:install-schedule
```

Each window executes at most one queued job. Busy jobs become `deferred` for 30 minutes and are retried at a later window. The launch agent must be installed from the Mac's `main` worktree after merge, never from a temporary feature worktree.

## Media storage strategy

Use a hybrid cache when Supabase persistence is added:

- Store products, rights/provenance, hashes, approvals, jobs, object paths, costs, and analytics in Postgres.
- Store footage, images, narration, captions, music, sound effects, render previews, and final masters in private Supabase Storage buckets, not database rows.
- Keep only active-job inputs, models, and recent outputs on the Mac. Verify every download by SHA-256 and evict completed scratch files after upload and a retention window.
- Keep reusable rights-approved library assets cached by content hash; do not repeatedly download identical media.
- Use resumable uploads for video files and RLS-protected private buckets. Keep the service-role key backend-only.

Supabase's free tier includes only 1 GB file storage and limits individual files to 50 MB, so meaningful video production will likely require Pro or another S3-compatible object store. Storage and egress remain paid resources and need spend monitoring. See [Supabase Storage](https://supabase.com/docs/guides/storage), [upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits), and [Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

## Music and sound effects

Background music and sound effects must use the same provenance, hash, license, attribution, scope, and approval gates as visual assets. The editor should choose an approved highlight or high-energy section based on beats/onsets instead of always starting at timestamp zero, duck music below narration, and use sparse transition/impact effects rather than constant sound effects.

`Paris` by Else is a requested creative reference but is blocked from the local cross-platform renderer until commercial synchronization and master-use rights are documented. A short excerpt or song highlight is still copyrighted. If a platform makes the track available for the specific account and commercial post type, a future platform adapter may add it through that platform's licensed music workflow; it must not bake that platform-specific audio into the reusable cross-platform master. YouTube requires commercial rights to all audio/visual elements and notes that even short music uses can receive Content ID claims; Instagram restricts parts of its licensed library for business/commercial use. See [YouTube monetization guidance](https://support.google.com/youtube/answer/2490020) and [Instagram licensed music access](https://www.facebook.com/help/instagram/402084904469945).

## Discord channels

Create one category named `O.R.I.O.N. Video Factory` with these text channels:

- `orion-intake`: product candidates, manual imports, and commands.
- `orion-review`: operator-only script, asset-rights, music/SFX, render, spending, and publishing approval cards.
- `orion-renders`: publication-candidate previews and completed local render links after the applicable gates pass.
- `orion-lab`: internal editor-test footage, voice comparisons, template experiments, and watermarked non-publishable renders.
- `orion-ops`: runtime readiness, queue depth, model/lock deferrals, failures, disk/cache status, and production costs.
- `orion-analytics`: later platform views, retention, clicks, conversions, revenue, and per-video ROI.

Put the six channel IDs in `config/discord/.env` using the `DISCORD_ORION_*_CHANNEL_ID` variables. The bot does not need the category ID. Product-video approval cards now target the `orionReview` channel key; live posting remains disabled until the IDs and persistence handler are connected.

## Approval sequence

1. Run the local preview and inspect script cards.
2. Apply a script decision to the saved manifest.
3. Execute approved narration; Piper and faster-whisper run locally and the render approval changes from `blocked` to `pending`.
4. Regenerate the render card from the narrated manifest.
5. Apply the render decision.
6. Execute the approved FFmpeg render.

Example commands:

```bash
node services/product-video-agent/index.mjs --decide-workflow data/runtime/product-video-agent/<run-id>/manifest.json --task-id TASK-ORION-SCRIPT-... --decision approve --actor operator-name --reason "Approved for local narration" --write-manifest data/runtime/product-video-agent/<run-id>/script-approved.json
npm run product-video:approved-narration -- data/runtime/product-video-agent/<run-id>/script-approved.json --script-variant-id script-variant-... --write-manifest data/runtime/product-video-agent/<run-id>/narrated.json
node services/product-video-agent/index.mjs --approval-cards --manifest data/runtime/product-video-agent/<run-id>/narrated.json
node services/product-video-agent/index.mjs --decide-workflow data/runtime/product-video-agent/<run-id>/narrated.json --task-id TASK-ORION-RENDER-... --decision approve --actor operator-name --reason "Approved for local fixture render" --write-manifest data/runtime/product-video-agent/<run-id>/render-approved.json
npm run product-video:approved-render -- data/runtime/product-video-agent/<run-id>/render-approved.json --script-variant-id script-variant-... --write-manifest data/runtime/product-video-agent/<run-id>/rendered.json
```

Discord cards reuse the existing Ruflo embed and button format. Blocked asset and render cards disable approval. This increment builds and validates card payloads but does not automatically post them or persist button decisions; live Discord-to-manifest persistence is the next integration step.

## Approval gates

Script use, asset use, rendering, paid usage, publishing, account changes, and external actions require the applicable approval. A publication draft can never become publish-ready merely because a local render exists. Supabase writes, licensed remote acquisition, Discord posting, and publishing remain non-operational.

## Test

```bash
npm run test:product-video-agent
```
