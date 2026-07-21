# O.R.I.O.N. Product Video Agent

A durable, short-form-first product research and video production workflow.

## What exists

The service imports one manual fixture, normalizes it into provider-independent records, scores the product, creates local script/TTS/caption/render plans, applies asset-rights and content-hash gates, creates workflow and publication approvals, and writes a reviewable manifest.

The default dry run executes no marketplace API, browser automation, model, TTS, FFmpeg, Supabase, affiliate, Discord, or publishing call. An explicit local-preview command may call only the loopback Ollama endpoint. Approved narration and rendering are separate commands that reject unresolved workflow approvals. The fixture is synthetic and no credentials are required.

`spoken_text` is the only script field passed to local TTS. Affiliate disclosure is stored separately as publication and review metadata and is never appended to narration or captions.

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

Run the first real single-product package without calling Amazon or downloading media:

```bash
node services/product-video-agent/index.mjs \
  --input-file services/product-video-agent/fixtures/cyboris-s11-amazon-nl.json \
  --no-persist
```

This fixture records ASIN `B0F1CCLZGT`, supported product facts, research timestamps, and the absence of an observed listing video. The Amazon price is deliberately `null` because it could not be verified; price-dependent ROI remains zero until a later permitted refresh. The render plan uses an owned synthetic card, not an Amazon product image.

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

The checked-in `config.example.json` contains no secrets. It uses the Mac's installed `llama3.1:8b`, Kokoro, faster-whisper, and FFmpeg. Local execution has no per-run model, TTS, or rendering API fee, but still uses Mac electricity, disk, and network bandwidth. Execution must be explicitly requested.

## Contracts and adapters

`src/schemas.mjs` defines product, source, score, asset provenance, voice-license, script, voice-over, word timing, caption, render, workflow approval, affiliate, publication, analytics, and output-manifest contracts.

`ProductProviderAdapter` is the marketplace/provider boundary. The first implementation is `FixtureProductProviderAdapter`; future permitted marketplace integrations must normalize to the same contracts without leaking provider-specific payloads downstream.

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

SHA-256 is a deterministic fingerprint of a file. O.R.I.O.N. stores the 64-character digest when an asset is approved, recomputes it before rendering, and blocks the file if one byte has changed or the wrong file was supplied. It verifies asset identity and integrity; it does not establish copyright ownership or usage rights.

Research note, 2026-07-20: Amazon's current [Operating Agreement](https://affiliate-program.amazon.com/help/operating/agreement/), [Program Policies and IP License](https://affiliate-program.amazon.com/help/operating/policies), and [Participation Requirements](https://affiliate-program.amazon.com/help/operating/participation/) do not provide a clear grant to download arbitrary page-visible listing videos and repost them to third-party short-form platforms. The IP license is limited to Program Content Amazon makes available under its program and restricts downloading, redistribution, and sublicensing. Treat a listing video as unverified unless the specific Amazon program/API terms or the rights holder provide written permission for the intended platform use. This operational rule is not legal advice and must be rechecked against the applicable marketplace and account terms.

## Selected voices

The default local engine is [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), an Apache-2.0 82M-parameter model that is substantially more natural than the current Piper voices while remaining practical on the Mac mini. The default US female voice is `af_heart`; the alternating US male voice is `am_fenrir`. The upstream model card states that its training sources are permissive or non-copyrighted. The operational license review is recorded under `voices/` and must be revisited if the upstream model or intended use changes.

`voice.assignment_strategy` is `round_robin`, so the example's three script variants use female, male, female narrators. Set it to `default_only` to use `voice.default_profile_id` for every video. Each voice job records its profile, model, speaker, synthesis settings, and license record.

Piper remains supported as an offline fallback, but it is no longer the example default because the tested US voices sound more synthetic. Voice quality remains subjective; listen to both selected Kokoro speakers before production use. Adding another model requires a reviewed license record.

## Local assembly

The recommended local stack is:

- Ollama with the locally installed `llama3.1:8b` model for short-form script previews;
- Kokoro with alternating US female and male profiles for local speech generation without an inference fee;
- faster-whisper `small.en` for word-level narration timing;
- ASS active-word captions driven by faster-whisper word starts;
- FFmpeg for deterministic 1080x1920 H.264/AAC assembly;
- a JSON editing template such as `vertical-product-v1.template.json` for pacing, safe zones, captions, and audio rules.

This keeps deterministic work outside the language model. The first renderer uses one approved visual, narration audio, and word-timed ASS captions. It does not invent footage: the blurred fixture background is the current single-image test input. The next renderer increment should accept an ordered timeline of approved video and image assets, with per-clip trim points, vertical crop rules, transitions, and optional B-roll. That timeline should first be validated with repository-owned local clips, then reused for operator-supplied or explicitly licensed footage. Music is disabled until an input and mixing path are implemented. Remotion remains a later option only if template complexity outgrows maintainable FFmpeg filters.

