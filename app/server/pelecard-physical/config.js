import { PHYSICAL_MERCHANT_TERMINAL } from './workflow.js';

export function readPhysicalConfig(env) {
  if (env.PELECARD_PHYSICAL_ENABLED !== 'true') return { enabled: false };
  const user = env.PELECARD_PHYSICAL_USER;
  const password = env.PELECARD_PHYSICAL_PASSWORD;
  if (typeof user !== 'string' || !user || typeof password !== 'string' || !password)
    throw new Error('physical_credentials_required');
  // The public gateway documentation does not identify the cloud-device
  // command, authentication, status, or cancellation contract. Fail closed.
  throw new Error('physical_provider_contract_unconfirmed');
}

export const physicalMerchantTerminal = PHYSICAL_MERCHANT_TERMINAL;
