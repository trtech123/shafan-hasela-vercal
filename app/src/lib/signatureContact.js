import { normalizeIsraeliId } from './israeliId.js';

const allowed = new Set(['phone', 'email', 'organization', 'signerId']);

export function normalizeSignatureContact(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.has(key))) throw new Error('invalid_contact_details');
  const result = {};
  for (const key of ['phone', 'email', 'organization']) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue;
    if (typeof input[key] !== 'string') throw new Error('invalid_contact_details');
    const value = input[key].trim().normalize('NFC');
    if (!value || /[\p{Cc}\p{Cf}<>]/u.test(value)) throw new Error('invalid_contact_details');
    if (key === 'phone' && (value.length > 24 || !/^\+?[0-9 ()-]{9,24}$/.test(value) || value.replace(/\D/g, '').length < 9)) throw new Error('invalid_contact_details');
    if (key === 'email' && (value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw new Error('invalid_contact_details');
    if (key === 'organization' && value.length > 300) throw new Error('invalid_contact_details');
    result[key] = key === 'email' ? value.toLowerCase() : value;
  }
  if (input.signerId !== undefined && input.signerId !== null && input.signerId !== '') {
    const signerId = normalizeIsraeliId(input.signerId);
    if (!signerId) throw new Error('invalid_signer_id');
    result.signerId = signerId;
  }
  return result;
}
