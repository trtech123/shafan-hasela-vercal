// Pelecard Services API. Appendix D documents the card-present PINPAD J4
// variant with empty card fields and a five-minute response window.
import { buildPhysicalPayperParameters } from './hosted-contract.js';
import { projectDirectFirstResponse } from './direct-first-response.js';
const BASE = 'https://gateway21.pelecard.biz/services/';
const DEBIT = `${BASE}DebitRegularType`;
const LOOKUP = `${BASE}CheckGoodParamXEMV`;
const DETAILS = `${BASE}GetTransDetailsEMV`;
const reference = /^[A-Za-z0-9_-]{1,100}$/;
const transactionId = /^[A-Za-z0-9_-]{1,100}$/;
const registerNumber = /^(003|004|005|006)$/;
const safeFields = new Set([
  'StatusCode', 'OriginaTrxId', 'TerminalNumber', 'termNo', 'PelecardTransactionId',
  'ShvaResult', 'ShvaResultEmv', 'DebitTotal', 'Amount', 'DebitCurrency', 'currency',
  'DebitApproveNumber', 'AuthNo', 'UID', 'Uid', 'AdditionalDetailsParamX', 'JParam',
  'ParameterJ', 'VoucherId', 'status', 'ErrorCode', 'retailer', 'amount', 'uid',
]);

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function statusCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(value) ? value : null;
}
function safeProjection(value) {
  if (!object(value)) return null;
  const entries = Object.entries(value).filter(([key, item]) =>
    safeFields.has(key) && (typeof item === 'string' || typeof item === 'number'));
  return entries.length ? Object.fromEntries(entries) : null;
}

export function createPhysicalPelecardProvider({ terminalNumber, user, password, fetcher = fetch }) {
  if (!/^\d{10}$/.test(terminalNumber) || typeof user !== 'string' || !user ||
    typeof password !== 'string' || !password) throw new Error('physical_credentials_required');
  const credentials = { terminalNumber, user, password };

  async function post(url, body, timeoutMs = 10_000) {
    const response = await fetcher(url, {
      // The official request builder POSTs raw JSON using jQuery's default
      // form content type; Appendix D's sample does the same.
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: JSON.stringify({ ...credentials, ...body }), redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error('physical_lookup_unavailable');
    const raw = await response.text();
    if (raw.length > 1_000_000) throw new Error('physical_lookup_response_too_large');
    let decoded;
    try { decoded = JSON.parse(raw); } catch { throw new Error('physical_lookup_response_invalid'); }
    if (!object(decoded)) throw new Error('physical_lookup_response_invalid');
    return decoded;
  }

  return {
    async send({ merchantTerminal, register, amountMinor, intentId, payperSource }) {
      if (merchantTerminal !== terminalNumber || !registerNumber.test(register) ||
        !Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 2_147_483_647 ||
        typeof intentId !== 'string' || !reference.test(intentId))
        throw new Error('physical_dispatch_invalid');
      if (payperSource && (payperSource.id !== intentId ||
        payperSource.register !== register || payperSource.amountMinor !== amountMinor))
        throw new Error('physical_payper_source_mismatch');
      // All fields in Appendix D's J4 example are serialized. In particular,
      // card number and expiry are present as empty strings, never as raw data.
      const body = await post(DEBIT, {
        shopNumber: register, creditCard: '', creditCardDateMmYy: '', token: '',
        total: String(amountMinor), currency: '1', cvv2: '', id: '',
        authorizationNumber: '', paramX: intentId, QAResultStatus: '',
        eci: '', xid: '', cavv: '',
        ...(payperSource ? { PayperParameters: buildPhysicalPayperParameters(payperSource) } : {}),
      }, 300_000);
      return { ...safeProjection(body), StatusCode: statusCode(body.StatusCode),
        firstResponse: projectDirectFirstResponse(body) };
    },
    async lookupByParamX(paramX) {
      if (typeof paramX !== 'string' || !reference.test(paramX))
        throw new Error('physical_lookup_reference_invalid');
      const body = await post(LOOKUP, { paramX, shvaSuccessOnly: 'true', ShowJ5Reversal: 'False' });
      const records = Array.isArray(body.UserData) ? body.UserData.map(safeProjection).filter(Boolean) : [];
      return { StatusCode: statusCode(body.StatusCode), records };
    },
    async getTransactionDetails(debitTrxId) {
      if (typeof debitTrxId !== 'string' || !transactionId.test(debitTrxId))
        throw new Error('physical_transaction_id_invalid');
      const body = await post(DETAILS, { debitTrxId, Uid: '', UserKey: '', AuthNo: '', token: '' });
      return { ...safeProjection(body.ResultData ?? body.Output ?? body), StatusCode: statusCode(body.StatusCode) };
    },
    async getTransactionDetailsByUid(uid) {
      if (typeof uid !== 'string' || !transactionId.test(uid))
        throw new Error('physical_uid_invalid');
      const body = await post(DETAILS, { debitTrxId: '', Uid: uid, UserKey: '', AuthNo: '', token: '' });
      return { ...safeProjection(body.ResultData ?? body.Output ?? body), StatusCode: statusCode(body.StatusCode) };
    },
    async inspect(intent) {
      if (!intent || typeof intent.id !== 'string' || !reference.test(intent.id) ||
        !registerNumber.test(intent.register) || !Number.isSafeInteger(intent.amountMinor))
        throw new Error('physical_intent_invalid');
      const found = await this.lookupByParamX(intent.id);
      // A successful transport/status lookup alone cannot establish approval.
      // Until Pelecard supplies concrete EMV examples, accept only one row with
      // every correlation field and an explicit approved Shva result.
      if (found.StatusCode !== '000' || found.records.length !== 1)
        throw new Error(`physical_result_unverified_${found.StatusCode ?? 'unknown'}_${Math.min(found.records.length, 99)}`);
      const row = found.records[0];
      const approvalId = String(row.DebitApproveNumber ?? '');
      const providerTransactionId = String(row.PelecardTransactionId ?? '');
      const uid = String(row.UID ?? row.Uid ?? '');
      if (String(row.TerminalNumber ?? '') !== terminalNumber ||
        String(row.DebitTotal ?? '') !== String(intent.amountMinor) ||
        row.AdditionalDetailsParamX !== intent.id ||
        String(row.ShvaResult ?? '') !== '000' ||
        !transactionId.test(providerTransactionId) || !transactionId.test(uid) ||
        !transactionId.test(approvalId))
        throw new Error('physical_result_unverified');
      // CheckGoodParamXEMV's output guide does not include a register field.
      // Resolve the UID through GetTransDetailsEMV and correlate termNo there.
      const detail = await this.getTransactionDetailsByUid(uid);
      if (detail.StatusCode !== '000' ||
        String(detail.UID ?? detail.Uid ?? detail.uid ?? '') !== uid ||
        String(detail.termNo ?? '') !== intent.register ||
        String(detail.Amount ?? detail.amount ?? '') !== String(intent.amountMinor) ||
        String(detail.retailer ?? '') !== terminalNumber)
        throw new Error('physical_result_unverified');
      return { status: 'approved', intentId: intent.id, merchantTerminal: terminalNumber,
        register: intent.register, amountMinor: intent.amountMinor, transactionId: providerTransactionId, approvalId, uid };
    },
  };
}
