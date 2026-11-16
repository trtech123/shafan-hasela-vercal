import { createPhysicalCartCalculator } from './cart.js';
import { createPhysicalRegisterResolver } from './device-settings.js';
import { validIsraeliIdentity } from '../../src/payments/payperBilling.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const register = /^(003|004|005|006)$/;

function billingSnapshot(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'email,identity,kind,name' ||
    !['person', 'organization'].includes(value.kind) ||
    typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200 ||
    typeof value.identity !== 'string' || !/^\d{9}$/.test(value.identity) ||
    value.identity === '000000000' || (value.kind === 'person' && !validIsraeliIdentity(value.identity)) ||
    typeof value.email !== 'string' || value.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
    throw new Error('physical_billing_invalid');
  return { kind: value.kind, name: value.name.trim(), identity: value.identity,
    email: value.email, vatApplicable: true };
}

function single(result) {
  if (result?.rows?.length !== 1) throw new Error('physical_database_result_invalid');
  return result.rows[0].result;
}

/** Service-role database adapter. No browser input is used as an amount or register. */
export function createPhysicalRepository(database) {
  async function finishApproved(intentId) {
    const final = single(await database.query(
      'SELECT public.finalize_physical_payment($1::uuid) AS result', [intentId]));
    if (final?.state !== 'succeeded' || !final.saleId) throw new Error('physical_finalization_failed');
    return { saleId: final.saleId, documentState: 'provider_confirmation_required' };
  }
  return {
    registerForWorkstation: createPhysicalRegisterResolver(database),
    async reserveOrder({ actorId, workstationId, requestKey, register: assigned, orderId, amountMinor }) {
      if (!uuid.test(actorId) || !uuid.test(requestKey) || !uuid.test(orderId) ||
        !register.test(assigned) || !Number.isSafeInteger(amountMinor) ||
        amountMinor < 1 || amountMinor > 2_147_483_647)
        throw new Error('physical_reservation_invalid');
      const result = single(await database.query(
        'SELECT public.reserve_physical_order_payment($1::uuid,$2::uuid,$3::text,$4::uuid,$5::integer) AS result',
        [actorId, requestKey, workstationId, orderId, amountMinor]));
      if (!result || result.registerNumber !== assigned || result.orderId !== orderId ||
        result.amountMinor !== amountMinor || !uuid.test(result.paymentId))
        throw new Error('physical_reservation_mismatch');
      return { id: result.paymentId, register: result.registerNumber,
        orderId, amountMinor, state: result.state };
    },
    async listDevices() {
      const { rows } = await database.query(`
        SELECT d.register_number AS "registerNumber", d.model, d.label,
          d.cash_register_code AS "workstationCode"
        FROM public.physical_terminal_devices d
        JOIN public.cash_registers c ON c.code=d.cash_register_code
        WHERE d.enabled AND c.active ORDER BY d.register_number
      `);
      return rows;
    },
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
    async claimHostedInit(intentId) {
      if (!uuid.test(intentId)) throw new Error('physical_intent_invalid');
      return single(await database.query(
        'SELECT public.claim_physical_hosted_init($1::uuid) AS result', [intentId])) === true;
    },
    async hostedSource(intentId) {
      if (!uuid.test(intentId)) throw new Error('physical_intent_invalid');
      const source = single(await database.query(
        'SELECT public.get_physical_hosted_source($1::uuid) AS result', [intentId]));
      if (!source || source.id !== intentId) throw new Error('physical_hosted_source_unavailable');
      return source;
    },
    async persistHostedSession(intentId, session) {
      if (!uuid.test(intentId) || !session || typeof session.transactionId !== 'string' ||
        typeof session.confirmationKey !== 'string' || typeof session.redirectUrl !== 'string')
        throw new Error('physical_hosted_session_invalid');
      const saved = single(await database.query(
        'SELECT public.persist_physical_hosted_session($1::uuid,$2::text,$3::text,$4::text) AS result',
        [intentId, session.transactionId, session.confirmationKey, session.redirectUrl]));
      if (saved !== true) throw new Error('physical_hosted_session_unavailable');
    },
    async hostedDocumentState(intentId) {
      if (!uuid.test(intentId)) throw new Error('physical_intent_invalid');
      const { rows } = await database.query(
        'SELECT state FROM public.payper_document_ledger WHERE payment_id=$1::uuid', [intentId]);
      if (rows?.length !== 1) throw new Error('physical_document_hold_unavailable');
      return rows[0].state;
    },
    async recordHostedDocument(intentId, document) {
      if (!uuid.test(intentId) || document?.state !== 'succeeded')
        throw new Error('physical_document_invalid');
      const saved = single(await database.query(
        'SELECT public.record_physical_hosted_document($1::uuid,$2::text,$3::text,$4::text) AS result',
        [intentId, document.number, document.url, document.systemId]));
      if (saved !== true) throw new Error('physical_document_reconciliation_required');
    },
    async claimDispatch(intentId) {
      return single(await database.query(
        'SELECT public.claim_physical_dispatch($1::uuid) AS result', [intentId])) === true;
    },
    async directSource(intentId) {
      if (!uuid.test(intentId)) throw new Error('physical_intent_invalid');
      const source = single(await database.query(
        'SELECT public.get_physical_direct_source($1::uuid) AS result', [intentId]));
      if (!source || source.id !== intentId) throw new Error('physical_direct_source_unavailable');
      return source;
    },
    async persistFirstResponse(intentId, evidence) {
      if (!uuid.test(intentId) || !evidence) throw new Error('physical_first_response_invalid');
      if (single(await database.query(
        'SELECT public.record_physical_first_response($1::uuid,$2::jsonb) AS result',
        [intentId, evidence])) !== true) throw new Error('physical_first_response_unavailable');
    },
    async recordDirectDocument(intentId) {
      if (!uuid.test(intentId)) throw new Error('physical_intent_invalid');
      if (single(await database.query(
        'SELECT public.record_physical_direct_document($1::uuid) AS result', [intentId])) !== true)
        throw new Error('physical_document_reconciliation_required');
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
      return finishApproved(intentId);
    },
    finishApproved,
    async viewByRequest(actorId, requestKey) {
      if (!uuid.test(actorId) || !uuid.test(requestKey)) throw new Error('physical_request_invalid');
      return single(await database.query(
        'SELECT public.get_physical_payment_by_request($1::uuid,$2::uuid) AS result',
        [actorId, requestKey]));
    },
    async cancelReserved(actorId, requestKey) {
      if (!uuid.test(actorId) || !uuid.test(requestKey)) throw new Error('physical_request_invalid');
      return single(await database.query(
        'SELECT public.cancel_physical_reserved($1::uuid,$2::uuid) AS result',
        [actorId, requestKey])) === true;
    },
  };
}
