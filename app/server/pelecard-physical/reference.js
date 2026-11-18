import { createHash } from 'node:crypto';

// Pelecard retains at most 19 ParamX characters. Use the same stable reference
// for dispatch and lookup; legacy intents retain their original UUID lookup.
export function directParamX(intentId) {
  return createHash('sha256').update(intentId).digest('base64url').slice(0, 19);
}

export function expectedParamX(intent) {
  return intent.uidRecoveryEnabled === true ? directParamX(intent.id) : intent.id;
}
