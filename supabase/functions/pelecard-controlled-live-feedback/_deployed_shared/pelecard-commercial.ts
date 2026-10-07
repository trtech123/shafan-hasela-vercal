import {authorizeStaff,type PaymentAuthenticator} from './payment-auth.ts';
import {paymentCorsHeaders,paymentJson,parsePaymentJson,PaymentHttpError} from './payment-http.ts';
import {verifyOrderGetTransaction} from './pelecard-live-verification.ts';
import {parseControlledLiveCallback,ControlledLiveCallbackError} from './pelecard-live-callback.ts';
import type {OrderPaymentView} from '../../_shared/pelecard-order-payment.ts';
import {hostedLifetime} from './pelecard-hosted-lifetime.ts';

type View=OrderPaymentView&{hosted_state:string;can_replace:boolean;hosted_expires_at?:string|null;closed_unpaid_at?:string|null;last_lookup_status?:string|null;last_transaction_status?:string|null};
type Attempt={payment_id:string;order_id:string;amount_minor:number;currency:string;transaction_id:string;confirmation_key:string;hosted_state:string;hosted_expires_at?:string|null;closed_unpaid_at?:string|null};
export interface CommercialDependencies {
 now?():number;
 read(name:string):string|undefined;auth:PaymentAuthenticator;allowedOrigins:readonly string[];log(event:Record<string,unknown>):void;
 view(orderId:string,actorId:string):Promise<View|null>;
 reserve(orderId:string,actorId:string,amountMinor:number,previousPaymentId:string|null):Promise<{id:string;created:boolean}>;
 get(paymentId:string):Promise<Attempt|null>;
 observe(paymentId:string,hostedState:string,apiStatus:string|null,transactionStatus:string|null,correlation:boolean):Promise<unknown>;
 finalize(attempt:Attempt,approvalId:string):Promise<unknown>;
 call(action:'init'|'lookup'|'validate'|'hosted',paymentId:string):Promise<unknown>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const providerId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function minor(row:View){const value=Number(row.amount)*100,rounded=Math.round(value);if(!Number.isSafeInteger(rounded)||rounded<1||rounded>2147483647||Math.abs(value-rounded)>1e-7)throw new PaymentHttpError(409,'order_amount_invalid');return rounded;}
function savedUrl(row:View){const expected='https://gateway20.pelecard.biz/PaymentGW?transactionId='+row.provider_session_id;return providerId.test(row.provider_session_id??'')&&row.provider_redirect_url===expected?expected:null;}
function validate(row:View|null,orderId:string):View{
 if(!row||row.order_id!==orderId)throw new PaymentHttpError(404,'order_not_found');minor(row);
 const closedHistory=row.payment_state==='expired'&&!!row.closed_unpaid_at;
 if(row.payment_id&&(!uuid.test(row.payment_id)||(!closedHistory&&Number(row.payment_amount)!==Number(row.amount))||row.payment_currency!=='ILS'))throw new PaymentHttpError(409,'payment_order_mismatch');
 if(row.payment_state==='succeeded'&&!row.sale_id)throw new PaymentHttpError(409,'payment_state_inconsistent');
 if(row.payment_id&&row.payment_state!=='succeeded'&&['פלאקארד','שולם במלואו'].includes(row.payment_status))throw new PaymentHttpError(409,'payment_state_inconsistent');
 return row;
}
function responseView(row:View,deps:CommercialDependencies){
 const now=deps.now?.()??Date.now(),lifetime=hostedLifetime(row.hosted_expires_at,now);
 const hostedState=lifetime.expired||row.closed_unpaid_at?'expired':row.hosted_state;
 const paid=row.payment_id?row.payment_state==='succeeded'&&!!row.sale_id:['פלאקארד','שולם במלואו'].includes(row.payment_status);
 const pending=!!row.payment_id&&!paid&&!row.closed_unpaid_at&&row.payment_state!=='expired';
 return {orderId:row.order_id,orderNumber:row.order_number,amountMinor:minor(row),currency:'ILS',mode:'live',paid,accountingHeld:row.accounting_held===true,serverTime:new Date(now).toISOString(),
  canInitialize:!paid&&(!row.payment_id||row.can_replace===true)&&row.init_enabled===true&&row.payment_status==='לא שולם'&&deps.read('PELECARD_LIVE_PAYMENTS_ENABLED')==='true',
  payment:row.payment_id?{id:row.payment_id,status:row.payment_state,saleId:row.sale_id,hostedState,hostedExpiresAt:lifetime.expiresAt,
   canResume:pending&&lifetime.known&&!lifetime.expired&&hostedState==='usable'&&!!savedUrl(row)&&row.accounting_held,
   canVerify:pending&&!!savedUrl(row)&&row.accounting_held}:null};
}
function checkedAttempt(row:Attempt|null,paymentId:string):Attempt{
 if(!row||row.payment_id!==paymentId||!uuid.test(row.order_id)||!providerId.test(row.transaction_id)||!row.confirmation_key||!Number.isSafeInteger(row.amount_minor)||row.amount_minor<1||row.amount_minor>2147483647||row.currency!=='ILS')throw new PaymentHttpError(409,'stored_session_unavailable');return row;
}
export async function recoverCommercial(deps:CommercialDependencies,attempt:Attempt){
 if(attempt.closed_unpaid_at)throw new PaymentHttpError(409,'payment_attempt_closed');
 const evidence=verifyOrderGetTransaction(await deps.call('lookup',attempt.payment_id),{transactionId:attempt.transaction_id,confirmationKey:attempt.confirmation_key,amountMinor:attempt.amount_minor,currency:'ILS'});
 const correlation=await deps.call('validate',attempt.payment_id)===1;
 if(!correlation)throw new PaymentHttpError(409,'provider_correlation_mismatch');
 let hostedState=hostedLifetime(attempt.hosted_expires_at,deps.now?.()??Date.now()).expired?'expired':attempt.hosted_state;
 if(!evidence.approved&&hostedState!=='expired'){
  try{const observed=await deps.call('hosted',attempt.payment_id) as {state?:string;code?:string;reachable?:boolean};
   if(observed?.state==='expired'&&observed.code==='0003')hostedState='expired';
   else if(observed?.reachable!==true)throw new PaymentHttpError(503,'hosted_session_unavailable');
  }catch{throw new PaymentHttpError(503,'hosted_session_unavailable');}
 }
 await deps.observe(attempt.payment_id,hostedState,evidence.apiStatus,evidence.transactionStatus,correlation);
 if(evidence.approved)await deps.finalize(attempt,evidence.approvalId);
 // Nonapproval/510 is NOT terminal unpaid evidence. Never release ownership here.
 return {approved:evidence.approved,StatusCode:evidence.apiStatus,ShvaResult:evidence.transactionStatus,ShvaResultEmv:evidence.emvStatus,resolution:evidence.approved?'approved':'unknown'};
}
function failure(error:unknown,cors:HeadersInit={}){return error instanceof PaymentHttpError?paymentJson({error:{code:error.code}},error.status,cors):paymentJson({error:{code:'payment_operation_unresolved'}},502,cors);}
export function createCommercialPaymentHandler(deps:CommercialDependencies){return async(request:Request)=>{
 let cors:HeadersInit={},stage='authorization';
 try{
  cors=paymentCorsHeaders(request,deps.allowedOrigins);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')throw new PaymentHttpError(405,'method_not_allowed');
  const actor=await authorizeStaff(request,deps.auth);if(!actor.ok)throw new PaymentHttpError(actor.status,actor.code);if(actor.identity.role!=='admin')throw new PaymentHttpError(403,'forbidden');
  const body=await parsePaymentJson(request,2048) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||!['status','resume','verify','initialize'].includes(String(body.action))||typeof body.orderId!=='string'||!uuid.test(body.orderId))throw new PaymentHttpError(400,'invalid_input');
  const keys=body.action==='initialize'?['action','orderId','expectedAmountMinor','previousPaymentId']:body.action==='status'?['action','orderId']:['action','orderId','paymentId'];
  if(Object.keys(body).length!==keys.length||Object.keys(body).some(k=>!keys.includes(k)))throw new PaymentHttpError(400,'invalid_input');
  stage='order_status';let row=validate(await deps.view(body.orderId,actor.identity.id),body.orderId);
  if(body.action==='status')return paymentJson(responseView(row,deps),200,cors);
  if(body.action==='initialize'){
   if(body.expectedAmountMinor!==minor(row)||body.previousPaymentId!==(row.payment_id??null))throw new PaymentHttpError(409,'stale_order_payment');
   if(row.payment_id&&!row.can_replace||responseView(row,deps).paid)throw new PaymentHttpError(409,'payment_attempt_exists');
   if(!responseView(row,deps).canInitialize)throw new PaymentHttpError(503,'capability_disabled');
   stage='reservation';const reserved=await deps.reserve(row.order_id,actor.identity.id,minor(row),row.payment_id);
   if(!reserved.created)throw new PaymentHttpError(409,'payment_attempt_exists');
   if(!uuid.test(reserved.id))throw new PaymentHttpError(409,'reservation_invalid');
   stage='single_dispatch';await deps.call('init',reserved.id);
   // Node persists before responding; no Edge retry or secondary save.
   stage='persisted_session';row=validate(await deps.view(body.orderId,actor.identity.id),body.orderId);
   if(row.payment_id!==reserved.id||row.payment_state!=='pending_provider'||!savedUrl(row)||!row.accounting_held)throw new PaymentHttpError(409,'session_recovery_required');
   const current=responseView(row,deps);
   return paymentJson({...current,...(current.payment?.canResume?{redirectUrl:savedUrl(row)}:{})},201,cors);
  }
  if(body.paymentId!==row.payment_id)throw new PaymentHttpError(409,'payment_attempt_mismatch');
  if(responseView(row,deps).paid)return paymentJson(responseView(row,deps),200,cors);
  if(!responseView(row,deps).payment?.canVerify)throw new PaymentHttpError(409,'payment_verification_unavailable');
  stage='authoritative_recovery';const attempt=checkedAttempt(await deps.get(row.payment_id!),row.payment_id!);
  if(attempt.order_id!==row.order_id||attempt.amount_minor!==minor(row))throw new PaymentHttpError(409,'payment_order_mismatch');
  const verification=await recoverCommercial(deps,attempt);
  row=validate(await deps.view(body.orderId,actor.identity.id),body.orderId);
  // Only positively usable sessions can resume. Unknown HTML never implies usability.
  return paymentJson({...responseView(row,deps),verification,...(body.action==='resume'&&responseView(row,deps).payment?.canResume?{redirectUrl:savedUrl(row)}:{})},200,cors);
 }catch(error){try{deps.log({event:'pelecard_order_payment',stage,reason:error instanceof PaymentHttpError?error.code:'unresolved'});}catch{}return failure(error,cors);}
};}
export function createCommercialFeedback(deps:CommercialDependencies){return async(request:Request)=>{
 try{
  const url=new URL(request.url),paymentId=url.searchParams.get('paymentId');if(!paymentId||!uuid.test(paymentId)||url.searchParams.getAll('paymentId').length!==1)throw new PaymentHttpError(400,'invalid_input');
  const attempt=checkedAttempt(await deps.get(paymentId),paymentId);
  if(url.searchParams.get('return')==='1'&&['GET','POST'].includes(request.method)){
   if(url.searchParams.getAll('return').length!==1)throw new PaymentHttpError(400,'invalid_input');
   const to=new URL('https://shafan-hasela-vercal.vercel.app/payment/return');to.searchParams.set('orderId',attempt.order_id);to.searchParams.set('paymentId',paymentId);to.searchParams.set('returned','1');
   return new Response(null,{status:303,headers:{Location:to.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  if([...url.searchParams].length!==1)throw new PaymentHttpError(400,'invalid_input');
  await parseControlledLiveCallback(request,{paymentId,transactionId:attempt.transaction_id,confirmationKey:attempt.confirmation_key});
  return paymentJson(await recoverCommercial(deps,attempt),200);
 }catch(error){if(error instanceof ControlledLiveCallbackError){try{deps.log({event:'pelecard_callback_rejected',...error.diagnostic});}catch{}return paymentJson({error:{code:'callback_rejected'}},400);}return failure(error);}
};}
