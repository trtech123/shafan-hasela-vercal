import { PHYSICAL_MERCHANT_PREFIX } from './workflow.js';

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
    hostedUrls, terminalNumber: terminal, user, password, workerMaxMs };
}

export const physicalMerchantPrefix = PHYSICAL_MERCHANT_PREFIX;