The existing local faster-whisper worker is the caption-timing source after local TTS produces narration. O.R.I.O.N. disables VAD for clean synthesized input because VAD can discard valid speech; other transcription workflows keep the worker's existing VAD default. Approved-script tokens replace same-length recognition substitutions, while faster-whisper remains the timing authority. Caption phrases are balanced into two to four words and split at sentence boundaries, so a new sentence never appears in the previous sentence's caption. Each active-word event lasts until the next measured word start, so pauses do not make the highlight run ahead of narration.

Kokoro synthesizes each sentence independently and inserts 280 ms of exact PCM silence between sentences. This prevents run-on delivery while preserving word timings. Profiles can tune `speed` and `sentence_pause_ms` without changing application code.

Mac engine setup:

```bash
brew install ffmpeg-full espeak-ng
python3 -m venv .venv-product-video
.venv-product-video/bin/python -m pip install --upgrade pip
.venv-product-video/bin/python -m pip install -r services/product-video-agent/requirements.txt
.venv-product-video/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('small.en', device='cpu', compute_type='int8')"
/opt/homebrew/bin/python3.12 -m venv .venv-product-video-kokoro
.venv-product-video-kokoro/bin/python -m pip install --upgrade pip
.venv-product-video-kokoro/bin/python -m pip install -r services/product-video-agent/requirements-kokoro.txt
npm run product-video:doctor
```

`ffmpeg-full` is keg-only and can coexist with the smaller Homebrew `ffmpeg` formula. O.R.I.O.N. auto-detects its Apple Silicon or Intel Homebrew path because the regular formula omits the ASS/libass caption filter. The doctor rejects FFmpeg builds without that filter.

The first approved Kokoro narration downloads and caches the model under `data/runtime/product-video-agent/models/kokoro/`; later generations reuse it. The faster-whisper prefetch downloads the local alignment model once. Neither operation uses paid inference. The resulting WAV paths and selected profiles are recorded in the manifest.

### Mac resource profile

The lead Mac mini is an Apple M4 with 10 CPU cores, 16 GB unified memory, and 125 GiB free disk as checked on 2026-07-20. Its durable O.R.I.O.N. worktree is `/Users/Agent/Workspace/ruflo-product-video-agent`; phase-numbered worktree names are not used. Keep local assembly sequential: `llama3.1:8b` uses about 4.9 GB when loaded, so the configuration sends `keep_alive: 0s` to unload it after each script response; Kokoro, faster-whisper `small.en` on CPU with `int8`, and FFmpeg then run one after another.

O.R.I.O.N. serializes its own local model, narration, caption, and render work with a service-local media lock. It also calls Ollama's local `/api/ps` endpoint immediately before work and stops when any model is already loaded. It does not inspect, reschedule, lock, or modify leadgen, qualification, or other agent workflows.

```bash
npm run product-video:preflight
```

The command exits with status `0` when the local model is free and `75` when video work should not start. Scheduling is intentionally deferred until repeated manual end-to-end tests prove the workflow and resource profile.

## Media storage strategy

Current Mac runtime files are under `data/runtime/product-video-agent/`:

- `<run-id>/manifest.json` and named decision/revision manifests contain structured workflow state;
- `assets/*.wav` contains local narration and future active-job media;
- `captions/*.words.json` and `captions/*.ass` contain timing and rendered-caption inputs;
- `renders/*.mp4` contains local previews and masters;
- `models/kokoro/` contains the reusable Kokoro model cache.

The directory is Git-ignored but currently unbounded. Ollama and faster-whisper also maintain their own reusable model caches outside this directory. Do not move active files to a cloud-synced folder while FFmpeg is using them; archive completed jobs only after hash verification.

Use a hybrid cache when Supabase persistence is added:

- Store products, rights/provenance, hashes, approvals, jobs, object paths, costs, and analytics in Postgres.
- Store footage, images, narration, captions, music, sound effects, render previews, and final masters in private Supabase Storage buckets, not database rows.
- Keep only active-job inputs, models, and recent outputs on the Mac. Verify every download by SHA-256 and evict completed scratch files after upload and a retention window.
- Keep reusable rights-approved library assets cached by content hash; do not repeatedly download identical media.
- Use resumable uploads for video files and RLS-protected private buckets. Keep the service-role key backend-only.

Supabase's free tier includes only 1 GB file storage and limits individual files to 50 MB, so meaningful video production will likely require Pro or another S3-compatible object store. Storage and egress remain paid resources and need spend monitoring. See [Supabase Storage](https://supabase.com/docs/guides/storage), [upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits), and [Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

