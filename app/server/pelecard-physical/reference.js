import { createHash } from 'node:crypto';

// Pelecard retains at most 19 ParamX characters. Lowercase base36 uses only
// digits and letters already observed in the live UUID prefix, with about
// 98 bits of identifier space. Legacy intents retain their original lookup.
export function directParamX(intentId) {
  const digest = createHash('sha256').update(intentId).digest('hex');
  return (BigInt(`0x${digest}`) % (36n ** 19n)).toString(36).padStart(19, '0');
}

export function expectedParamX(intent) {
  return intent.uidRecoveryEnabled === true ? directParamX(intent.id) : intent.id;
}
