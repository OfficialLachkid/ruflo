import test from 'node:test';
import assert from 'node:assert/strict';
import { isAssetCandidateFileName, selectTypeIconSet } from '../src/poke-quizz-asset-inventory.mjs';

test('asset inventory ignores hidden and AppleDouble metadata files', () => {
  assert.equal(isAssetCandidateFileName('grass.gif'), true);
  assert.equal(isAssetCandidateFileName('.DS_Store'), false);
  assert.equal(isAssetCandidateFileName('._grass.gif'), false);
  assert.equal(isAssetCandidateFileName(''), false);
});

test('type icon selection prefers 3D assets only when every requested type exists', () => {
  const inventory = {
    type_icons: {
      pixel: [
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/grass.gif',
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
      ],
      three_d: [
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/3D Types/grass.png',
      ],
    },
  };

  assert.deepEqual(selectTypeIconSet(['grass', 'poison'], inventory), {
    style: 'pixel',
    file_paths: [
      '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/grass.gif',
      '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
    ],
  });
});
