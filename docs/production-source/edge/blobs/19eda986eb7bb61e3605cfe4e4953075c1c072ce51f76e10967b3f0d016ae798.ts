import { buildImmediateDocument, type ImmediatePayment } from './immediate-payment.ts';
import { reconcileImmediateDocument, safeRivhitDocumentUrl, type DocumentLookupClient, type ExpectedImmediateDocument } from './reconciliation.ts';
import { sha256Hex, stableStringify } from './order-mapper.ts';
import { recoverImmediateArtifact, type DocumentCopyClient } from './immediate-artifact.ts';
import type {FrozenCustomerBilling} from './immediate-vat.ts';

export interface ImmediateContext {
  configuredVatRate:number;
  order: {id:string;order_number:string;total_price:number;payment_status:string;status:string;billing:FrozenCustomerBilling};
  preparation: null | {id:string;state:string;external_document_number:string|null;external_document_id?:string|null;document_url:string|null;error_code:string|null;dispatch_started_at:string|null;snapshot:Record<string,unknown>;payload_hash:string;request_reference:string;expected?:ExpectedImmediateDocument|null};
  manualPayment: null | {id:string;sale_id:string;method:'cash'|'check';amount_minor:number;details:Record<string,unknown>};
  payment: null | {id:string;status:string;sale_id:string|null;verified_at:string|null;amount:number;currency:string;provider:string};
  sales: Array<{id:string;total:number;payment_transaction_id:string|null}>;
  historicalExcluded:boolean;
  hasActiveAttempt:boolean;
}
export interface ImmediateRepository {
  load(orderId:string):Promise<ImmediateContext>;
  prepare(orderId:string,actorId:string,snapshot:Record<string,unknown>,hash:string,mappingRequired?:boolean):Promise<void>;
  reconcile(preparation:NonNullable<ImmediateContext['preparation']>,actorId:string,result:Awaited<ReturnType<typeof reconcileImmediateDocument>>):Promise<void>;
}
export class ImmediateError extends Error {
  constructor(public code:string, public status=409){super(code);}
}
function ownedByPayper(context:ImmediateContext){
  return context.payment?.provider==='pelecard'&&context.sales.some(sale=>sale.payment_transaction_id===context.payment?.id);
}
export function billingReviewHash(context:ImmediateContext) {
  const o=context.order;
  return sha256Hex(stableStringify({orderId:o.id,orderNumber:o.order_number,amountMinor:Math.round(o.total_price*100),configuredVatRate:context.configuredVatRate,billing:{...o.billing,companyId:o.billing.companyId||''}}));
}
export async function presentImmediateContext(context:ImmediateContext) {
  const p=context.preparation;
  return {order:context.order,billingReviewHash:await billingReviewHash(context),preparation:p?{id:p.id,state:p.state,external_document_number:p.external_document_number,
    document_url:safeRivhitDocumentUrl(p.document_url),error_code:p.error_code,billing:p.snapshot.billing,amountMinor:p.snapshot.amountMinor,vat:p.snapshot.vat,issuanceBlock:p.snapshot.issuanceBlock??null}:null,
    manualPayment:context.manualPayment?{id:context.manualPayment.id,sale_id:context.manualPayment.sale_id}:null,
    payment:context.payment?{id:context.payment.id,status:context.payment.status}:null,
    historicalExcluded:context.historicalExcluded,issuanceHeld:true,mappingRequired:p?.state==='mapping_required',
    documentProvider:ownedByPayper(context)?'payper':'rivhit',
    preparationBlocked:ownedByPayper(context)?'payper_activation_required':null,
    canRecordManualPayment:Boolean(context.order.billing.customerSnapshotId)&&typeof context.order.billing.vatApplicable==='boolean'&&!context.historicalExcluded&&!p&&!context.manualPayment&&!context.sales.length&&!context.hasActiveAttempt&&
      (!context.payment||['failed','expired'].includes(context.payment.status))&&context.order.payment_status==='לא שולם'&&context.order.status!=='בוטל'&&context.order.total_price>0};
}

