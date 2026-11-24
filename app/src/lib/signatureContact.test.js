import { describe, expect, it } from 'vitest';
import { normalizeSignatureContact } from './signatureContact';

describe('signed order contact completion', () => {
  it('keeps only bounded, normalized contact fields', () => {
    expect(normalizeSignatureContact({ phone: ' 050-1234567 ', email: ' QA@example.invalid ', organization: '  חברה  ', signerId: '012345674' }))
      .toEqual({ phone: '050-1234567', email: 'qa@example.invalid', organization: 'חברה', signerId: '012345674' });
  });
  it('rejects invalid identity and unknown fields before persistence', () => {
    expect(() => normalizeSignatureContact({ signerId: '012345675' })).toThrow();
    expect(() => normalizeSignatureContact({ customerId: 'attacker' })).toThrow();
  });
});
