import test from 'node:test';
import assert from 'node:assert/strict';
import { planPokemonTypeChallenge } from '../src/pokemon-type-challenge-planner.mjs';

const template = {
  template_id: 'pokemon-type-challenge-v1',
  selection_rules: {
    generation_scope: [1, 2],
    type_pair_policy: {
      disallowed_type_pairs: [
        ['normal', 'ice'],
      ],
      min_catalog_matches: 1,
      selected_subjects_min: 1,
      selected_subjects_max: 4,
    },
  },
  question_contract: {
    hook_text: 'Guess the Pokemon',
    type_prompt_text: 'Which Pokemon matches these two types?',
    reveal_text: "Who's that Pokemon?",
  },
  layout: {
    timer: {
      countdown_from: 5,
      countdown_to: 0,
    },
  },
};

const pokedexRows = [
  {
    id: 'pokedex-0001',
    national_dex_number: 1,
    name: 'Bulbasaur',
    generation: 1,
    region: 'kanto',
    types: ['grass', 'poison'],
    sprite_path: null,
    silhouette_path: null,
    cry_path: null,
    sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/001.png',
    silhouette_source_url: null,
    cry_source_url: null,
    metadata: {
      type_icon_source_urls: [
        'https://www.serebii.net/pokedex-bw/type/grass.gif',
        'https://www.serebii.net/pokedex-bw/type/poison.gif',
      ],
    },
  },
  {
    id: 'pokedex-0002',
    national_dex_number: 2,
    name: 'Ivysaur',
    generation: 1,
    region: 'kanto',
    types: ['grass', 'poison'],
    sprite_path: null,
    silhouette_path: null,
    cry_path: null,
    sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/002.png',
    silhouette_source_url: null,
    cry_source_url: null,
    metadata: {
      type_icon_source_urls: [
        'https://www.serebii.net/pokedex-bw/type/grass.gif',
        'https://www.serebii.net/pokedex-bw/type/poison.gif',
      ],
    },
  },
  {
    id: 'pokedex-0169',
    national_dex_number: 169,
    name: 'Crobat',
    generation: 2,
    region: 'johto',
    types: ['poison', 'flying'],
    sprite_path: null,
    silhouette_path: null,
    cry_path: null,
    sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/169.png',
    silhouette_source_url: null,
    cry_source_url: null,
    metadata: {
      type_icon_source_urls: [
        'https://www.serebii.net/pokedex-bw/type/poison.gif',
        'https://www.serebii.net/pokedex-bw/type/flying.gif',
      ],
    },
  },
  {
    id: 'pokedex-0176',
    national_dex_number: 176,
    name: 'Togetic',
    generation: 2,
    region: 'johto',
    types: ['fairy', 'flying'],
    sprite_path: null,
    silhouette_path: null,
    cry_path: null,
    sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/176.png',
    silhouette_source_url: null,
    cry_source_url: null,
    metadata: {
      type_icon_source_urls: [
        'https://www.serebii.net/pokedex-bw/type/fairy.gif',
        'https://www.serebii.net/pokedex-bw/type/flying.gif',
      ],
    },
  },
];

test('planner selects an observed dual-type pair and emits asset gap guidance', () => {
  const plan = planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'grass-poison-test',
    forcedTypePair: ['grass', 'poison'],
  });

  assert.equal(plan.channel.name, 'Poke Quizz');
  assert.deepEqual(plan.selection.type_pair, ['grass', 'poison']);
  assert.equal(plan.selection.catalog_match_count, 2);
  assert.equal(plan.selection.selected_subject_count, 2);
  assert.equal(plan.assets.type_icons[0].local_path.includes('Type Icons'), true);
  assert.ok(plan.required_asset_gaps.includes('background_missing'));
  assert.ok(plan.required_asset_gaps.includes('pokemon_reveal_sprite_local_assets_missing'));
});

test('planner rejects disallowed or absent type pairs', () => {
  assert.throws(
    () => planPokemonTypeChallenge({
      template,
      pokedexRows,
      seed: 'invalid',
      forcedTypePair: ['normal', 'ice'],
    }),
    /No eligible Pokemon match/u,
  );
});
