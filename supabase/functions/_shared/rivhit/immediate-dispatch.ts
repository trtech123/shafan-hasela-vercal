// Type declarations only; recovered from existing integration source.
// Runtime implementations are deliberately excluded: production bundles erase these imports.
import type {reconcileImmediateDocument,DocumentLookupClient,ExpectedImmediateDocument} from '../../rivhit-immediate-accounting/_deployed_shared/rivhit/reconciliation.ts';
import type {FrozenVat,FrozenCustomerBilling} from '../../rivhit-immediate-accounting/_deployed_shared/rivhit/immediate-vat.ts';
export interface ApprovedImmediatePreparation {
  id:string;order_id:string;payload_hash:string;request_reference:string;
  customer_request_reference?:string;expected?:ExpectedImmediateDocument|null;
  snapshot:{amountMinor:number;companyId:number;billing:FrozenCustomerBilling;vat?:FrozenVat;issuanceBlock?:string;document:Record<string,unknown>};
}

export interface ImmediateDispatchRepository {
  /** Must check admin actor, record approval and durable source hold before customer creation. */
  loadApproved(id:string,actorId:string):Promise<ApprovedImmediatePreparation>;
  freezeExpected(preparation:ApprovedImmediatePreparation,actorId:string,expected:ExpectedImmediateDocument):Promise<void>;
  /** Atomic one-time claim; rechecks approval and durable hold. */
  claim(id:string):Promise<boolean>;
  persist(preparation:ApprovedImmediatePreparation,actorId:string,result:Awaited<ReturnType<typeof reconcileImmediateDocument>>):Promise<void>;
  uncertain(preparation:ApprovedImmediatePreparation,actorId:string):Promise<void>;
}

export interface ImmediateDispatchClient extends DocumentLookupClient {createDocument(payload:Record<string,unknown>):Promise<unknown>}
