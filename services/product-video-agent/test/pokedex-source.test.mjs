import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSerebiiGen1Pokedex } from '../src/pokedex-source.mjs';

const SAMPLE_HTML = `
<table class="dextable" align="center">
  <tr>
    <td align="center" class="fooinfo">#0001</td>
    <td align="center" class="fooinfo"><table class="pkmn"><tr><td><a href="/pokemon/bulbasaur"><img src="/scarletviolet/pokemon/new/small/001.png" loading="lazy" style="height:120px" /></a></td></tr></table></td>
    <td align="center" class="fooinfo"><a href="/pokemon/bulbasaur">Bulbasaur</a></td>
    <td align="center" class="fooinfo"><a href="/pokemon/type/grass"><img src="/pokedex-bw/type/grass.gif" /></a> <a href="/pokemon/type/poison"><img src="/pokedex-bw/type/poison.gif" /></a></td>
    <td align="center" class="fooinfo"><a href="/abilitydex/overgrow.shtml">Overgrow</a> <br /><a href="/abilitydex/chlorophyll.shtml">Chlorophyll</a></td>
    <td align="center" class="fooinfo">45</td>
    <td align="center" class="fooinfo">49</td>
    <td align="center" class="fooinfo">49</td>
    <td align="center" class="fooinfo">65</td>
    <td align="center" class="fooinfo">65</td>
    <td align="center" class="fooinfo">45</td>
  </tr>
  <tr>
    <td align="center" class="fooinfo">#0029</td>
    <td align="center" class="fooinfo"><table class="pkmn"><tr><td><a href="/pokemon/nidoranf"><img src="/swordshield/pokemon/small/029.png" loading="lazy" style="height:120px" /></a></td></tr></table></td>
    <td align="center" class="fooinfo"><a href="/pokemon/nidoranf">Nidoran&#9792;</a></td>
    <td align="center" class="fooinfo"><a href="/pokemon/type/poison"><img src="/pokedex-bw/type/poison.gif" /></a></td>
    <td align="center" class="fooinfo"><a href="/abilitydex/poisonpoint.shtml">Poison Point</a> <br /><a href="/abilitydex/rivalry.shtml">Rivalry</a> <br /><a href="/abilitydex/hustle.shtml">Hustle</a></td>
    <td align="center" class="fooinfo">55</td>
    <td align="center" class="fooinfo">47</td>
    <td align="center" class="fooinfo">52</td>
    <td align="center" class="fooinfo">40</td>
    <td align="center" class="fooinfo">40</td>
    <td align="center" class="fooinfo">41</td>
  </tr>
</table>
`;

test('Serebii Gen 1 parser emits truth-only pokedex rows', () => {
  const rows = parseSerebiiGen1Pokedex(SAMPLE_HTML);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].national_dex_number, 1);
  assert.equal(rows[0].sprite_source_url, 'https://www.serebii.net/scarletviolet/pokemon/new/small/001.png');
  assert.deepEqual(rows[0].types, ['grass', 'poison']);
  assert.equal(rows[1].name, 'Nidoran♀');
  assert.deepEqual(rows[1].types, ['poison']);
  assert.equal(rows[1].metadata.typing_basis, 'current_canonical_types_from_serebii_gen1_page');
  assert.deepEqual(rows[1].metadata.abilities, ['Poison Point', 'Rivalry', 'Hustle']);
});
