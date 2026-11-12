import { PHYSICAL_MERCHANT_PREFIX } from './workflow.js';

export function readPhysicalConfig(env) {
  if (env.PELECARD_PHYSICAL_ENABLED !== 'true') return { enabled: false };
  const user = env.PELECARD_PHYSICAL_USER;
  const password = env.PELECARD_PHYSICAL_PASSWORD;
  if (typeof user !== 'string' || !user || typeof password !== 'string' || !password)
    throw new Error('physical_credentials_required');
  const terminal = env.PELECARD_PHYSICAL_TERMINAL;
  if (typeof terminal !== 'string' || !/^\d{10}$/.test(terminal))
    throw new Error('physical_terminal_required');
  // The public gateway documentation does not identify the cloud-device
  // command, authentication, status, or cancellation contract. Fail closed.
  throw new Error('physical_provider_contract_unconfirmed');
}

export const physicalMerchantPrefix = PHYSICAL_MERCHANT_PREFIX;
