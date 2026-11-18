import { describe, expect, test, vi } from 'vitest';
import { createPhysicalPelecardProvider } from '../../../server/pelecard-physical/provider.js';
import { directParamX } from '../../../server/pelecard-physical/reference.js';

const config = { terminalNumber: '2814926015', user: 'physical-user', password: 'physical-secret' };
function provider(fetcher) { return createPhysicalPelecardProvider({ ...config, fetcher }); }

describe('physical Pelecard provider boundary', () => {
  test('serializes Appendix D PINPAD J4 with empty card fields and five-minute timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ StatusCode: '000', PelecardTransactionId: '12345',
      ShvaResult: '000', DebitTotal: '2400', AdditionalDetailsParamX: directParamX('intent-1'), CreditCardNumber: 'masked', shvaOutput: 'private' }), { status: 200 }));
    const result = await provider(fetcher).send({ merchantTerminal: '2814926015', register: '004', amountMinor: 2400, intentId: 'intent-1', uidRecoveryEnabled: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://gateway21.pelecard.biz/services/DebitRegularType');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded; charset=UTF-8');
    expect(JSON.parse(options.body)).toEqual({ ...config, shopNumber: '004', creditCard: '', creditCardDateMmYy: '',
      token: '', total: '2400', currency: '1', cvv2: '', id: '', authorizationNumber: '', paramX: directParamX('intent-1'),
      QAResultStatus: '', eci: '', xid: '', cavv: '' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(300_000);
    timeout.mockRestore();
    expect(result).toMatchObject({ StatusCode: '000', PelecardTransactionId: '12345', ShvaResult: '000',
      DebitTotal: '2400', AdditionalDetailsParamX: directParamX('intent-1'),
      firstResponse: { payment: { transactionId: '12345', amountMinor: 2400 },
        document: { state: 'reconciliation_required' } } });
    expect(JSON.stringify(result)).not.toMatch(/masked|private/);
  });
  test('rejects malformed dispatch before network access', async () => {
    const fetcher = vi.fn();
    await expect(provider(fetcher).send({ merchantTerminal: '2814926015', register: '4', amountMinor: 2400, intentId: 'intent-1' }))
      .rejects.toThrow('physical_dispatch_invalid');
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
  test('independently accepts only a fully correlated EMV approval', async () => {
    const fetcher = vi.fn(async url => new Response(JSON.stringify(url.endsWith('CheckGoodParamXEMV')
      ? { StatusCode: '000', UserData: [{ TerminalNumber: '2814926015', DebitTotal: '2400',
        AdditionalDetailsParamX: 'intent-1', PelecardTransactionId: 'trx-1', UID: 'uid-1',
        ShvaResult: '000', DebitApproveNumber: 'approved-1', pan: '4111111111111111' }] }
      : { StatusCode: '000', ResultData: { UID: 'uid-1', termNo: '004', Amount: '2400',
        retailer: '2814926015', track2: 'secret' } }), { status: 200 }));
    expect(await provider(fetcher).inspect({ id: 'intent-1', register: '004', amountMinor: 2400 })).toEqual({
      status: 'approved', intentId: 'intent-1', merchantTerminal: '2814926015',
      register: '004', amountMinor: 2400, transactionId: 'trx-1', approvalId: 'approved-1', uid: 'uid-1',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ Uid: 'uid-1', debitTrxId: '' });
  });
  test('missing register or conflicting lookup rows remain uncertain', async () => {
    const record = { TerminalNumber: '2814926015', DebitTotal: '2400', AdditionalDetailsParamX: 'intent-1',
      PelecardTransactionId: 'trx-1', UID: 'uid-1', ShvaResult: '000', DebitApproveNumber: 'approved-1' };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ StatusCode: '000', UserData: [record] }), { status: 200 }));
    await expect(provider(fetcher).inspect({ id: 'intent-1', register: '004', amountMinor: 2400 })).rejects.toThrow('physical_result_unverified');
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ StatusCode: '000', UserData: [
      { ...record, termNo: '004' }, { ...record, termNo: '004', PelecardTransactionId: 'trx-2' },
    ] }), { status: 200 }));
    await expect(provider(fetcher).inspect({ id: 'intent-1', register: '004', amountMinor: 2400 })).rejects.toThrow('physical_result_unverified');
  });
  test('EMV detail with a different register cannot approve', async () => {
    const fetcher = vi.fn(async url => new Response(JSON.stringify(url.endsWith('CheckGoodParamXEMV')
      ? { StatusCode: '000', UserData: [{ TerminalNumber: '2814926015', DebitTotal: '2400',
        AdditionalDetailsParamX: 'intent-1', PelecardTransactionId: 'trx-1', UID: 'uid-1',
        ShvaResult: '000', DebitApproveNumber: 'approved-1' }] }
      : { StatusCode: '000', ResultData: { UID: 'uid-1', termNo: '006', Amount: '2400', retailer: '2814926015' } }), { status: 200 }));
    await expect(provider(fetcher).inspect({ id: 'intent-1', register: '004', amountMinor: 2400 }))
      .rejects.toThrow('physical_result_unverified');
  });
});
