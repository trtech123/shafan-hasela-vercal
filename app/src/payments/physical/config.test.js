import { describe, expect, test } from 'vitest';
import { readPhysicalConfig } from '../../../server/pelecard-physical/config.js';

describe('physical configuration', () => {
  test('is disabled without an explicit physical flag', () => {
    expect(readPhysicalConfig({}).enabled).toBe(false);
  });
  test('never falls back to hosted credentials', () => {
    expect(() => readPhysicalConfig({ PELECARD_PHYSICAL_ENABLED: 'true', PELECARD_LIVE_USER: 'hosted', PELECARD_LIVE_PASSWORD: 'hosted' })).toThrow('physical_credentials_required');
  });
  test('requires a second explicit financial dispatch gate', () => {
    expect(readPhysicalConfig({ PELECARD_PHYSICAL_ENABLED: 'true', PELECARD_PHYSICAL_USER: 'user', PELECARD_PHYSICAL_PASSWORD: 'pass', PELECARD_PHYSICAL_TERMINAL: '2814926015' }).dispatchEnabled).toBe(false);
  });
  test('the physical terminal number must be independently configured', () => {
    expect(() => readPhysicalConfig({ PELECARD_PHYSICAL_ENABLED: 'true', PELECARD_PHYSICAL_USER: 'user', PELECARD_PHYSICAL_PASSWORD: 'pass', PELECARD_LIVE_TERMINAL: '2814926015' })).toThrow('physical_terminal_required');
  });
  test('live transport needs explicit approval and a long-lived worker', () => {
    const base = { PELECARD_PHYSICAL_ENABLED: 'true', PELECARD_PHYSICAL_USER: 'user', PELECARD_PHYSICAL_PASSWORD: 'pass', PELECARD_PHYSICAL_TERMINAL: '2814926015', PELECARD_PHYSICAL_DISPATCH_ENABLED: 'true' };
    expect(() => readPhysicalConfig(base)).toThrow('physical_worker_duration_required');
    expect(readPhysicalConfig({ ...base, PELECARD_PHYSICAL_WORKER_MAX_MS: '330000' })).toMatchObject({
      enabled: true, dispatchEnabled: true, terminalNumber: '2814926015', workerMaxMs: 330000,
    });
  });
  test('controlled acceptance requires an exact order and amount pair', () => {
    const base = { PELECARD_PHYSICAL_ENABLED: 'true', PELECARD_PHYSICAL_USER: 'user',
      PELECARD_PHYSICAL_PASSWORD: 'pass', PELECARD_PHYSICAL_TERMINAL: '2814926015' };
    const orderId = '44444444-4444-4444-8444-444444444444';
    expect(() => readPhysicalConfig({ ...base, PELECARD_PHYSICAL_ACCEPTANCE_ORDER_ID: orderId }))
      .toThrow('physical_acceptance_scope_invalid');
    expect(() => readPhysicalConfig({ ...base, PELECARD_PHYSICAL_ACCEPTANCE_ORDER_ID: orderId,
      PELECARD_PHYSICAL_ACCEPTANCE_AMOUNT_MINOR: '0' })).toThrow('physical_acceptance_scope_invalid');
    expect(() => readPhysicalConfig({ ...base, PELECARD_PHYSICAL_TERMINAL: '0000000000',
      PELECARD_PHYSICAL_ACCEPTANCE_ORDER_ID: orderId,
      PELECARD_PHYSICAL_ACCEPTANCE_AMOUNT_MINOR: '1500' })).toThrow('physical_acceptance_scope_invalid');
    expect(readPhysicalConfig({ ...base, PELECARD_PHYSICAL_ACCEPTANCE_ORDER_ID: orderId,
      PELECARD_PHYSICAL_ACCEPTANCE_AMOUNT_MINOR: '1500' })).toMatchObject({
      acceptanceOrderId: orderId, acceptanceAmountMinor: 1500 });
  });
});
