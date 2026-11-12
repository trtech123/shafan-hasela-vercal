// Read-only portions of Pelecard's documented Services API. DebitRegularType
// remains blocked: its public J4 schema requires card and expiry inputs and
// does not document how a cloud device initiates card reading without them.
const BASE = 'https://gateway21.pelecard.biz/services/';
const LOOKUP = `${BASE}CheckGoodParamXEMV`;
const DETAILS = `${BASE}GetTransDetailsEMV`;
const reference = /^[A-Za-z0-9_-]{1,100}$/;
const transactionId = /^[A-Za-z0-9_-]{1,100}$/;
const safeFields = new Set([
  'StatusCode', 'OriginaTrxId', 'TerminalNumber', 'termNo', 'PelecardTransactionId',
  'ShvaResult', 'ShvaResultEmv', 'DebitTotal', 'Amount', 'DebitCurrency', 'currency',
  'DebitApproveNumber', 'AuthNo', 'UID', 'Uid', 'AdditionalDetailsParamX', 'JParam',
  'ParameterJ', 'VoucherId', 'status', 'ErrorCode',
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

  async function post(url, body) {
    const response = await fetcher(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials, ...body }), redirect: 'error',
      signal: AbortSignal.timeout(10_000),
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
    async send() {
      throw new Error('physical_device_dispatch_contract_required');
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
  };
}