/** Deliberately has no issuance method or dependency. Client-supplied source/payload is ignored. */
export async function handleImmediateAction(body:Record<string,unknown>,actorId:string,repository:ImmediateRepository,lookup:()=>DocumentLookupClient & Partial<DocumentCopyClient>) {
  if(!['status','prepare','reconcile'].includes(String(body.action)))throw new ImmediateError('unsupported_action',400);
  if(typeof body.orderId!=='string'||!/^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(body.orderId))throw new ImmediateError('invalid_order_id',400);
  const context=await repository.load(body.orderId);
  if(body.action==='status')return presentImmediateContext(context);
  if(context.historicalExcluded)throw new ImmediateError('historical_test_accounting_held');
  if(body.action==='prepare'){
    if(ownedByPayper(context))throw new ImmediateError('pelecard_document_owned_by_payper');
    if(body.billingConfirmed!==true||body.noPriorInvoice!==true)throw new ImmediateError('billing_approval_required',400);
    if(context.preparation)return presentImmediateContext(context);
    if(body.billingReviewHash!==await billingReviewHash(context))throw new ImmediateError('billing_review_changed');
    const sale=context.sales[0],p=context.payment,m=context.manualPayment,o=context.order;
    const amountMinor=Math.round(o.total_price*100);
    if(context.sales.length!==1||!sale||Math.round(sale.total*100)!==amountMinor||o.payment_status==='לא שולם'||o.status==='בוטל')throw new ImmediateError('completed_sale_required');
    if(sale.payment_transaction_id){
      if(!p||p.id!==sale.payment_transaction_id||p.sale_id!==sale.id||p.status!=='succeeded'||!p.verified_at||p.currency!=='ILS'||p.provider!=='pelecard'||Math.round(p.amount*100)!==amountMinor)throw new ImmediateError('verified_payment_required');
      throw new ImmediateError('pelecard_document_owned_by_payper');
    }
    if(!m||m.sale_id!==sale.id||m.amount_minor!==amountMinor)throw new ImmediateError('authorized_manual_payment_required');
    const payment:ImmediatePayment=m.method==='cash'?{method:'cash'}:{method:'check',bankCode:Number(m.details.bankCode),branchNumber:Number(m.details.branchNumber),accountNumber:String(m.details.accountNumber??''),checkNumber:Number(m.details.checkNumber),dueDate:String(m.details.dueDate??'')};
    const snapshot=await buildImmediateDocument({id:m.id,orderId:o.id,saleId:sale.id,orderNumber:o.order_number,amountMinor,currency:'ILS',completed:true,mode:'live',configuredVatRate:context.configuredVatRate,billing:{...o.billing,approved:true,noPriorInvoice:true},payment});
    const {payloadHash,...immutable}=snapshot;
    await repository.prepare(o.id,actorId,immutable,payloadHash);
  }else{
    const p=context.preparation;
    if(!p?.dispatch_started_at||!['dispatching','reconciliation_required','artifact_required','succeeded'].includes(p.state))throw new ImmediateError('no_dispatched_document');
    // Expected identity is captured before dispatch, never accepted from request data.
    const expected=p.expected;
    if(!expected||expected.requestReference!==p.request_reference||expected.companyId!==512783333||expected.amountMinor!==Number(p.snapshot.amountMinor))throw new ImmediateError('reconciliation_identity_required');
    const client=lookup();
    const verified=await reconcileImmediateDocument(client,expected);
    if(p.external_document_number&&p.external_document_number!==verified.document.documentNumber)throw new ImmediateError('reconciliation_identity_mismatch');
    if(p.external_document_id&&p.external_document_id!==verified.document.documentId)throw new ImmediateError('reconciliation_identity_mismatch');
    const result=client.getDocumentCopy?await recoverImmediateArtifact({getDocumentCopy:client.getDocumentCopy.bind(client)},verified):verified;
    await repository.reconcile(p,actorId,result);
  }
  return presentImmediateContext(await repository.load(body.orderId));
}
