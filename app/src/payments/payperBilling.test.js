import { describe, expect, test } from 'vitest';
import { billingReviewIssues, validIsraeliIdentity } from './payperBilling';

describe('prepayment billing review', () => {
  test('preserves leading zeros in valid individual identities', () => {
    expect(validIsraeliIdentity('000000018')).toBe(true);
    expect(validIsraeliIdentity('000000019')).toBe(false);
  });

  test('lets an individual pay without identity but requires manual document review', () => {
    expect(billingReviewIssues({ kind: 'person', name: 'Example', identity: '', email: 'a@example.org' }))
      .toContain('identity');
  });

  test('accepts a nine-digit company registration value and identifies invalid contact email', () => {
    expect(billingReviewIssues({ kind: 'organization', name: 'Example Ltd', identity: '512783333', email: 'a@example.org' }))
      .toEqual([]);
    expect(billingReviewIssues({ kind: 'organization', name: 'Example Ltd', identity: '512783333', email: 'bad' }))
      .toContain('email');
  });
});
