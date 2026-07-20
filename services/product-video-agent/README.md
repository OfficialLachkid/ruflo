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

The fixture deliberately includes an Amazon video reference with `rights_status: unverified`; its acquisition plan is blocked and it is excluded from every render job. A separate repository-authored PPM image is rights-verified, operator-approved, and SHA-256 checked so the renderer can be tested without third-party media. Validated remote download execution remains deferred.

Research note, 2026-07-20: Amazon's current [Operating Agreement](https://affiliate-program.amazon.com/help/operating/agreement/), [Program Policies and IP License](https://affiliate-program.amazon.com/help/operating/policies), and [Participation Requirements](https://affiliate-program.amazon.com/help/operating/participation/) do not provide a clear grant to download arbitrary page-visible listing videos and repost them to third-party short-form platforms. The IP license is limited to Program Content Amazon makes available under its program and restricts downloading, redistribution, and sublicensing. Treat a listing video as unverified unless the specific Amazon program/API terms or the rights holder provide written permission for the intended platform use. This operational rule is not legal advice and must be rechecked against the applicable marketplace and account terms.

## Selected voice

The selected default is `en_US-ljspeech-high`, a single-speaker US English female voice. Its [upstream Piper model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/high/MODEL_CARD) identifies the LJ Speech training dataset as public domain. The Piper voice repository is MIT-licensed and the local Piper engine is GPL-3.0. These facts and the commercial-use review are recorded in `voices/en_US-ljspeech-high.license.json`.

`en_US-lessac-medium` is intentionally not used. Its linked dataset license is research-only and explicitly excludes commercial use, which is incompatible with affiliate content.

The selected voice is expected to sound natural enough for the first short-form template, but voice quality is subjective. Generate a local sample before production use; switching voices requires a new reviewed license record.

## Local assembly

The recommended local stack is:

- Ollama with the locally installed `llama3.1:8b` model for short-form script previews;
- Piper with `en_US-ljspeech-high` for zero-cost speech generation;
- faster-whisper `small.en` for word-level narration timing;
- ASS karaoke captions for animated word highlighting;
- FFmpeg for deterministic 1080x1920 H.264/AAC assembly;
- a JSON editing template such as `vertical-product-v1.template.json` for pacing, safe zones, captions, and audio rules.

This keeps deterministic work outside the language model. The first renderer uses one approved visual, narration audio, and word-timed ASS captions. Music is disabled until a rights-approved local track exists. Remotion remains a later option only if template complexity outgrows maintainable FFmpeg filters.

The existing local faster-whisper worker is the preferred first caption-timing source after Piper produces narration. This avoids adding a cloud alignment provider.

Mac engine setup:

```bash
brew install ffmpeg
python3 -m venv .venv-product-video
.venv-product-video/bin/python -m pip install --upgrade pip
.venv-product-video/bin/python -m pip install -r services/product-video-agent/requirements.txt
mkdir -p data/runtime/product-video-agent/models/piper
.venv-product-video/bin/python -m piper.download_voices en_US-ljspeech-high --data-dir data/runtime/product-video-agent/models/piper
.venv-product-video/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('small.en', device='cpu', compute_type='int8')"
npm run product-video:doctor
```

The voice download creates both the `.onnx` model and `.onnx.json` configuration. The faster-whisper prefetch downloads the local alignment model once. Neither command uses paid inference.

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
