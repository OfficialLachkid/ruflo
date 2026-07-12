import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStarterDesignEntries,
  getMissingStarterDesignEntries,
  mergeLibraries,
} from '../../apps/website-builder/src/storage.js';

test('createStarterDesignEntries returns reusable design records for imported templates', () => {
  const starterDesigns = createStarterDesignEntries();

  assert.ok(starterDesigns.length >= 2);
  assert.ok(starterDesigns.every((entry) => entry.kind === 'design'));
  assert.ok(starterDesigns.some((entry) => entry.id === 'starter-design-panorama-landing'));
  assert.ok(starterDesigns.some((entry) => entry.id === 'starter-design-trust-signals'));
});

test('getMissingStarterDesignEntries excludes starter designs that already exist', () => {
  const starterDesigns = createStarterDesignEntries();
  const missingDesigns = getMissingStarterDesignEntries({
    designs: [starterDesigns[0]],
    websites: [],
  });

  assert.equal(missingDesigns.some((entry) => entry.id === starterDesigns[0].id), false);
  assert.ok(missingDesigns.length >= 1);
});

test('mergeLibraries keeps preferred entries first while preserving missing fallback entries', () => {
  const merged = mergeLibraries(
    {
      designs: [{ id: 'design-1', kind: 'design', title: 'Remote', templateId: 'panorama-landing', draft: {} }],
      websites: [],
    },
    {
      designs: [{ id: 'design-2', kind: 'design', title: 'Local', templateId: 'trust-signals', draft: {} }],
      websites: [],
    }
  );

  assert.deepEqual(merged.designs.map((entry) => entry.id), ['design-1', 'design-2']);
});
