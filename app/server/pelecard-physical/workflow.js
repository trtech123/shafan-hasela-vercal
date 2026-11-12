// Provider-neutral physical terminal orchestration. The production transport is
// deliberately absent until Pelecard confirms its cloud-device API contract.
// Support supplied merchant prefix. The device displays a different full
// terminal number; only a separately configured physical terminal can be sent.
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
  return {
    async start({ actorId, actorRole, workstationId, requestKey, cart, billing }) {
      if (deps.enabled !== true) throw new Error('physical_disabled');
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
      if (typeof merchantTerminal !== 'string' || !/^\d{10}$/.test(merchantTerminal))
        throw new Error('physical_terminal_required');
      const intent = await deps.status(intentId);
      if (!intent) throw new Error('physical_intent_missing');
      if (!PHYSICAL_REGISTERS.includes(intent.register) || !validAmount(intent.amountMinor))
        throw new Error('physical_intent_invalid');
      if (!(await deps.claimDispatch(intent.id))) return { id: intent.id, state: 'pending' };
      let state = 'pending';
      try {
        const result = await deps.provider.send({ merchantTerminal,
          register: intent.register, amountMinor: intent.amountMinor, intentId: intent.id });
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
      if (intent.state === 'succeeded') return intent;
      if (!['reserved', 'pending', 'uncertain'].includes(intent.state)) return intent;
      let result;
      try { result = await deps.provider.inspect(intent); }
      catch { return { id: intent.id, state: 'uncertain' }; }
      if (result?.status === 'declined' && validCorrelation(result, intent, merchantTerminal)) {
        await deps.markDeclined(intent.id, result);
        return { id: intent.id, state: 'declined' };
      }
      if (!validApproval(result, intent, merchantTerminal)) return { id: intent.id, state: 'uncertain' };
      // finalize must use a unique provider transaction ID and an atomic
      // payment + sale + accounting eligibility transaction in the database.
      const finalized = await deps.finalize(intent.id, result);
      return { id: intent.id, state: 'succeeded', ...finalized };
    },
  };
}
