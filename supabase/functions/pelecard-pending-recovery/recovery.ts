type Source='pos'|'order';
type Outcome='verified'|'pending'|'declined'|'provider_unavailable'|'review_required';
type Claim={paymentId:string;source:Source;claimToken:string};
type Evidence={approved:boolean;apiStatus:string;transactionStatus:string|null};
export interface RecoveryDependencies {
  take():Promise<Claim|null>;
  recover(source:Source,paymentId:string):Promise<Evidence>;
  finish(paymentId:string,claimToken:string,outcome:Outcome,apiStatus:string|null,
    transactionStatus:string|null):Promise<void>;
  log(event:Record<string,unknown>):void;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function classify(error:unknown):Outcome {
  const code=error instanceof Error?error.message:'';
  return ['provider_correlation_mismatch','stored_session_unavailable','payment_attempt_closed',
    'invalid_provider_response','pos_verification_required','live_verification_mismatch'].includes(code)
    ?'review_required':'provider_unavailable';
}
/** One durable claim per invocation. A lease may repeat only read-only lookups;
 * existing finalizers and the Payper ledger enforce financial idempotency. */
export async function runPendingRecovery(deps:RecoveryDependencies){
  const claim=await deps.take();
  if(!claim)return {processed:0,outcome:'idle'};
  if(!uuid.test(claim.paymentId)||!uuid.test(claim.claimToken)||!['pos','order'].includes(claim.source))
    throw Error('invalid_recovery_claim');
  let outcome:Outcome='provider_unavailable',apiStatus:string|null=null,transactionStatus:string|null=null;
  try{
    const result=await deps.recover(claim.source,claim.paymentId);
    apiStatus=/^\d{2,4}$/.test(result.apiStatus)?result.apiStatus:null;
    transactionStatus=result.transactionStatus&&/^\d{2,4}$/.test(result.transactionStatus)
      ?result.transactionStatus:null;
    outcome=result.approved?'verified':apiStatus==='000'&&transactionStatus!==null&&
      transactionStatus!=='000'?'declined':'pending';
  }catch(error){outcome=classify(error);}
  await deps.finish(claim.paymentId,claim.claimToken,outcome,apiStatus,transactionStatus);
  try{deps.log({event:'pelecard_pending_recovery_checked',paymentId:claim.paymentId,
    source:claim.source,outcome,apiStatus,transactionStatus});}catch{}
  return {processed:1,outcome};
}
async function validBody(request:Request){
  if(!request.body)return true;
  const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const part=await reader.read();if(part.done)break;
    size+=part.value.byteLength;if(size>16)return false;chunks.push(part.value);}
    const data=new Uint8Array(size);let offset=0;
    for(const part of chunks){data.set(part,offset);offset+=part.length;}
    return new TextDecoder('utf-8',{fatal:true}).decode(data).trim()==='{}';
  }catch{return false;}finally{reader.releaseLock();}
}
export function createPendingRecoveryHandler(token:string,enabled:()=>boolean,deps:RecoveryDependencies){
  if(token.length<16)throw Error('recovery_token_required');
  return async(request:Request):Promise<Response>=>{
    const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
    if(request.method!=='POST')return new Response(null,{status:405,headers});
    if(request.headers.get('authorization')!==`Bearer ${token}`)
      return new Response(null,{status:401,headers});
    if(new URL(request.url).search||!(await validBody(request)))
      return new Response(null,{status:400,headers});
    if(!enabled())return new Response(null,{status:403,headers});
    try{return new Response(JSON.stringify(await runPendingRecovery(deps)),{status:200,headers});}
    catch{return new Response(JSON.stringify({error:'recovery_unavailable'}),{status:503,headers});}
  };
}