## Music and sound effects

The current renderer has no background-music or sound-effect input and contains no song-specific blacklist. When audio mixing is implemented, the editor should choose a useful highlight or high-energy section based on beats/onsets instead of always starting at timestamp zero, duck music below narration, and use sparse transition/impact effects rather than constant sound effects.

`Paris` by Else remains a requested creative option, not a hardcoded rejection. The implementation decision is still open: add it later through a platform's own licensed Shorts/Reels audio workflow, or bake an operator-supplied track into a reusable master with recorded source and usage context. Those routes are not equivalent. YouTube states that music added outside its Shorts creation tools can receive standard Content ID claims or copyright removal requests, while its in-product Shorts library has Shorts-specific licensing. Instagram states that some business accounts and commercial posts cannot use its licensed music library. See [YouTube Shorts rights-holder guidance](https://support.google.com/youtube/answer/13053317) and [Instagram licensed music access](https://www.facebook.com/help/instagram/402084904469945).

## Discord channels

Create one category named `O.R.I.O.N. Video Factory` with these text channels:

- `orion-intake`: product candidates, manual imports, and commands.
- `orion-review`: operator-only script, asset-rights, music/SFX, render, spending, and publishing approval cards.
- `orion-renders`: publication-candidate previews and completed local render links after the applicable gates pass.
- `orion-lab`: internal editor-test footage, voice comparisons, template experiments, and watermarked non-publishable renders.
- `orion-ops`: runtime readiness, manual-run status, model/lock stops, failures, disk/cache status, and production costs.
- `orion-analytics`: later platform views, retention, clicks, conversions, revenue, and per-video ROI.

Put the six channel IDs in `config/discord/.env` using the `DISCORD_ORION_*_CHANNEL_ID` variables. The bot does not need the category ID. Product-video approval cards now target the `orionReview` channel key; live posting remains disabled until the IDs and persistence handler are connected.

## Approval sequence

1. Run the local preview and inspect script cards.
2. Apply a script decision to the saved manifest.
3. Execute approved narration; Kokoro and faster-whisper run locally and the render approval changes from `blocked` to `pending`.
4. Regenerate the render card from the narrated manifest.
5. Apply the render decision.
6. Execute the approved FFmpeg render.

Example commands:

```bash
node services/product-video-agent/index.mjs --revise-script data/runtime/product-video-agent/<run-id>/manifest.json --script-variant-id script-variant-... --script-file services/product-video-agent/fixtures/cyboris-s11-operator-script.json --actor operator-name --reason "Rewrite approved by operator" --write-manifest data/runtime/product-video-agent/<run-id>/revised.json
node services/product-video-agent/index.mjs --decide-workflow data/runtime/product-video-agent/<run-id>/revised.json --task-id TASK-ORION-SCRIPT-... --decision approve --actor operator-name --reason "Approved for local narration" --write-manifest data/runtime/product-video-agent/<run-id>/script-approved.json
npm run product-video:approved-narration -- data/runtime/product-video-agent/<run-id>/script-approved.json --script-variant-id script-variant-... --write-manifest data/runtime/product-video-agent/<run-id>/narrated.json
node services/product-video-agent/index.mjs --approval-cards --manifest data/runtime/product-video-agent/<run-id>/narrated.json
node services/product-video-agent/index.mjs --decide-workflow data/runtime/product-video-agent/<run-id>/narrated.json --task-id TASK-ORION-RENDER-... --decision approve --actor operator-name --reason "Approved for local fixture render" --write-manifest data/runtime/product-video-agent/<run-id>/render-approved.json
npm run product-video:approved-render -- data/runtime/product-video-agent/<run-id>/render-approved.json --script-variant-id script-variant-... --write-manifest data/runtime/product-video-agent/<run-id>/rendered.json
```

Discord cards reuse the existing Ruflo embed and button format. Blocked asset and render cards disable approval. This increment builds and validates card payloads but does not automatically post them or persist button decisions; live Discord-to-manifest persistence is the next integration step.

The target production flow removes unnecessary pre-render friction for zero-cost local jobs: approve the script/assets, render locally, upload the preview to private storage or `orion-renders`, then request a separate publication approval in `orion-review`. Approval publishes through the selected platform adapter; rejection retains or deletes the preview according to the configured retention policy. Do not upload private drafts to social platforms before approval when a Discord attachment or short-lived signed object-storage URL can provide the same review surface without an external platform action.

## Approval gates

Script use, asset use, rendering, paid usage, publishing, account changes, and external actions require the applicable approval. A publication draft can never become publish-ready merely because a local render exists. Supabase writes, licensed remote acquisition, Discord posting, and publishing remain non-operational.

## Test

```bash
npm run test:product-video-agent
```
