import {createHmac,timingSafeEqual} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const failure=(status,code)=>reply(status,{error:{code}});
async function readBody(request){
 if(!request.body)throw new Error('invalid_body');
 const reader=request.body.getReader(),chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();throw new Error('invalid_body');}chunks.push(value);}
 return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
}
const text=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);
export const handleLive=(request,deps)=>handle(request,deps,false);
export const handleOrderLive=(request,deps)=>handle(request,deps,true);
async function handle(request,{read,claim,getAttempt,send,persist,preflight,hosted,now=Date.now,log=event=>console.error(JSON.stringify(event))},orderMode){
 const endpoint=orderMode?'/api/pelecard-order':'/api/pelecard-live';
 const executionGate=orderMode?'PELECARD_LIVE_PAYMENTS_ENABLED':'PELECARD_CONTROLLED_LIVE_ENABLED';
 const url=new URL(request.url);
 if(url.pathname!==endpoint||url.search||request.method!=='POST')return failure(405,'invalid_request');
 if(read('PELECARD_LIVE_ADAPTER_MODE')!=='live')return failure(503,'capability_disabled');
 const key=read('PELECARD_LIVE_ADAPTER_AUTH_KEY');
 if(!key||!/^[a-f0-9]{64}$/.test(key))return failure(503,'invalid_configuration');
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return failure(400,'invalid_request');
 let raw,body;try{raw=await readBody(request);body=JSON.parse(raw);}catch{return failure(400,'invalid_request');}
 const signature=request.headers.get('x-pelecard-signature');
 const expected=createHmac('sha256',key).update('POST\n'+endpoint+'\n'+raw).digest();
 if(!signature||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature,'hex'),expected))return failure(401,'unauthorized');
 const current=now();
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='action,issuedAt,paymentId'||!['init','lookup','validate','preflight',...(orderMode?['hosted']:[])].includes(body.action)||typeof body.paymentId!=='string'||!uuid.test(body.paymentId)||!Number.isSafeInteger(body.issuedAt)||body.issuedAt>current+5000||current-body.issuedAt>30000)return failure(400,'invalid_request');
 if(body.action==='init'&&read(executionGate)!=='true')return failure(503,'capability_disabled');
 if(body.action==='init'&&typeof persist!=='function')return failure(503,'invalid_configuration');
 if(body.action==='preflight'&&read(executionGate)!=='false')return failure(503,'capability_disabled');
 const credentials={};
 for(const [field,name] of [['user','PELECARD_LIVE_USER'],['password','PELECARD_LIVE_PASSWORD'],['terminal','PELECARD_LIVE_TERMINAL']]){const value=read(name);if(!text(value))return failure(503,'invalid_configuration');credentials[field]=value;}
 let stage='database';
 try{
  if(body.action==='preflight'){stage='preflight';if(typeof preflight!=='function')return failure(503,'invalid_configuration');return reply(200,{credentialsConfigured:true,...await preflight()});}
  const attempt=body.action==='init'?await claim(body.paymentId):await getAttempt(body.paymentId);
  if(!attempt)return failure(409,'already_dispatched_or_ineligible');
  if(!Number.isSafeInteger(attempt.amount_minor)||attempt.amount_minor<1||attempt.amount_minor>2147483647||(!orderMode&&attempt.amount_minor!==3500)||attempt.currency!=='ILS')throw new Error('invalid_attempt');
  if(body.action!=='init'&&(attempt.payment_id!==body.paymentId||!text(attempt.transaction_id)||!text(attempt.confirmation_key)))throw new Error('invalid_attempt');
  stage=body.action;
  const result=body.action==='hosted'?await hosted(attempt):await send({action:body.action,paymentId:body.paymentId,credentials,attempt});
  // A lost Node-to-Edge response remains recoverable from this committed snapshot.
  // Persistence failure never releases the dispatch claim or repeats provider init.
  if(body.action==='init'){stage='persist';await persist(body.paymentId,result);}
  return reply(200,result);
 }catch(error){
  const reason=/handshake failure|HandshakeFailure/i.test(String(error?.message))?'tls_handshake_failure':['TimeoutError','AbortError'].includes(error?.name)?'timeout_or_abort':['EPROTO','ECONNRESET','ENOTFOUND','ETIMEDOUT'].includes(error?.code)?error.code:'unclassified';
  try{log({event:'pelecard_controlled_live_adapter_failure',stage,reason});}catch{/* Logging cannot affect payment state. */}
  return failure(502,['init','persist'].includes(stage)?'init_outcome_unknown':stage==='database'?'database_unavailable':'provider_unavailable');
 }
}
