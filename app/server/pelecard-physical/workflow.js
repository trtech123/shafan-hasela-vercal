// Provider-neutral physical terminal orchestration. Financial dispatch requires
// a separate physical-only gate and a worker that can wait for the PINPAD.
// Support supplied merchant prefix. The device displays a different full
// terminal number; only a separately configured physical terminal can be sent.
import { classifyHostedEmvResult } from './hosted-contract.js';
export const PHYSICAL_MERCHANT_PREFIX = '2814926';
export const PHYSICAL_REGISTERS = Object.freeze(['003', '004', '005', '006']);

function validAmount(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}

function validCorrelation(result, intent, merchantTerminal) {
  return result?.intentId === intent.id &&
    result.merchantTerminal === merchantTerminal &&
    result.register === intent.register &&
    result.amountMinor === intent.amountMinor &&
    typeof result.transactionId === 'string' && result.transactionId.length > 0;
}

function validApproval(result, intent, merchantTerminal) {
  return result?.status === 'approved' && validCorrelation(result, intent, merchantTerminal) &&
    typeof result.approvalId === 'string' && result.approvalId.length > 0;
}

export function createPhysicalWorkflow(deps) {
  const merchantTerminal = deps.merchantTerminal;
  async function reconcileDirect(intent, result) {
    if (intent.documentState === 'succeeded') return 'succeeded';
    const first = intent.firstResponse;
    if (first?.document?.state !== 'succeeded' ||
      first.payment?.transactionId !== result.transactionId ||
      first.payment?.amountMinor !== intent.amountMinor) return 'reconciliation_required';
    try {
      await deps.recordDirectDocument(intent.id, first.document);
      return 'succeeded';
    } catch { return 'reconciliation_required'; }
  }
  async function verifyHosted(intent) {
    if (!intent.hostedTransactionId || !intent.hostedConfirmationKey)
      return { id: intent.id, state: intent.state === 'succeeded' ? 'succeeded' : 'uncertain' };
    let classified;
    try {
      const lookup = await deps.hostedProvider.lookup(intent.hostedTransactionId);
      const uid = lookup?.ResultData?.Uid;
      const detail = typeof uid === 'string' && uid
        ? await deps.provider.getTransactionDetailsByUid(uid) : null;
      classified = classifyHostedEmvResult(lookup, { transactionId: intent.hostedTransactionId,
        confirmationKey: intent.hostedConfirmationKey, register: intent.register,
        merchantTerminal, amountMinor: intent.amountMinor, deviceDetails: detail });
    } catch { classified = { paymentState: 'uncertain' }; }
    if (classified.paymentState !== 'approved') {
      if (intent.state !== 'succeeded') await deps.markUncertain(intent.id);
      return { id: intent.id, state: intent.state === 'succeeded' ? 'succeeded' : 'uncertain',
        documentState: 'reconciliation_required' };
    }
    let finalized = {};
    if (intent.state !== 'succeeded') {
      finalized = await deps.finalize(intent.id, { status: 'approved', intentId: intent.id,
        merchantTerminal, register: intent.register, amountMinor: intent.amountMinor,
        transactionId: classified.providerTransactionId,
        approvalId: classified.approvalId, uid: classified.uid });
    }
    let documentState = await deps.hostedDocumentState(intent.id);
    if (documentState !== 'succeeded' && classified.document.state === 'succeeded') {
      try {
        await deps.recordHostedDocument(intent.id, classified.document);
        documentState = 'succeeded';
      } catch { documentState = 'reconciliation_required'; }
    }
    return { id: intent.id, state: 'succeeded', ...finalized,
      documentState: documentState === 'succeeded' ? 'succeeded' : 'reconciliation_required' };
  }
  return {
    async openHosted(intentId) {
      if (deps.enabled !== true || deps.hostedEnabled !== true ||
        deps.hostedInitEnabled !== true) throw new Error('physical_hosted_disabled');
      const intent = await deps.status(intentId);
      if (!intent || intent.register !== '004' || !validAmount(intent.amountMinor))
        throw new Error('physical_hosted_intent_invalid');
      if (intent.route === 'hosted' && intent.hostedTransactionId)
        return { state: intent.state, redirectUrl: intent.hostedRedirectUrl ?? null };
      if (!(await deps.claimHostedInit(intentId)))
        return { state: intent.state, redirectUrl: null };
      try {
        const source = await deps.hostedSource(intentId);
        const callbackUrl = new URL(deps.hostedUrls.callbackBase);
        callbackUrl.searchParams.set('paymentId', intentId);
        const session = await deps.hostedProvider.initialize(source, {
          goodUrl: deps.hostedUrls.goodUrl, errorUrl: deps.hostedUrls.errorUrl,
          callbackUrl: callbackUrl.href });
        await deps.persistHostedSession(intentId, session);
        return { state: 'pending', redirectUrl: session.redirectUrl };
      } catch {
        // Unknown initialization outcome may have created a usable hosted page.
        // Never initialize a second session for this intent.
        await deps.markUncertain(intentId);
        return { state: 'uncertain', redirectUrl: null };
      }
    },
    async startOrder({ actorId, actorRole, workstationId, requestKey, orderId, amountMinor }) {
      if (deps.enabled !== true) throw new Error('physical_disabled');
      if (deps.acceptanceOrderId && (orderId !== deps.acceptanceOrderId ||
        amountMinor !== deps.acceptanceAmountMinor))
        throw new Error('physical_acceptance_scope_invalid');
      if (typeof merchantTerminal !== 'string' || !/^\d{10}$/.test(merchantTerminal))
        throw new Error('physical_terminal_required');
      if (!workstationId || !requestKey || !orderId || !validAmount(amountMinor))
        throw new Error('physical_request_invalid');
      const register = await deps.registerForWorkstation(workstationId);
      if (!PHYSICAL_REGISTERS.includes(register)) throw new Error('physical_register_unassigned');
      const intent = await deps.reserveOrder({ actorId, actorRole, workstationId,
        requestKey, register, orderId, amountMinor });
      if (intent.register !== register || intent.amountMinor !== amountMinor || intent.orderId !== orderId)
        throw new Error('physical_intent_conflict');
      return { id: intent.id, state: intent.state ?? 'reserved' };
    },
    async start({ actorId, actorRole, workstationId, requestKey, cart, billing }) {
      if (deps.enabled !== true) throw new Error('physical_disabled');
      if (deps.acceptanceOrderId) throw new Error('physical_acceptance_scope_invalid');
      if (typeof merchantTerminal !== 'string' || !/^\d{10}$/.test(merchantTerminal))
        throw new Error('physical_terminal_required');
      if (!workstationId || !requestKey || !cart) throw new Error('physical_request_invalid');
      const register = await deps.registerForWorkstation(workstationId);
      if (!PHYSICAL_REGISTERS.includes(register)) throw new Error('physical_register_unassigned');
      const calculated = await deps.calculateCart(cart, actorRole);
      if (!validAmount(calculated?.amountMinor) || !Array.isArray(calculated.items) || !calculated.items.length)
        throw new Error('physical_cart_invalid');
      // reserve must be durable and unique by request key. claimDispatch must
      // atomically lock the register and return true only once for this intent.
      const intent = await deps.reserve({ actorId, workstationId, requestKey, register,
        amountMinor: calculated.amountMinor, items: calculated.items,
        discount: calculated.discount ?? null, billing });
      if (intent.register !== register || intent.amountMinor !== calculated.amountMinor)
        throw new Error('physical_intent_conflict');
      // The browser request ends after reservation. A separate worker claims
      // and dispatches; a slow terminal never holds the browser connection.
      return { id: intent.id, state: intent.state ?? 'reserved' };
    },
    async dispatch(intentId) {
      if (deps.enabled !== true) throw new Error('physical_disabled');
      if (deps.dispatchEnabled !== true) throw new Error('physical_dispatch_disabled');
      if (typeof merchantTerminal !== 'string' || !/^\d{10}$/.test(merchantTerminal))
        throw new Error('physical_terminal_required');
      const intent = await deps.status(intentId);
      if (!intent) throw new Error('physical_intent_missing');
      if (intent.route === 'hosted') throw new Error('physical_direct_route_required');
      if (!PHYSICAL_REGISTERS.includes(intent.register) || !validAmount(intent.amountMinor))
        throw new Error('physical_intent_invalid');
      if (deps.acceptanceOrderId && (intent.register !== '004' ||
        intent.amountMinor !== deps.acceptanceAmountMinor ||
        await deps.orderForIntent(intent.id) !== deps.acceptanceOrderId))
        throw new Error('physical_acceptance_scope_invalid');
      const payperSource = deps.payperEnabled === true
        ? await deps.directSource(intent.id) : undefined;
      if (!(await deps.claimDispatch(intent.id))) return { id: intent.id, state: 'pending' };
      let state = 'pending';
      try {
        const result = await deps.provider.send({ merchantTerminal,
          register: intent.register, amountMinor: intent.amountMinor, intentId: intent.id,
          payperSource });
        await deps.persistFirstResponse(intent.id, result.firstResponse);
        await deps.markDispatched(intent.id, result);
      } catch {
        // Even a broken connection can follow a completed charge. A second send
        // must never happen without a provider-confirmed negative outcome.
        await deps.markUncertain(intent.id);
        state = 'uncertain';
      }
      return { id: intent.id, state };
    },
    async verify(intentId) {
      if (typeof merchantTerminal !== 'string' || !/^\d{10}$/.test(merchantTerminal))
        throw new Error('physical_terminal_required');
      const intent = await deps.status(intentId);
      if (!intent) throw new Error('physical_intent_missing');
      if (intent.route === 'hosted') return verifyHosted(intent);
      if (intent.state === 'succeeded') {
        return { ...intent, documentState: await reconcileDirect(intent, {
          transactionId: intent.transactionId }) };
      }
      if (intent.state === 'approved') {
        const finalized = await deps.finishApproved(intent.id);
        return { id: intent.id, state: 'succeeded', ...finalized,
          documentState: await reconcileDirect(intent, { transactionId: intent.transactionId }) };
      }
      if (!['dispatching', 'pending', 'uncertain'].includes(intent.state)) return intent;
      let result;
      try { result = await deps.provider.inspect(intent); }
      catch {
        await deps.markUncertain(intent.id);
        return { id: intent.id, state: 'uncertain' };
      }
      if (result?.status === 'declined' && validCorrelation(result, intent, merchantTerminal)) {
        await deps.markDeclined(intent.id, result);
        return { id: intent.id, state: 'declined' };
      }
      if (!validApproval(result, intent, merchantTerminal)) {
        await deps.markUncertain(intent.id);
        return { id: intent.id, state: 'uncertain' };
      }
      // finalize must use a unique provider transaction ID and an atomic
      // payment + sale + accounting eligibility transaction in the database.
      const finalized = await deps.finalize(intent.id, result);
      return { id: intent.id, state: 'succeeded', ...finalized,
        documentState: await reconcileDirect(intent, result) };
    },
  };
}
