import { describe, expect, test } from 'vitest';
import { parseControlledLiveCallback } from './pelecard-live-callback.ts';

const expected = { paymentId: '11111111-1111-4111-8111-111111111111',
  transactionId: 'hosted-transaction-1', confirmationKey: 'stored-confirmation' };
const callback = (notice: unknown) => new Request(
  `https://edge.test/feedback?paymentId=${expected.paymentId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ result: JSON.stringify(notice) }),
  });

describe('hosted Pelecard callback correlation', () => {
  test('accepts the observed nested ResultData correlation shape', async () => {
    await expect(parseControlledLiveCallback(callback({ ResultData: {
      ConfirmationKey: expected.confirmationKey, TransactionId: expected.transactionId,
    } }), expected)).resolves.toBeUndefined();
  });
  test('accepts Pelecard documented raw JSON body with form content type', async () => {
    const request = new Request(`https://edge.test/feedback?paymentId=${expected.paymentId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: JSON.stringify({ ResultData: {
        ConfirmationKey: expected.confirmationKey, TransactionId: expected.transactionId,
      } }),
    });
    await expect(parseControlledLiveCallback(request, expected)).resolves.toBeUndefined();
  });
  test('rejects forged raw JSON correlation before provider verification', async () => {
    const request = new Request(`https://edge.test/feedback?paymentId=${expected.paymentId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: JSON.stringify({ ResultData: {
        ConfirmationKey: 'forged', TransactionId: expected.transactionId,
      } }),
    });
    await expect(parseControlledLiveCallback(request, expected)).rejects.toThrow('forged_callback');
  });
  test('rejects a nested callback with the wrong stored confirmation', async () => {
    await expect(parseControlledLiveCallback(callback({ ResultData: {
      ConfirmationKey: 'forged', TransactionId: expected.transactionId,
    } }), expected)).rejects.toThrow('forged_callback');
  });
  test('rejects conflicting root and nested correlation values', async () => {
    await expect(parseControlledLiveCallback(callback({
      ConfirmationKey: expected.confirmationKey,
      PelecardTransactionId: expected.transactionId,
      ResultData: { ConfirmationKey: 'forged', TransactionId: expected.transactionId },
    }), expected)).rejects.toThrow('forged_callback');
  });
});
