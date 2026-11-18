import test from 'node:test';
import assert from 'node:assert/strict';
import { directParamX } from './reference.js';

test('direct J4 reference is stable, exactly 19 lowercase alphanumeric characters', () => {
  const id = '833db2d6-18b1-4d66-bbcd-4360b95a315c';
  const reference = directParamX(id);
  assert.match(reference, /^[0-9a-z]{19}$/);
  assert.equal(reference, directParamX(id));
});

test('50,000 distinct intents produce distinct J4 references', () => {
  const references = new Set();
  for (let i = 0; i < 50_000; i++) {
    const id = `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
    references.add(directParamX(id));
  }
  assert.equal(references.size, 50_000);
});
