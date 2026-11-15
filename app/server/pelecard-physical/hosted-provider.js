import { buildHostedEmvRequest } from './hosted-contract.js';

const INIT = 'https://gateway21.pelecard.biz/PaymentGW/init';
const GET = 'https://gateway21.pelecard.biz/PaymentGW/GetTransaction';
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeTransaction = /^[A-Za-z0-9_-]{1,100}$/;
const fields = ['TransactionId', 'TransactionPelecardId', 'ShvaResult', 'ShvaResultEmv',
  'DebitTotal', 'DebitCurrency', 'Uid', 'DebitApproveNumber', 'ConfirmationKey',
  'AdditionalDetailsParamX'];

async function post(fetcher, url, body) {
  const response = await fetcher(url, { method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('physical_hosted_provider_unavailable');
  const raw = await response.text();
  if (raw.length > 65_536) throw new Error('physical_hosted_response_invalid');
  let decoded;
  try { decoded = JSON.parse(raw); } catch { throw new Error('physical_hosted_response_invalid'); }
  if (!decoded || Array.isArray(decoded) || typeof decoded !== 'object')
    throw new Error('physical_hosted_response_invalid');
  return decoded;
}

export function createHostedEmvProvider(credentials, fetcher = fetch) {
  return {
    async initialize(intent, urls) {
      const response = await post(fetcher, INIT, buildHostedEmvRequest(intent, credentials, urls));
      if (response.StatusCode != null && response.StatusCode !== '000')
        throw new Error('physical_hosted_init_rejected');
      if (typeof response.URL !== 'string' || typeof response.ConfirmationKey !== 'string' ||
        !/^[A-Za-z0-9_+/=-]{1,512}$/.test(response.ConfirmationKey))
        throw new Error('physical_hosted_response_invalid');
      let url;
      try { url = new URL(response.URL); } catch { throw new Error('physical_hosted_response_invalid'); }
      if (url.protocol !== 'https:' || url.hostname !== 'gateway21.pelecard.biz' ||
        url.pathname !== '/PaymentGW' || url.port || url.username || url.password || url.hash ||
        [...url.searchParams.keys()].join(',') !== 'transactionId')
        throw new Error('physical_hosted_url_invalid');
      const transactionId = url.searchParams.get('transactionId');
      if (!guid.test(transactionId) ||
        (response.TransactionId != null && response.TransactionId !== transactionId))
        throw new Error('physical_hosted_transaction_invalid');
      return { transactionId, confirmationKey: response.ConfirmationKey, redirectUrl: url.href };
    },
    async lookup(transactionId) {
      if (typeof transactionId !== 'string' || !safeTransaction.test(transactionId))
        throw new Error('physical_hosted_transaction_invalid');
      const body = await post(fetcher, GET, { terminal: credentials.terminal,
        user: credentials.user, password: credentials.password, TransactionId: transactionId });
      const input = body.ResultData;
      const result = {};
      if (input && !Array.isArray(input) && typeof input === 'object')
        for (const key of fields)
          if (typeof input[key] === 'string' || typeof input[key] === 'number') result[key] = input[key];
      return { StatusCode: typeof body.StatusCode === 'string' ? body.StatusCode : null,
        ResultData: result };
    },
  };
}
