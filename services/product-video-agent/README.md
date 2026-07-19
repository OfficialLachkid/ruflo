# O.R.I.O.N. Product Video Agent

Phase 0 contracts and a short-form-first Phase 1 local preview pipeline for product-video planning.

## What exists

The service imports one manual fixture, normalizes it into provider-independent records, scores the product, creates local script/TTS/render plans, applies asset-rights gates, creates approval-gated publication drafts, and writes a reviewable manifest.

The default dry run executes no marketplace API, browser automation, model, TTS, FFmpeg, Supabase, affiliate, or publishing call. An explicit local-preview command may call only the loopback Ollama endpoint. The fixture is synthetic and no credentials are required.

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

The checked-in `config.example.json` contains no secrets. It uses the Mac's installed `llama3.1:8b` model and plans Piper and FFmpeg work with execution disabled. Piper is pinned in `requirements.txt` and expected in the repository-local `.venv-product-video` environment.

## Contracts and adapters

`src/schemas.mjs` defines the product, source snapshot, product score, asset provenance, script variant, script job, voice-over job, render job, affiliate link, publication approval, publication, analytics snapshot, and output manifest contracts.

`ProductProviderAdapter` is the marketplace/provider boundary. The Phase 1 implementation is `FixtureProductProviderAdapter`; future permitted marketplace integrations must normalize to the same contracts without leaking provider-specific payloads downstream.

`ProductVideoStateStore` is the persistence boundary. `FileProductVideoStateStore` is active. `SupabaseProductVideoStateStore` is an explicit non-operational stub so later persistence can be added without changing pipeline entities. Backend Supabase credentials must remain runtime-only.

## Asset and Amazon video policy

A visible product video is not automatically reusable media. Amazon-, merchant-, customer-, or creator-hosted assets stay blocked when rights are unverified, evidence is absent, operator approval is pending, or the local file is unavailable.

The dry run creates an asset-acquisition plan for each referenced file. A plan may become download-eligible only after all of these are true:

- the source permits the retrieval method and no anti-bot control is bypassed;
- the rights holder or applicable license explicitly permits the planned reuse;
- the evidence and attribution requirements are stored on the asset record;
- the asset-usage approval state is `approved`.

The Phase 1 fixture deliberately includes an Amazon video reference with `rights_status: unverified`; its acquisition plan is blocked and it is excluded from every render job. Download execution remains a Phase 2 adapter with content-type, size, checksum, and redirect validation.

Research note, 2026-07-20: Amazon's current [Operating Agreement](https://affiliate-program.amazon.com/help/operating/agreement/), [Program Policies and IP License](https://affiliate-program.amazon.com/help/operating/policies), and [Participation Requirements](https://affiliate-program.amazon.com/help/operating/participation/) do not provide a clear grant to download arbitrary page-visible listing videos and repost them to third-party short-form platforms. The IP license is limited to Program Content Amazon makes available under its program and restricts downloading, redistribution, and sublicensing. Treat a listing video as unverified unless the specific Amazon program/API terms or the rights holder provide written permission for the intended platform use. This operational rule is not legal advice and must be rechecked against the applicable marketplace and account terms.

## Local assembly direction

The recommended local stack is:

- Ollama with the locally installed `llama3.1:8b` model for short-form script previews;
- Piper for zero-cost speech generation after a voice model is installed;
- FFmpeg for deterministic assembly, caption burn-in, audio mixing, and 1080x1920 H.264 output;
- a JSON editing template such as `vertical-product-v1.template.json` for pacing, safe zones, captions, and audio rules.

This keeps deterministic work outside the language model. A later renderer should compile an approved script, approved local assets, word-level caption timings, and the template into an FFmpeg filter graph. Remotion is a reasonable later option if template complexity outgrows FFmpeg, but it adds a browser/Node rendering layer that is unnecessary for the first template.

The existing local faster-whisper worker is the preferred first caption-timing source after Piper produces narration. This avoids adding a cloud alignment provider.

Mac engine setup:

```bash
brew install ffmpeg
python3 -m venv .venv-product-video
.venv-product-video/bin/python -m pip install -r services/product-video-agent/requirements.txt
```

Voice files remain separate from the engine. Do not enable synthesis until the selected voice model's license and intended commercial/affiliate use have been recorded. Once approved, download both the `.onnx` model and `.onnx.json` configuration into `data/runtime/product-video-agent/models/piper`.

## Approval gates

Paid usage, publishing, account changes, external actions, and asset usage require explicit approval. A publication draft can never become publish-ready merely because a render plan exists. The runtime must separately confirm completed rendering and an approved publication record.

## Test

```bash
npm run test:product-video-agent
```
