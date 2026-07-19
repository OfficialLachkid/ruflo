# O.R.I.O.N. Product Video Agent

Phase 0 contracts and the smallest useful Phase 1 local dry-run pipeline for product-video planning.

## What exists

The service imports one manual fixture, normalizes it into provider-independent records, scores the product, creates local script/TTS/render plans, applies asset-rights gates, creates approval-gated publication drafts, and writes a reviewable manifest.

No marketplace API, browser automation, model, TTS, FFmpeg, Supabase, affiliate, or publishing call is executed. The fixture is synthetic and no credentials are required.

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

The checked-in `config.example.json` contains no secrets. It plans local Ollama, Piper, and FFmpeg work with `execute: false`.

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

## Local assembly direction

The recommended local stack is:

- Ollama for script generation after the operator selects a locally installed model;
- Piper for zero-cost speech generation after a voice model is installed;
- FFmpeg for deterministic assembly, caption burn-in, audio mixing, and 1080x1920 H.264 output;
- a JSON editing template such as `vertical-product-v1.template.json` for pacing, safe zones, captions, and audio rules.

This keeps deterministic work outside the language model. A later renderer should compile an approved script, approved local assets, word-level caption timings, and the template into an FFmpeg filter graph. Remotion is a reasonable later option if template complexity outgrows FFmpeg, but it adds a browser/Node rendering layer that is unnecessary for the first template.

## Approval gates

Paid usage, publishing, account changes, external actions, and asset usage require explicit approval. A publication draft can never become publish-ready merely because a render plan exists. The runtime must separately confirm completed rendering and an approved publication record.

## Test

```bash
npm run test:product-video-agent
```
