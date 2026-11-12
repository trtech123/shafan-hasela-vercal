import { describe, expect, test, vi } from 'vitest';
import { createPhysicalPelecardProvider } from '../../../server/pelecard-physical/provider.js';

const config = { terminalNumber: '2814926015', user: 'physical-user', password: 'physical-secret' };
function provider(fetcher) { return createPhysicalPelecardProvider({ ...config, fetcher }); }

describe('physical Pelecard provider boundary', () => {
  test('never dispatches an undocumented card-read command', async () => {
    const fetcher = vi.fn();
    await expect(provider(fetcher).send({ register: '004', amountMinor: 2400, intentId: 'intent-1' }))
      .rejects.toThrow('physical_device_dispatch_contract_required');
    expect(fetcher).not.toHaveBeenCalled();
  });
  test('uses the documented EMV ParamX lookup with physical credentials', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ StatusCode: '000', UserData: [] }), { status: 200 }));
    await provider(fetcher).lookupByParamX('physical-intent-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://gateway21.pelecard.biz/services/CheckGoodParamXEMV');
    expect(JSON.parse(options.body)).toEqual({ ...config, paramX: 'physical-intent-1', shvaSuccessOnly: 'true', ShowJ5Reversal: 'False' });
  });
  test('rejects invalid correlation before network access', async () => {
    const fetcher = vi.fn();
    await expect(provider(fetcher).lookupByParamX('')).rejects.toThrow('physical_lookup_reference_invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });
  test('projects only approved safe fields from the EMV detail result', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ StatusCode: '000', ResultData: {
      UID: '123456789', Amount: '2400', termNo: '004', pan: '4111111111111111', track2: 'secret',
    } }), { status: 200 }));
    const detail = await provider(fetcher).getTransactionDetails('123456789');
    expect(detail).toEqual({ StatusCode: '000', UID: '123456789', Amount: '2400', termNo: '004' });
    expect(JSON.stringify(detail)).not.toContain('4111111111111111');
    expect(JSON.stringify(detail)).not.toContain('secret');
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://gateway21.pelecard.biz/services/GetTransDetailsEMV');
    expect(JSON.parse(options.body)).toMatchObject({ terminalNumber: '2814926015', debitTrxId: '123456789' });
  });
  test('never returns a nested card-bearing status payload', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      StatusCode: { pan: '4111111111111111' }, UserData: [{ track2: 'secret' }],
    }), { status: 200 }));
    const result = await provider(fetcher).lookupByParamX('physical-intent-1');
    expect(result).toEqual({ StatusCode: null, records: [] });
    expect(JSON.stringify(result)).not.toMatch(/4111111111111111|secret/);
  });
});
