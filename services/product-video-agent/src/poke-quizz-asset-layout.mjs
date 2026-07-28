export const ORION_T7_ROOT = '/Volumes/T7/O.R.I.O.N. Video Generation';

export const POKE_QUIZZ_ASSET_LAYOUT = Object.freeze({
  root: `${ORION_T7_ROOT}/Assets/Pokemon/Poke Quizz`,
  backgrounds: `${ORION_T7_ROOT}/Assets/Pokemon/Poke Quizz/Backgrounds`,
  sprites: `${ORION_T7_ROOT}/Assets/Pokemon/Poke Quizz/Sprites`,
  shinySprites: `${ORION_T7_ROOT}/Assets/Pokemon/Poke Quizz/Shiny Sprites`,
  silhouettes: `${ORION_T7_ROOT}/Assets/Pokemon/Poke Quizz/Silhouettes`,
  typeIcons: `${ORION_T7_ROOT}/Assets/Pokemon/Poke Quizz/Type Icons`,
  overlays: `${ORION_T7_ROOT}/Assets/Pokemon/Poke Quizz/Overlays`,
  transitions: `${ORION_T7_ROOT}/Assets/Pokemon/Poke Quizz/Transitions`,
  battleIntroMusic: `${ORION_T7_ROOT}/Assets/Audio/Music/Poke Quizz`,
  soundEffects: `${ORION_T7_ROOT}/Assets/Audio/Sound Effects/Poke Quizz`,
  previews: `${ORION_T7_ROOT}/Previews/Poke Quizz`,
  masters: `${ORION_T7_ROOT}/Masters/Poke Quizz`,
  templates: `${ORION_T7_ROOT}/Templates/Poke Quizz`,
});

export function formatDexNumber(value) {
  return String(Number.parseInt(String(value || 0), 10)).padStart(4, '0');
}

export function sanitizePokemonSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function generationDirectory(generation) {
  return `Generation ${Number.parseInt(String(generation || 0), 10)}`;
}

export function buildPokeQuizzSpritePath(row) {
  return `${POKE_QUIZZ_ASSET_LAYOUT.sprites}/${generationDirectory(row.generation)}/${formatDexNumber(row.national_dex_number)}-${sanitizePokemonSlug(row.slug)}.png`;
}

export function buildPokeQuizzShinySpritePath(row) {
  return `${POKE_QUIZZ_ASSET_LAYOUT.shinySprites}/${generationDirectory(row.generation)}/${formatDexNumber(row.national_dex_number)}-${sanitizePokemonSlug(row.slug)}.png`;
}

export function buildPokeQuizzSilhouettePath(row) {
  return `${POKE_QUIZZ_ASSET_LAYOUT.silhouettes}/${generationDirectory(row.generation)}/${formatDexNumber(row.national_dex_number)}-${sanitizePokemonSlug(row.slug)}.png`;
}

export function buildPokeQuizzTypeIconPath(typeName) {
  return `${POKE_QUIZZ_ASSET_LAYOUT.typeIcons}/${String(typeName || '').trim().toLowerCase()}.gif`;
}
