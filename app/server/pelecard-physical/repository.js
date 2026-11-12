import { createPhysicalCartCalculator } from './cart.js';
import { createPhysicalRegisterResolver } from './device-settings.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const register = /^(003|004|005|006)$/;

function billingSnapshot(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'email,identity,kind,name' ||
    !['person', 'organization'].includes(value.kind) ||
    typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200 ||
    typeof value.identity !== 'string' || !/^\d{9}$/.test(value.identity) ||
    typeof value.email !== 'string' || value.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
    throw new Error('physical_billing_invalid');
  return { kind: value.kind, name: value.name.trim(), identity: value.identity, email: value.email };
}

function single(result) {
  if (result?.rows?.length !== 1) throw new Error('physical_database_result_invalid');
  return result.rows[0].result;
}

/** Service-role database adapter. No browser input is used as an amount or register. */
export function createPhysicalRepository(database) {
  return {
    registerForWorkstation: createPhysicalRegisterResolver(database),
    calculateCart: (cart, actorRole) => createPhysicalCartCalculator(database, actorRole)(cart),
    async reserve({ actorId, workstationId, requestKey, register: assigned, amountMinor, items, discount, billing }) {
      if (!uuid.test(actorId) || !uuid.test(requestKey) || !register.test(assigned) ||
        !Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 2_147_483_647)
        throw new Error('physical_reservation_invalid');
      const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date()).map(part => [part.type, part.value]));
      const snapshot = { schema_version: 1, items, discount,
        linked_order_info: null,
        sale_date: `${dateParts.year}-${dateParts.month}-${dateParts.day}` };
      const result = single(await database.query(
        'SELECT public.reserve_physical_payment($1::uuid,$2::uuid,$3::text,$4::integer,$5::jsonb,$6::jsonb) AS result',
        [actorId, requestKey, workstationId, amountMinor, snapshot, billingSnapshot(billing)]));
      if (!result || result.registerNumber !== assigned || !uuid.test(result.paymentId))
        throw new Error('physical_reservation_mismatch');
      return { id: result.paymentId, register: result.registerNumber,
        amountMinor, state: result.state };
    },
    async status(intentId) {
      if (!uuid.test(intentId)) throw new Error('physical_intent_invalid');
      const result = single(await database.query(
        'SELECT public.get_physical_worker_intent($1::uuid) AS result', [intentId]));
      return result;
    },
    async claimDispatch(intentId) {
      return single(await database.query(
        'SELECT public.claim_physical_dispatch($1::uuid) AS result', [intentId])) === true;
    },
    async markDispatched(intentId) {
      await database.query('SELECT public.mark_physical_pending($1::uuid)', [intentId]);
    },
    async markUncertain(intentId) {
      await database.query('SELECT public.mark_physical_uncertain($1::uuid)', [intentId]);
    },
    async markDeclined(intentId, result) {
      await database.query('SELECT public.observe_physical_result($1::uuid,$2::jsonb)', [intentId, result]);
    },
    async finalize(intentId, result) {
      await database.query('SELECT public.observe_physical_result($1::uuid,$2::jsonb)', [intentId, result]);
      const final = single(await database.query(
        'SELECT public.finalize_physical_payment($1::uuid) AS result', [intentId]));
      if (final?.state !== 'succeeded' || !final.saleId) throw new Error('physical_finalization_failed');
      return { saleId: final.saleId, documentState: 'provider_confirmation_required' };
    },
    async viewByRequest(actorId, requestKey) {
      if (!uuid.test(actorId) || !uuid.test(requestKey)) throw new Error('physical_request_invalid');
      return single(await database.query(
        'SELECT public.get_physical_payment_by_request($1::uuid,$2::uuid) AS result',
        [actorId, requestKey]));
    },
  };
}
