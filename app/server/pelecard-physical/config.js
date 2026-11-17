import { PHYSICAL_MERCHANT_PREFIX } from './workflow.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readPhysicalConfig(env) {
  if (env.PELECARD_PHYSICAL_ENABLED !== 'true')
    return { enabled: false, hostedEnabled: false, hostedInitEnabled: false };
  const user = env.PELECARD_PHYSICAL_USER;
  const password = env.PELECARD_PHYSICAL_PASSWORD;
  if (typeof user !== 'string' || !user || typeof password !== 'string' || !password)
    throw new Error('physical_credentials_required');
  const terminal = env.PELECARD_PHYSICAL_TERMINAL;
  if (typeof terminal !== 'string' || !/^\d{10}$/.test(terminal))
    throw new Error('physical_terminal_required');
  // Appendix D documents the PINPAD J4 request. Financial dispatch has a
  // second gate so device readiness cannot authorize a charge by itself.
  const dispatchEnabled = env.PELECARD_PHYSICAL_DISPATCH_ENABLED === 'true';
  const payperEnabled = env.PELECARD_PHYSICAL_DIRECT_PAYPER_ENABLED === 'true';
  const acceptanceOrderId = env.PELECARD_PHYSICAL_ACCEPTANCE_ORDER_ID ?? null;
  const acceptanceAmountRaw = env.PELECARD_PHYSICAL_ACCEPTANCE_AMOUNT_MINOR ?? null;
  const acceptanceAmountMinor = Number(acceptanceAmountRaw);
  if ((acceptanceOrderId !== null || acceptanceAmountRaw !== null) &&
    (terminal !== '2814926015' || !uuid.test(acceptanceOrderId ?? '') ||
      typeof acceptanceAmountRaw !== 'string' || !/^[1-9][0-9]*$/.test(acceptanceAmountRaw) ||
      !Number.isSafeInteger(acceptanceAmountMinor) || acceptanceAmountMinor > 2_147_483_647))
    throw new Error('physical_acceptance_scope_invalid');
  const hostedEnabled = env.PELECARD_PHYSICAL_HOSTED_ENABLED === 'true';
  const hostedInitEnabled = hostedEnabled &&
    env.PELECARD_PHYSICAL_HOSTED_INIT_ENABLED === 'true';
  let hostedUrls = null;
  if (hostedEnabled) {
    let returned, callback;
    try {
      returned = new URL(env.PELECARD_PHYSICAL_HOSTED_RETURN_URL);
      callback = new URL(env.PELECARD_PHYSICAL_HOSTED_CALLBACK_BASE);
    } catch { throw new Error('physical_hosted_urls_required'); }
    if (returned.protocol !== 'https:' || callback.protocol !== 'https:' ||
      returned.origin !== callback.origin || returned.pathname !== '/payment/physical' ||
      callback.pathname !== '/api/pelecard-physical-callback' ||
      returned.search || callback.search || returned.hash || callback.hash ||
      returned.username || callback.username || returned.password || callback.password)
      throw new Error('physical_hosted_urls_invalid');
    hostedUrls = { goodUrl: returned.href, errorUrl: returned.href, callbackBase: callback.href };
  }
  const workerMaxMs = Number(env.PELECARD_PHYSICAL_WORKER_MAX_MS || 0);
  if (dispatchEnabled && (!Number.isSafeInteger(workerMaxMs) || workerMaxMs < 330_000))
    throw new Error('physical_worker_duration_required');
  return { enabled: true, dispatchEnabled, payperEnabled, hostedEnabled, hostedInitEnabled,
    hostedUrls, terminalNumber: terminal, user, password, workerMaxMs,
    acceptanceOrderId, acceptanceAmountMinor: acceptanceOrderId ? acceptanceAmountMinor : null };
}

export const physicalMerchantPrefix = PHYSICAL_MERCHANT_PREFIX;
