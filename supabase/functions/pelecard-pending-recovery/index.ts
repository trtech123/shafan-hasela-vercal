import {createClient} from 'npm:@supabase/supabase-js@2.45.0';
import {createPendingRecoveryHandler,type RecoveryDependencies} from './recovery.ts';
import {posRuntime} from '../pelecard-pos-payment/pos-runtime.ts';
import {recoverPos} from '../pelecard-pos-payment/pos-handler.ts';
import {commercialRuntime} from '../pelecard-order-payment/_deployed_shared/pelecard-commercial-runtime.ts';
import {recoverCommercial} from '../pelecard-order-payment/_deployed_shared/pelecard-commercial.ts';

function runtime():{secret:string;enabled:()=>boolean;deps:RecoveryDependencies}{
  const read=(name:string)=>Deno.env.get(name);
  const required=(name:string)=>{const value=read(name);if(!value)throw Error('invalid_configuration');return value;};
  const client=createClient(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'),
    {auth:{autoRefreshToken:false,persistSession:false}});
  const log=(event:Record<string,unknown>)=>console.error(JSON.stringify(event));
  async function rpc(name:string,args:Record<string,unknown>){
    const {data,error}=await client.rpc(name,args);
    if(error){log({event:'pelecard_pending_recovery_rpc',operation:name,
      sqlstate:/^[A-Z0-9]{5}$/.test(error.code??'')?error.code:null});
      throw Error('recovery_database_unavailable');}
    return data;
  }
  const deps:RecoveryDependencies={
    log,
    async take(){const rows=await rpc('claim_pelecard_pending_recovery',{});
      if(!Array.isArray(rows)||rows.length===0)return null;
      if(rows.length!==1)throw Error('invalid_recovery_claim');
      return {paymentId:rows[0].payment_id,source:rows[0].source,
        claimToken:rows[0].claim_token};},
    async recover(source,paymentId){
      if(source==='pos'){
        const pos=posRuntime();const result=await recoverPos(pos,paymentId);
        return {approved:result.approved,apiStatus:result.apiStatus,
          transactionStatus:result.transactionStatus};
      }
      const orders=commercialRuntime();const attempt=await orders.get(paymentId);
      if(!attempt)throw Error('stored_session_unavailable');
      const result=await recoverCommercial(orders,attempt);
      return {approved:result.approved,apiStatus:result.StatusCode,
        transactionStatus:result.ShvaResult};
    },
    async finish(paymentId,claimToken,outcome,apiStatus,transactionStatus){
      await rpc('complete_pelecard_pending_recovery',{p_payment_id:paymentId,
        p_claim_token:claimToken,p_outcome:outcome,p_lookup_status:apiStatus,
        p_transaction_status:transactionStatus});},
  };
  return {secret:required('PELECARD_PENDING_RECOVERY_TOKEN'),
    enabled:()=>read('PELECARD_PENDING_RECOVERY_ENABLED')==='true',deps};
}
Deno.serve(async request=>{
  try{const {secret,enabled,deps}=runtime();
    return await createPendingRecoveryHandler(secret,enabled,deps)(request);
  }catch{return new Response(JSON.stringify({error:'invalid_configuration'}),{status:503,
    headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
});
