const DEFAULT_SEREBII_GEN1_SOURCE_URL = 'https://www.serebii.net/pokemon/gen1pokemon.shtml';

const ROW_PATTERN = /<tr>\s*<td align="center" class="fooinfo">\s*#(\d{4})\s*<\/td>\s*<td align="center" class="fooinfo">.*?<img src="([^"]+)"[^>]*>.*?<\/td>\s*<td align="center" class="fooinfo">\s*<a href="\/pokemon\/([^"]+)">([^<]+)<\/a>\s*<\/td>\s*<td align="center" class="fooinfo">(.*?)<\/td>\s*<td align="center" class="fooinfo">(.*?)<\/td>\s*<td align="center" class="fooinfo">(\d+)<\/td>\s*<td align="center" class="fooinfo">(\d+)<\/td>\s*<td align="center" class="fooinfo">(\d+)<\/td>\s*<td align="center" class="fooinfo">(\d+)<\/td>\s*<td align="center" class="fooinfo">(\d+)<\/td>\s*<td align="center" class="fooinfo">(\d+)<\/td>\s*<\/tr>/gsu;

function normalizeText(value) {
  return decodeHtmlEntities(String(value || '').replace(/\s+/gu, ' ').trim());
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/gu, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 10)))
    .replace(/&#x([0-9a-f]+);/giu, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)))
    .replace(/&amp;/gu, '&')
    .replace(/&apos;|&#39;/gu, '\'')
    .replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&nbsp;/gu, ' ');
}

function buildAbsoluteUrl(sourceUrl, assetPath) {
  return new URL(assetPath, sourceUrl).toString();
}

export function parseSerebiiGen1Pokedex(html, options = {}) {
  const sourceUrl = options.sourceUrl || DEFAULT_SEREBII_GEN1_SOURCE_URL;
  const rows = [];

  for (const match of html.matchAll(ROW_PATTERN)) {
    const [
      ,
      dexText,
      spriteSourcePath,
      slug,
      name,
      typeHtml,
      abilitiesHtml,
      hp,
      attack,
      defense,
      specialAttack,
      specialDefense,
      speed,
    ] = match;

    const nationalDexNumber = Number.parseInt(dexText, 10);
    const types = [...typeHtml.matchAll(/\/pokemon\/type\/([^"]+)/gu)]
      .map((item) => item[1]?.trim())
      .filter(Boolean);
    if (!nationalDexNumber || !slug || !name || types.length < 1) {
      continue;
    }

    const abilities = [...abilitiesHtml.matchAll(/>([^<]+)<\/a>/gu)]
      .map((item) => normalizeText(item[1]))
      .filter(Boolean);

    rows.push({
      id: `pokedex-${dexText}`,
      national_dex_number: nationalDexNumber,
      slug: slug.trim(),
      name: normalizeText(name),
      generation: 1,
      region: 'kanto',
      types,
      sprite_path: null,
      silhouette_path: null,
      shiny_sprite_path: null,
      cry_path: null,
      sprite_source_url: buildAbsoluteUrl(sourceUrl, spriteSourcePath),
      silhouette_source_url: null,
      shiny_sprite_source_url: null,
      cry_source_url: null,
      asset_status: 'core_facts_seeded',
      metadata: {
        source_name: 'serebii',
        source_page_url: sourceUrl,
        display_dex_number: `#${dexText}`,
        typing_basis: 'current_canonical_types_from_serebii_gen1_page',
        abilities,
        base_stats: {
          hp: Number.parseInt(hp, 10),
          attack: Number.parseInt(attack, 10),
          defense: Number.parseInt(defense, 10),
          special_attack: Number.parseInt(specialAttack, 10),
          special_defense: Number.parseInt(specialDefense, 10),
          speed: Number.parseInt(speed, 10),
        },
        missing_sources: [
          'silhouette_source_url',
          'shiny_sprite_source_url',
          'cry_source_url',
        ],
      },
    });
  }

  return rows;
}

export async function fetchSerebiiGen1Pokedex(options = {}) {
  const sourceUrl = options.sourceUrl || DEFAULT_SEREBII_GEN1_SOURCE_URL;
  const fetchImpl = options.fetch || globalThis.fetch;
  const response = await fetchImpl(sourceUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch Serebii Gen 1 page (${response.status}).`);
  }
  return parseSerebiiGen1Pokedex(await response.text(), { sourceUrl });
}

export { DEFAULT_SEREBII_GEN1_SOURCE_URL };
