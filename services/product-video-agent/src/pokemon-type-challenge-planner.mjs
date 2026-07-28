import { createTypePairKey, DISALLOWED_TYPE_PAIR_KEYS, normalizeTypePair } from './pokemon-type-pairs.mjs';
import { POKE_QUIZZ_ASSET_LAYOUT } from './poke-quizz-asset-layout.mjs';

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'poke-quizz-default-seed')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createPrng(seedInput) {
  let seed = hashSeed(seedInput) || 1;
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let result = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleArray(values, count, random) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items.slice(0, count);
}

function getTemplateSelectionConfig(template) {
  const typePairPolicy = template.selection_rules?.type_pair_policy || {};
  return {
    generationScope: template.selection_rules?.generation_scope || [1],
    disallowedPairs: new Set(
      (typePairPolicy.disallowed_type_pairs || [])
        .map((pair) => createTypePairKey(pair)),
    ),
    minCatalogMatches: Number(typePairPolicy.min_catalog_matches || 1),
    selectedSubjectsMin: Number(typePairPolicy.selected_subjects_min || 1),
    selectedSubjectsMax: Number(typePairPolicy.selected_subjects_max || 4),
  };
}

function buildPairCatalog(rows, config) {
  const pairCatalog = new Map();

  for (const row of rows) {
    if (!config.generationScope.includes(row.generation)) continue;
    if (!row.national_dex_number || !row.name || !Array.isArray(row.types)) continue;
    if (row.types.length !== 2) continue;

    const pair = normalizeTypePair(row.types);
    const pairKey = createTypePairKey(pair);
    if (DISALLOWED_TYPE_PAIR_KEYS.has(pairKey) || config.disallowedPairs.has(pairKey)) {
      continue;
    }

    const existing = pairCatalog.get(pairKey) || { pair, matches: [] };
    existing.matches.push(row);
    pairCatalog.set(pairKey, existing);
  }

  return [...pairCatalog.values()]
    .filter((entry) => entry.matches.length >= config.minCatalogMatches)
    .sort((left, right) => left.pair.join('|').localeCompare(right.pair.join('|')));
}

function pickPair(pairCatalog, forcedTypePair, random) {
  if (forcedTypePair) {
    const pairKey = createTypePairKey(forcedTypePair);
    const forced = pairCatalog.find((entry) => createTypePairKey(entry.pair) === pairKey);
    if (!forced) {
      throw new Error(`No eligible Pokemon match the requested type pair: ${forcedTypePair.join(' / ')}.`);
    }
    return forced;
  }

  if (pairCatalog.length === 0) {
    throw new Error('No eligible Pokemon type pairs were found in the grounded Pokedex catalog.');
  }

  return pairCatalog[Math.floor(random() * pairCatalog.length)];
}

function buildTypeIconRecord(type, sourceUrl) {
  return {
    type,
    local_path: `${POKE_QUIZZ_ASSET_LAYOUT.typeIcons}/${type}.gif`,
    source_url: sourceUrl || null,
  };
}

function buildSubjectAssetRecord(subject) {
  return {
    pokedex_id: subject.id,
    national_dex_number: subject.national_dex_number,
    name: subject.name,
    sprite_path: subject.sprite_path,
    silhouette_path: subject.silhouette_path,
    cry_path: subject.cry_path,
    sprite_source_url: subject.sprite_source_url,
    silhouette_source_url: subject.silhouette_source_url,
    cry_source_url: subject.cry_source_url,
  };
}

export function planPokemonTypeChallenge({ template, pokedexRows, seed = 'poke-quizz', forcedTypePair = null }) {
  const config = getTemplateSelectionConfig(template);
  const random = createPrng(seed);
  const pairCatalog = buildPairCatalog(pokedexRows, config);
  const selectedPair = pickPair(pairCatalog, forcedTypePair, random);
  const selectedSubjectCount = Math.max(
    config.selectedSubjectsMin,
    Math.min(config.selectedSubjectsMax, selectedPair.matches.length),
  );
  const selectedSubjects = sampleArray(selectedPair.matches, selectedSubjectCount, random)
    .sort((left, right) => left.national_dex_number - right.national_dex_number);

  const firstSubjectTypeIcons = selectedPair.matches[0]?.metadata?.type_icon_source_urls || [];
  const typeIcons = selectedPair.pair.map((type, index) => (
    buildTypeIconRecord(type, firstSubjectTypeIcons[index])
  ));

  const requiredAssetGaps = [];
  if (!selectedSubjects.every((subject) => subject.silhouette_path || subject.sprite_path)) {
    requiredAssetGaps.push('pokemon_silhouette_or_sprite_local_assets_missing');
  }
  if (!selectedSubjects.every((subject) => subject.sprite_path)) {
    requiredAssetGaps.push('pokemon_reveal_sprite_local_assets_missing');
  }
  requiredAssetGaps.push(
    'background_missing',
    'battle_intro_music_missing',
    'countdown_sfx_missing',
    'timer_end_sfx_missing',
    'reveal_sfx_missing',
  );

  return {
    schema_version: 'poke-quizz-plan-v1',
    channel: {
      id: 'poke-quizz',
      name: 'Poke Quizz',
      niche: 'pokemon_quiz',
      content_lane: 'pokemon_type_challenge',
    },
    template_id: template.template_id,
    generation_scope: config.generationScope,
    seed: String(seed),
    selection: {
      type_pair: selectedPair.pair,
      catalog_match_count: selectedPair.matches.length,
      selected_subject_count: selectedSubjects.length,
      selected_subjects: selectedSubjects.map((subject) => ({
        pokedex_id: subject.id,
        national_dex_number: subject.national_dex_number,
        name: subject.name,
        generation: subject.generation,
        region: subject.region,
        types: subject.types,
      })),
    },
    narration: {
      local_model_required: false,
      tts_provider: 'kokoro',
      lines: [
        { role: 'hook', text: template.question_contract.hook_text },
        { role: 'prompt', text: template.question_contract.type_prompt_text },
        { role: 'reveal', text: template.question_contract.reveal_text },
      ],
    },
    timeline: [
      {
        phase: 'hook',
        duration_seconds: 1.2,
        spoken_text: template.question_contract.hook_text,
        on_screen_text: template.question_contract.hook_text,
      },
      {
        phase: 'type_prompt',
        duration_seconds: 1.6,
        spoken_text: template.question_contract.type_prompt_text,
        on_screen_text: template.question_contract.type_prompt_text,
      },
      {
        phase: 'countdown',
        duration_seconds: template.layout.timer.countdown_from,
        countdown_from: template.layout.timer.countdown_from,
        countdown_to: template.layout.timer.countdown_to,
      },
      {
        phase: 'reveal',
        duration_seconds: 2.4,
        spoken_text: template.question_contract.reveal_text,
        reveal_mode: 'swap_silhouette_sprites_for_colored_sprites_and_play_sound',
      },
    ],
    assets: {
      background: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.backgrounds,
        selected_path: null,
      },
      type_icons: typeIcons,
      pokemon: selectedSubjects.map((subject) => buildSubjectAssetRecord(subject)),
      audio: {
        battle_intro_music_directory: POKE_QUIZZ_ASSET_LAYOUT.battleIntroMusic,
        sound_effects_directory: POKE_QUIZZ_ASSET_LAYOUT.soundEffects,
      },
      outputs: {
        previews_directory: POKE_QUIZZ_ASSET_LAYOUT.previews,
        masters_directory: POKE_QUIZZ_ASSET_LAYOUT.masters,
      },
    },
    required_asset_gaps: [...new Set(requiredAssetGaps)],
  };
}
