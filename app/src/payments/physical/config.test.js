import { describe, expect, test } from 'vitest';
import { readPhysicalConfig } from '../../../server/pelecard-physical/config.js';

describe('physical configuration', () => {
  test('is disabled without an explicit physical flag', () => {
    expect(readPhysicalConfig({}).enabled).toBe(false);
  });
  test('never falls back to hosted credentials', () => {
    expect(() => readPhysicalConfig({ PELECARD_PHYSICAL_ENABLED: 'true', PELECARD_LIVE_USER: 'hosted', PELECARD_LIVE_PASSWORD: 'hosted' })).toThrow('physical_credentials_required');
  });
  test('requires provider contract activation in addition to credentials', () => {
    expect(() => readPhysicalConfig({ PELECARD_PHYSICAL_ENABLED: 'true', PELECARD_PHYSICAL_USER: 'user', PELECARD_PHYSICAL_PASSWORD: 'pass' })).toThrow('physical_provider_contract_unconfirmed');
  });
});
