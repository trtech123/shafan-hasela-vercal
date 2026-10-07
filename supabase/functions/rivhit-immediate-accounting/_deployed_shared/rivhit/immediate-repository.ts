import { ImmediateError, type ImmediateContext, type ImmediateRepository } from './immediate-handler.ts';
import type { reconcileImmediateDocument } from './reconciliation.ts';
import type { ExpectedImmediateDocument } from './reconciliation.ts';
import type { ApprovedImmediatePreparation, ImmediateDispatchRepository } from '../../../_shared/rivhit/immediate-dispatch.ts';
import type { ImmediateCustomerRepository } from '../../../_shared/rivhit/immediate-customer.ts';

// Structural client keeps unit tests independent of the Edge npm loader.
interface Database {from(name:string):any;rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}
async function data(query:PromiseLike<{data:any;error:unknown}>){const result=await query;if(result.error)throw new ImmediateError('accounting_storage_unavailable',503);return result.data;}
export class SupabaseImmediateRepository implements ImmediateRepository, ImmediateDispatchRepository, ImmediateCustomerRepository {
  constructor(private db:Database,private accountNamespace='company-512783333'){}
  async load(orderId:string):Promise<ImmediateContext>{
    const [order,savedPreparation,evidence,manualPayment,payments,sales,gate,vatPolicy]=await Promise.all([
      data(this.db.from('orders').select('id,order_number,total_price,payment_status,status,customer_id,customer_snapshot_id,customer_record_version,client_name,organization,billing_institution_name,billing_accounting_email,client_email,client_phone,billing_company_id').eq('id',orderId).maybeSingle()),
      data(this.db.from('immediate_accounting_preparations').select('id,state,external_document_number,external_document_id,document_url,error_code,dispatch_started_at,snapshot,payload_hash,request_reference,expected').eq('order_id',orderId).maybeSingle()),
      data(this.db.from('immediate_accounting_payment_evidence').select('id,state,snapshot,payload_hash').eq('order_id',orderId).maybeSingle()),
      data(this.db.from('manual_order_payments').select('id,sale_id,method,amount_minor,details').eq('order_id',orderId).maybeSingle()),
      data(this.db.from('payment_transactions').select('id,status,sale_id,verified_at,amount,currency,provider').eq('order_id',orderId).eq('operation','payment').order('created_at',{ascending:false})),
      data(this.db.from('sales').select('id,total,payment_transaction_id').eq('order_id',orderId)),
      data(this.db.rpc('get_immediate_accounting_order_gate',{p_order_id:orderId})),
      data(this.db.from('immediate_accounting_vat_policy').select('rate_percent').eq('singleton',true).maybeSingle()),
    ]);
    if(!order)throw new ImmediateError('order_not_found',404);
    const frozen=order.customer_snapshot_id?await data(this.db.from('customer_snapshots').select('id,order_id,customer_id,customer_version,revision,data').eq('id',order.customer_snapshot_id).maybeSingle()):null;
    if(order.customer_snapshot_id&&(!frozen||frozen.order_id!==order.id||frozen.customer_id!==order.customer_id||frozen.revision!==order.customer_record_version))throw new ImmediateError('customer_snapshot_invalid');
    const billing=frozen?.data??order;
    // A real prepared payload takes precedence; evidence remains immutable and
    // never participates in activation/customer/document dispatch claims.
    const preparation=savedPreparation??(evidence?{...evidence,external_document_number:null,external_document_id:null,document_url:null,error_code:'voucher_mapping_required',dispatch_started_at:null,expected:null,request_reference:evidence.snapshot.document.request_reference}:null);
    const payment=payments.find((p:any)=>!['failed','expired'].includes(p.status))??payments[0]??null;
    return {configuredVatRate:Number(vatPolicy?.rate_percent),order:{id:order.id,order_number:order.order_number,total_price:Number(order.total_price),payment_status:order.payment_status,status:order.status,
      billing:{name:billing.billing_institution_name||billing.organization||billing.client_name||'',email:billing.billing_accounting_email||billing.client_email||'',phone:billing.client_phone||'',companyId:billing.billing_company_id||undefined,
        ...(frozen?{customerId:frozen.customer_id,customerSnapshotId:frozen.id,customerVersion:frozen.customer_version,vatApplicable:billing.vat_applicable,address:billing.billing_address_line||'',city:billing.billing_city||'',postalCode:billing.billing_postal_code||'',countryCode:billing.billing_country_code||''}:{})}},
      preparation,manualPayment,payment,sales,historicalExcluded:gate.historicalControlled!==false,hasActiveAttempt:gate.activeLiveAttempt!==false};
  }
  async prepare(orderId:string,actorId:string,snapshot:Record<string,unknown>,hash:string,mappingRequired=false){
    const result=await this.db.rpc('prepare_immediate_accounting',{p_order_id:orderId,p_actor_id:actorId,p_snapshot:snapshot,p_hash:hash,p_mapping_required:mappingRequired});
    if(result.error&&typeof result.error==='object'&&'message' in result.error&&typeof result.error.message==='string'&&/^(billing_review_changed|customer_vat_required|customer_snapshot_required|customer_snapshot_invalid|vat_exemption_configuration_required|accounting_vat_configuration_required|accounting_vat_invalid|check_general_register_required)$/.test(result.error.message))throw new ImmediateError(result.error.message);
    if(result.error)throw new ImmediateError('accounting_storage_unavailable',503);
  }
  async reconcile(preparation:NonNullable<ImmediateContext['preparation']>,actorId:string,result:Awaited<ReturnType<typeof reconcileImmediateDocument>>){
    await data(this.db.rpc('persist_immediate_accounting_result',{p_preparation_id:preparation.id,p_actor_id:actorId,p_hash:preparation.payload_hash,p_external_document_id:result.document.documentId,p_external_document_number:result.document.documentNumber,p_document_url:result.document.documentUrl,p_state:result.status,p_error_code:null}));
  }
  async loadApproved(id:string,actorId:string):Promise<ApprovedImmediatePreparation>{
    const rows=await data(this.db.rpc('load_approved_immediate_accounting',{p_preparation_id:id,p_actor_id:actorId}));
    if(!Array.isArray(rows)||rows.length!==1)throw new ImmediateError('issuance_not_approved');
    return rows[0];
  }
  async activate(id:string,actorId:string,hash:string,capability:string){
    if(!/^[a-f0-9]{64}$/.test(hash)||!capability)throw new ImmediateError('issuance_not_approved');
    await data(this.db.rpc('activate_immediate_accounting',{p_preparation_id:id,p_actor_id:actorId,p_hash:hash,p_capability:capability}));
  }
  async freezeExpected(p:ApprovedImmediatePreparation,actorId:string,expected:ExpectedImmediateDocument){
    await data(this.db.rpc('freeze_immediate_accounting_expected',{p_preparation_id:p.id,p_actor_id:actorId,p_hash:p.payload_hash,p_expected:expected}));
  }
  async claim(id:string){const rows=await data(this.db.rpc('claim_immediate_accounting_dispatch',{p_preparation_id:id}));return Array.isArray(rows)&&rows.length===1;}
  async persist(p:ApprovedImmediatePreparation,actorId:string,result:Awaited<ReturnType<typeof reconcileImmediateDocument>>){
    await data(this.db.rpc('persist_immediate_accounting_result',{p_preparation_id:p.id,p_actor_id:actorId,p_hash:p.payload_hash,p_state:result.status,p_external_document_id:result.document.documentId,p_external_document_number:result.document.documentNumber,p_document_url:result.document.documentUrl,p_error_code:null}));
  }
  async uncertain(p:ApprovedImmediatePreparation,actorId:string){
    await data(this.db.rpc('persist_immediate_accounting_result',{p_preparation_id:p.id,p_actor_id:actorId,p_hash:p.payload_hash,p_state:'reconciliation_required',p_error_code:'provider_outcome_uncertain'}));
  }
  async claimCustomer(p:ApprovedImmediatePreparation,actorId:string){
    const rows=await data(this.db.rpc('claim_immediate_accounting_customer',{p_preparation_id:p.id,p_actor_id:actorId,p_hash:p.payload_hash}));
    const claimed=Array.isArray(rows)&&rows.length===1;
    const current=claimed?rows[0]:await this.loadApproved(p.id,actorId);
    if(!current.customer_request_reference)throw new ImmediateError('customer_claim_invalid');
    return {claimed,requestReference:current.customer_request_reference,customerId:current.expected?.customerId};
  }
  async persistCustomer(p:ApprovedImmediatePreparation,actorId:string,customerId:string){
    return await data(this.db.rpc('persist_immediate_accounting_customer',{p_preparation_id:p.id,p_actor_id:actorId,p_hash:p.payload_hash,p_customer_id:customerId,p_account_namespace:this.accountNamespace}));
  }
}
