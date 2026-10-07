import {createClient} from 'npm:@supabase/supabase-js@2.45.0';
import {createOrderLiveAdapter} from './pelecard-live-adapter.ts';
import type {CommercialDependencies} from './pelecard-commercial.ts';
export function commercialRuntime():CommercialDependencies {
 const read=(name:string)=>Deno.env.get(name);
 const required=(name:string)=>{const value=read(name);if(!value)throw Error('invalid_configuration');return value;};
 const client=createClient(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'),{auth:{autoRefreshToken:false,persistSession:false}});
 const log=(event:Record<string,unknown>)=>console.error(JSON.stringify(event));
 async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await client.rpc(name,args);if(error){log({event:'pelecard_commercial_rpc',operation:name,sqlstate:/^[A-Z0-9]{5}$/.test(error.code??'')?error.code:null});throw Error('payment_database_unavailable');}return data;}
 return {read,auth:{async authenticate(token:string){const {data:{user},error}=await client.auth.getUser(token);if(error||!user)return null;const {data,error:profileError}=await client.from('profiles').select('role').eq('id',user.id).single();return profileError||!data?null:{id:user.id,role:String(data.role)};}},allowedOrigins:required('PAYMENTS_APP_ORIGINS').split(',').map(s=>s.trim()),log,call:createOrderLiveAdapter(read),
  view:(orderId,actorId)=>rpc('get_pelecard_order_payment_ui',{p_order_id:orderId,p_actor_id:actorId}),
  reserve:(orderId,actorId,amount,previous)=>rpc('reserve_pelecard_live_order',{p_order_id:orderId,p_actor_id:actorId,p_expected_amount_minor:amount,p_previous_payment_id:previous}),
  async get(id){const data=await rpc('get_pelecard_live_attempt',{p_payment_id:id});return Array.isArray(data)&&data.length===1?data[0]:null;},
  observe:(id,state,status,transaction,correlation)=>rpc('observe_pelecard_live_attempt',{p_payment_id:id,p_hosted_state:state,p_lookup_status:status,p_transaction_status:transaction,p_correlation_valid:correlation}),
  finalize:(attempt,approval)=>rpc('finalize_pelecard_live',{p_payment_id:attempt.payment_id,p_provider_transaction_id:attempt.transaction_id,p_approval_id:approval,p_provider_status_code:'000',p_amount:attempt.amount_minor/100,p_currency:attempt.currency}),
 };
}
