import {createClient} from 'npm:@supabase/supabase-js@2.45.0';
import {createPosLiveAdapter} from '../pelecard-order-payment/_deployed_shared/pelecard-live-adapter.ts';
import {createPayperAutoWake} from '../pelecard-order-payment/_deployed_shared/payper-auto-wake.ts';
import type {PosDependencies} from './pos-handler.ts';
import {classifyPosRpcError} from './pos-rpc-error.ts';

export function posRuntime():PosDependencies{
  const read=(name:string)=>Deno.env.get(name);
  const required=(name:string)=>{const value=read(name);if(!value)throw Error('invalid_configuration');return value;};
  const client=createClient(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'),
    {auth:{autoRefreshToken:false,persistSession:false}});
  const log=(event:Record<string,unknown>)=>console.error(JSON.stringify(event));
  const wakePayper=createPayperAutoWake({read,log});
  async function rpc(name:string,args:Record<string,unknown>){
    const {data,error}=await client.rpc(name,args);
    if(error){const safe=classifyPosRpcError(error,name);log({event:'pelecard_pos_rpc',operation:name,sqlstate:/^[A-Z0-9]{5}$/.test(error.code??'')?error.code:null,reason:safe.code});throw safe;}
    return data;
  }
  return {read,log,allowedOrigins:required('PAYMENTS_APP_ORIGINS').split(',').map(value=>value.trim()),
    auth:{async authenticate(token:string){
      const {data:{user},error}=await client.auth.getUser(token);if(error||!user)return null;
      const {data,error:profileError}=await client.from('profiles').select('role').eq('id',user.id).single();
      return profileError||!data?null:{id:user.id,role:String(data.role)};
    }},
    call:createPosLiveAdapter(read),
    reserve:(actorId,requestKey,lines,discount,billing)=>rpc('reserve_pos_pelecard',{
      p_actor_id:actorId,p_request_key:requestKey,p_lines:lines,p_discount:discount,p_billing:billing}),
    view:(actorId,locator)=>rpc(locator.paymentId?'get_pos_pelecard_view':'get_pos_pelecard_view_by_request',{
      p_actor_id:actorId,...(locator.paymentId?{p_payment_id:locator.paymentId}:{p_request_key:locator.requestKey})}),
    async get(paymentId){const rows=await rpc('get_pos_pelecard_attempt',{p_payment_id:paymentId});return Array.isArray(rows)&&rows.length===1?rows[0]:null;},
    observe:(paymentId,state,lookup,transaction,correlation)=>rpc('observe_pos_pelecard',{
      p_payment_id:paymentId,p_hosted_state:state,p_lookup_status:lookup,
      p_transaction_status:transaction,p_correlation_valid:correlation}),
    finalize:(paymentId,approvalId)=>rpc('finalize_pos_pelecard',{p_payment_id:paymentId,p_approval_id:approvalId}),
    onPaymentFinalized:(paymentId)=>{
      const task=wakePayper(paymentId);
      const edge=(globalThis as typeof globalThis & {EdgeRuntime?:{waitUntil?:(task:Promise<unknown>)=>void}}).EdgeRuntime;
      try{edge?.waitUntil?.(task);}catch{log({event:'payper_auto_wake_schedule_failed'});}
    },
    cancel:(actorId,requestKey)=>rpc('cancel_pos_pelecard_prepared',{p_actor_id:actorId,p_request_key:requestKey}),
  };
}
