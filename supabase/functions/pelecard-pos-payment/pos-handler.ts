import {authorizeStaff,type PaymentAuthenticator} from '../pelecard-order-payment/_deployed_shared/payment-auth.ts';
import {paymentCorsHeaders,paymentJson,parsePaymentJson,PaymentHttpError} from '../pelecard-order-payment/_deployed_shared/payment-http.ts';
import {verifyOrderGetTransaction} from '../pelecard-order-payment/_deployed_shared/pelecard-live-verification.ts';
import {parseControlledLiveCallback,ControlledLiveCallbackError} from '../pelecard-order-payment/_deployed_shared/pelecard-live-callback.ts';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const providerId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hostedPrefix='https://gateway20.pelecard.biz/PaymentGW?transactionId=';
type Attempt={payment_id:string;amount_minor:number;currency:string;transaction_id:string;confirmation_key:string;hosted_state:string;hosted_expires_at:string|null};
type View={paymentId:string;amountMinor:number;currency:string;status:string;saleId:string|null;receiptNumber:string|null;hostedState:string;hostedExpiresAt:string|null;redirectUrl:string|null;canVerify:boolean;dispatchStarted:boolean};
type Billing={kind:string;name:string;identity:string;email:string};
export interface PosDependencies {
  auth:PaymentAuthenticator;allowedOrigins:readonly string[];read(name:string):string|undefined;
  reserve(actorId:string,requestKey:string,lines:unknown,discount:unknown,billing:Billing):Promise<{paymentId:string;created:boolean;amountMinor:number}>;
  view(actorId:string,locator:{requestKey?:string;paymentId?:string}):Promise<View|null>;
  get(paymentId:string):Promise<Attempt|null>;
  observe(paymentId:string,hostedState:string,apiStatus:string|null,transactionStatus:string|null,correlation:boolean):Promise<unknown>;
  finalize(paymentId:string,approvalId:string):Promise<unknown>;
  onPaymentFinalized?(paymentId:string):void;
  cancel(actorId:string,requestKey:string):Promise<boolean>;
  call(action:'init'|'lookup'|'validate'|'hosted',paymentId:string):Promise<unknown>;
  log(event:Record<string,unknown>):void;
  now?():number;
}
function failure(error:unknown,cors:HeadersInit={}){
  return error instanceof PaymentHttpError?paymentJson({error:{code:error.code}},error.status,cors):paymentJson({error:{code:'payment_operation_unresolved'}},502,cors);
}
function attempt(row:Attempt|null,paymentId:string):Attempt{
  if(!row||row.payment_id!==paymentId||!providerId.test(row.transaction_id)||!row.confirmation_key||
    !Number.isSafeInteger(row.amount_minor)||row.amount_minor<1||row.amount_minor>2147483647||row.currency!=='ILS')
    throw new PaymentHttpError(409,'stored_session_unavailable');
  return row;
}
function responseView(view:View|null,now:number){
  if(!view||!uuid.test(view.paymentId)||!Number.isSafeInteger(view.amountMinor)||view.amountMinor<1||view.currency!=='ILS')
    throw new PaymentHttpError(404,'payment_not_found');
  if((view.status==='succeeded')!==!!view.saleId)throw new PaymentHttpError(409,'payment_state_inconsistent');
  const paid=view.status==='succeeded'&&!!view.saleId;
  const canResume=!paid&&view.status==='pending_provider'&&view.hostedState==='usable'&&
    !!view.hostedExpiresAt&&Date.parse(view.hostedExpiresAt)>now&&
    typeof view.redirectUrl==='string'&&providerId.test(view.redirectUrl.slice(hostedPrefix.length))&&
    view.redirectUrl===hostedPrefix+view.redirectUrl.slice(hostedPrefix.length);
  return {mode:'pos',...view,redirectUrl:canResume?view.redirectUrl:null,paid,canResume,canVerify:!paid&&view.canVerify===true,serverTime:new Date(now).toISOString()};
}
export async function recoverPos(deps:PosDependencies,paymentId:string){
  const saved=attempt(await deps.get(paymentId),paymentId);
  const evidence=verifyOrderGetTransaction(await deps.call('lookup',paymentId),{
    transactionId:saved.transaction_id,confirmationKey:saved.confirmation_key,amountMinor:saved.amount_minor,currency:'ILS'});
  const correlated=await deps.call('validate',paymentId)===1;
  if(!correlated)throw new PaymentHttpError(409,'provider_correlation_mismatch');
  let hostedState=Date.parse(saved.hosted_expires_at??'')<= (deps.now?.()??Date.now())?'expired':saved.hosted_state;
  if(!evidence.approved&&hostedState!=='expired'){
    try{const hosted=await deps.call('hosted',paymentId) as {state?:string;code?:string;reachable?:boolean};
      if(hosted?.state==='expired'&&hosted.code==='0003')hostedState='expired';
      else if(hosted?.reachable!==true)throw Error('hosted_session_unavailable');
    }catch{throw new PaymentHttpError(503,'hosted_session_unavailable');}
  }
  await deps.observe(paymentId,hostedState,evidence.apiStatus,evidence.transactionStatus,correlated);
  if(evidence.approved){
    await deps.finalize(paymentId,evidence.approvalId);
    try{deps.onPaymentFinalized?.(paymentId);}catch{}
  }
  return {approved:evidence.approved,resolution:evidence.approved?'approved':'unknown',
    apiStatus:evidence.apiStatus,transactionStatus:evidence.transactionStatus};
}
export function createPosHandler(deps:PosDependencies){return async(request:Request):Promise<Response>=>{
  let cors:HeadersInit={},stage='authorization';
  try{
    cors=paymentCorsHeaders(request,deps.allowedOrigins);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(request.method!=='POST')throw new PaymentHttpError(405,'method_not_allowed');
    const actor=await authorizeStaff(request,deps.auth);
    if(!actor.ok)throw new PaymentHttpError(actor.status,actor.code);
    if(!['admin','cashier'].includes(actor.identity.role))throw new PaymentHttpError(403,'forbidden');
    const body=await parsePaymentJson(request,16384) as Record<string,unknown>;
    if(!body||typeof body!=='object'||Array.isArray(body)||!['prepare','initialize','status','verify','cancel'].includes(String(body.action)))
      throw new PaymentHttpError(400,'invalid_input');
    if(body.action==='prepare'){
      if(Object.keys(body).sort().join(',')!=='action,billing,discount,lines,requestKey'||
        !uuid.test(String(body.requestKey))||!Array.isArray(body.lines)||body.lines.length<1||body.lines.length>100||
        body.lines.some(line=>!line||typeof line!=='object'||Array.isArray(line)||Object.keys(line).sort().join(',')!=='id,kind,qty'||
          !uuid.test(String(line.id))||!['product','service'].includes(line.kind)||!Number.isSafeInteger(line.qty)||line.qty<1||line.qty>1000)||
        !body.billing||typeof body.billing!=='object'||Array.isArray(body.billing)||
        Object.keys(body.billing).sort().join(',')!=='email,identity,kind,name'||
        Object.values(body.billing).some(value=>typeof value!=='string'||value.length>320))
        throw new PaymentHttpError(400,'invalid_input');
      if(deps.read('PELECARD_POS_PAYMENTS_ENABLED')!=='true')throw new PaymentHttpError(503,'capability_disabled');
      stage='reservation';
      const reserved=await deps.reserve(actor.identity.id,String(body.requestKey),body.lines,body.discount,body.billing as Billing);
      if(!uuid.test(reserved.paymentId)||!Number.isSafeInteger(reserved.amountMinor)||reserved.amountMinor<1)
        throw new PaymentHttpError(502,'reservation_invalid');
      return paymentJson(responseView(await deps.view(actor.identity.id,{paymentId:reserved.paymentId}),deps.now?.()??Date.now()),reserved.created?201:200,cors);
    }
    const keys=Object.keys(body).sort().join(',');
    if(!['action,paymentId','action,requestKey'].includes(keys)||
      !uuid.test(String(body.paymentId??body.requestKey)))throw new PaymentHttpError(400,'invalid_input');
    const locator=body.paymentId?{paymentId:String(body.paymentId)}:{requestKey:String(body.requestKey)};
    stage='status';let view=await deps.view(actor.identity.id,locator);
    if(!view)throw new PaymentHttpError(404,'payment_not_found');
    if(body.action==='cancel'){
      if(keys!=='action,requestKey')throw new PaymentHttpError(400,'invalid_input');
      await deps.cancel(actor.identity.id,String(body.requestKey));
      view=await deps.view(actor.identity.id,locator);
      return paymentJson(responseView(view,deps.now?.()??Date.now()),200,cors);
    }
    if(body.action==='initialize'){
      if(keys!=='action,requestKey'||view.status!=='initiated'||view.dispatchStarted)throw new PaymentHttpError(409,'payment_attempt_exists');
      if(deps.read('PELECARD_POS_PAYMENTS_ENABLED')!=='true')throw new PaymentHttpError(503,'capability_disabled');
      stage='single_dispatch';await deps.call('init',view.paymentId);
      view=await deps.view(actor.identity.id,{paymentId:view.paymentId});
      return paymentJson(responseView(view,deps.now?.()??Date.now()),200,cors);
    }
    if(body.action==='verify'&&view.status!=='succeeded'){
      if(!view.canVerify)throw new PaymentHttpError(409,'payment_verification_unavailable');
      stage='provider_verification';const verification=await recoverPos(deps,view.paymentId);
      view=await deps.view(actor.identity.id,{paymentId:view.paymentId});
      return paymentJson({...responseView(view,deps.now?.()??Date.now()),verification},200,cors);
    }
    return paymentJson(responseView(view,deps.now?.()??Date.now()),200,cors);
  }catch(error){try{deps.log({event:'pelecard_pos_payment',stage,reason:error instanceof PaymentHttpError?error.code:'unresolved'});}catch{}return failure(error,cors);}
};}
export function createPosFeedback(deps:PosDependencies){return async(request:Request):Promise<Response>=>{
  try{
    const url=new URL(request.url),paymentId=url.searchParams.get('paymentId');
    if(!paymentId||!uuid.test(paymentId)||url.searchParams.getAll('paymentId').length!==1)
      throw new PaymentHttpError(400,'invalid_input');
    const saved=attempt(await deps.get(paymentId),paymentId);
    if(url.searchParams.get('return')==='1'&&['GET','POST'].includes(request.method)){
      if(url.searchParams.getAll('return').length!==1)throw new PaymentHttpError(400,'invalid_input');
      const to=new URL('https://shafan-hasela-vercal.vercel.app/payment/pos');
      to.searchParams.set('paymentId',paymentId);to.searchParams.set('returned','1');
      return new Response(null,{status:303,headers:{Location:to.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
    }
    if([...url.searchParams].length!==1)throw new PaymentHttpError(400,'invalid_input');
    await parseControlledLiveCallback(request,{paymentId,transactionId:saved.transaction_id,confirmationKey:saved.confirmation_key});
    const result=await recoverPos(deps,paymentId);
    try{deps.log({event:'pelecard_pos_callback_checked',paymentId,approved:result.approved,
      apiStatus:result.apiStatus,transactionStatus:result.transactionStatus});}catch{}
    return paymentJson(result,200);
  }catch(error){if(error instanceof ControlledLiveCallbackError){try{deps.log({event:'pelecard_pos_callback_rejected',...error.diagnostic});}catch{}return paymentJson({error:{code:'callback_rejected'}},400);}return failure(error);}
};}
