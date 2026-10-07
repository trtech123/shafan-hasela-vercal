import { sha256Hex, stableStringify } from './order-mapper.ts';
import {customerVat,IMMEDIATE_VAT_POLICY,type FrozenCustomerBilling} from './immediate-vat.ts';

export interface BillingApproval extends FrozenCustomerBilling {
  name: string; email: string; phone: string; companyId?: string;
  approved: boolean; noPriorInvoice: boolean;
}
export type ImmediatePayment =
  | {method:'cash'}
  | {method:'check';bankCode:number;branchNumber:number;accountNumber:string;checkNumber:number;dueDate:string}
  | {method:'pelecard';verified:boolean;brand:string;voucherId:string;lastFour:string;providerTransactionId:string;singlePayment:boolean};
export interface ImmediateSource {
  id:string;orderId:string;saleId:string;orderNumber:string;amountMinor:number;currency:string;
  completed:boolean;mode:string;billing:BillingApproval;payment:ImmediatePayment;configuredVatRate:number;
  excludedHistoricalTest?:boolean;
}
/** Only a reviewed provider contract may implement composite-voucher conversion. */
export interface ExternalVoucherMapping {
  revision:string;
  resolveVoucher(voucherId:string):number;
}
function invalid(code:string):never {throw new Error(code);}
function positiveInteger(v:number,max=2147483647):number {if(!Number.isSafeInteger(v)||v<1||v>max)return invalid('invalid_accounting_integer');return v;}
function uuid(v:string):string {if(!/^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(v))return invalid('invalid_source_identity');return v;}
/** Services REST manual Jan 2025 p34: brand, not issuer/clearer. */
export function mapPelecardBrand(brand:unknown):number {
  const codes:Record<string,number>={'1':10,'2':5,'5':4};
  if(typeof brand!=='string'||!Object.hasOwn(codes,brand))return invalid('credit_brand_mapping_required');
  return codes[brand];
}
export function resolveNumericVoucher(voucher:string):number {
  if(!/^\d{1,9}$/.test(voucher))return invalid('voucher_mapping_required');
  return positiveInteger(Number(voucher),999999999);
}
export function splitInclusiveVat(grossMinor:number) {
  positiveInteger(grossMinor);
  return customerVat(grossMinor,true,IMMEDIATE_VAT_POLICY.ratePercent);
}
function taxId(value:string|undefined):string|undefined {
  if(!value?.trim())return undefined;
  if(!/^\d{9}$/.test(value)||/^0+$/.test(value))return invalid('invalid_billing_company_id');
  const sum=[...value].reduce((s,c,i)=>{const n=Number(c)*(i%2+1);return s+(n>9?n-9:n);},0);
  if(sum%10)return invalid('invalid_billing_company_id');return value;
}
function validateImmediateSource(source:Omit<ImmediateSource,'payment'>) {
  uuid(source.id);uuid(source.orderId);uuid(source.saleId);
  if(!source.completed||source.mode!=='live'||source.currency!=='ILS'||source.excludedHistoricalTest)return invalid('ineligible_accounting_source');
  if(!source.orderNumber||source.orderNumber.length>15)return invalid('invalid_order_number');
  positiveInteger(source.amountMinor);
  if(!Number.isFinite(source.configuredVatRate)||source.configuredVatRate<=0||source.configuredVatRate>100)return invalid('accounting_vat_configuration_required');
  const b=source.billing;
  if(typeof b.vatApplicable!=='boolean')return invalid('customer_vat_required');
  if(!b.customerId||!b.customerSnapshotId||!Number.isSafeInteger(b.customerVersion)||Number(b.customerVersion)<1)return invalid('customer_snapshot_required');
  uuid(b.customerId);uuid(b.customerSnapshotId);
  if(!b.approved||!b.noPriorInvoice)return invalid('billing_approval_required');
  if(!b.name.trim()||b.name.trim().length>30)return invalid('invalid_billing_name');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)||b.email.length>50)return invalid('invalid_billing_email');
  if(!/^[+\d ()-]{7,15}$/.test(b.phone)||!/^\d{7,15}$/.test(b.phone.replace(/\D/g,'')))return invalid('invalid_billing_phone');
  return taxId(b.companyId);
}
function frozenBilling(b:BillingApproval,companyId:string|undefined){
  return {name:b.name,email:b.email,phone:b.phone,approved:b.approved,noPriorInvoice:b.noPriorInvoice,...(companyId?{companyId}:{}),customerId:b.customerId!,customerSnapshotId:b.customerSnapshotId!,customerVersion:b.customerVersion!,vatApplicable:b.vatApplicable!,address:b.address||'',city:b.city||'',postalCode:b.postalCode||'',countryCode:b.countryCode||''};
}
/** Durable billing/payment linkage only. No card values, allocation or issuable payload. */
export async function buildImmediateMappingEvidence(source:Omit<ImmediateSource,'payment'>&{verifiedAt:string}) {
  const companyId=validateImmediateSource(source);
  if(!source.verifiedAt||!Number.isFinite(Date.parse(source.verifiedAt)))return invalid('verified_payment_required');
  const snapshot={sourceId:source.id,orderId:source.orderId,saleId:source.saleId,companyId:512783333,
    billing:frozenBilling(source.billing,companyId),amountMinor:source.amountMinor,vat:customerVat(source.amountMinor,source.billing.vatApplicable,source.configuredVatRate),
    document:{document_type:2,sort_code:100,currency_id:1,price_include_vat:true,order:source.orderNumber,request_reference:source.id,
      prevent_duplicates:true,send_mail:false,default_email:false,digital_signature:true},
    paymentEvidence:{provider:'pelecard',paymentId:source.id,saleId:source.saleId,verifiedAt:source.verifiedAt,currency:'ILS',amountMinor:source.amountMinor},
    mappingRequired:true,mappingRevision:'unresolved-voucher-contract',...(source.billing.vatApplicable===false?{issuanceBlock:'vat_exemption_configuration_required'}:{})};
  return {...snapshot,payloadHash:await sha256Hex(stableStringify(snapshot))};
}
export async function buildImmediateDocument(source:ImmediateSource,mapping?:ExternalVoucherMapping) {
  const companyId=validateImmediateSource(source),b=source.billing,p=source.payment;
  let allocation:Record<string,unknown>;
  let providerReference='';
  if(p.method==='cash')allocation={payment_type:2};
  else if(p.method==='check'){
    if(!/^\d{1,20}$/.test(p.accountNumber))return invalid('invalid_check_account');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate)||Number.isNaN(Date.parse(p.dueDate))||new Date(p.dueDate).toISOString().slice(0,10)!==p.dueDate)return invalid('invalid_check_date');
    const [y,m,d]=p.dueDate.split('-');
    allocation={payment_type:1,bank_code:positiveInteger(p.bankCode,999),branch_number:positiveInteger(p.branchNumber,9999),bank_account_number:p.accountNumber,check_number:positiveInteger(p.checkNumber,999999999),due_date:d+'/'+m+'/'+y};
  }else if(p.method==='pelecard'){
    if(!p.verified||!p.singlePayment||!/^\d{4}$/.test(p.lastFour))return invalid('verified_credit_metadata_required');
    providerReference=uuid(p.providerTransactionId);
    const voucher=mapping?positiveInteger(mapping.resolveVoucher(p.voucherId),999999999):resolveNumericVoucher(p.voucherId);
    allocation={payment_type:mapPelecardBrand(p.brand),bank_account_number:p.lastFour,check_number:voucher};
  }else return invalid('unsupported_immediate_method');
  const document={document_type:2,sort_code:100,currency_id:1,price_include_vat:true,language:'he',last_name:b.name.trim(),
    ...(companyId?{id_number:Number(companyId)}:{}),order:source.orderNumber,
    comments:`Shafan payment ${source.id}${providerReference?' / Pelecard '+providerReference:''}`,
    items:[{item_id:0,quantity:1,price_nis:source.amountMinor/100,description:`Shafan / ${source.orderNumber}`}],
    payments:[{...allocation,amount_nis:source.amountMinor/100,number_of_payments:1}],
    // DEMO proved UUID references recover through Status.LastRequest; long
    // prefixed references were accepted for issuance but not recoverable.
    request_reference:source.id,prevent_duplicates:true,
    create_items:false,create_customer:false,no_update_inventory:true,
    digital_signature:true,send_mail:false,default_email:false};
  const snapshot={sourceId:source.id,orderId:source.orderId,saleId:source.saleId,companyId:512783333,billing:frozenBilling(b,companyId),
    amountMinor:source.amountMinor,vat:customerVat(source.amountMinor,b.vatApplicable,source.configuredVatRate),document,mappingRevision:mapping?.revision??'documented-numeric-voucher-only',...(b.vatApplicable===false?{issuanceBlock:'vat_exemption_configuration_required'}:{})};
  return {...snapshot,payloadHash:await sha256Hex(stableStringify(snapshot))};
}
