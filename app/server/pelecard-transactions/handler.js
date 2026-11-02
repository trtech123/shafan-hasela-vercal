import {validateInput} from './validation.js';
import {normalizeResponse,scopeValid} from './normalize.js';
const origin='https://shafan-hasela-vercal.vercel.app';
const statusCodes={invalid_request:400,range_too_large:422,conflicting_provider_records:502,invalid_provider_response:502,provider_unavailable:502,provider_timeout:504,configuration_unavailable:503};
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Authorization'}});
export function createHandler({read,authenticate,query,now=Date.now}) {
 return async request=>{
  try{
   const url=new URL(request.url);
   if(url.pathname!=='/api/pelecard-transactions'||url.search||request.method!=='POST')return reply(405,{error:'invalid_request'});
   if(request.headers.get('origin')!==origin)return reply(403,{error:'forbidden'});
   const bearer=request.headers.get('authorization')??'';
   if(!/^Bearer [A-Za-z0-9._-]{1,4096}$/.test(bearer))return reply(401,{error:'unauthorized'});
   const role=await authenticate(bearer);
   if(!role)return reply(401,{error:'unauthorized'});
   if(role!=='admin')return reply(403,{error:'forbidden'});
   if(read('PELECARD_RETRIEVAL_ENABLED')!=='true')return reply(503,{error:'retrieval_disabled'});
   const scope=read('PELECARD_RETRIEVAL_SCOPE_ID');if(!scopeValid(scope))throw Error('configuration_unavailable');
   if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw Error('invalid_request');
   const reader=request.body?.getReader();if(!reader)throw Error('invalid_request');
   const chunks=[];let length=0;
   while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1024){await reader.cancel();throw Error('invalid_request')}chunks.push(value);}
   let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))}catch{throw Error('invalid_request')}
   const input=validateInput(body,now());
   const transactions=normalizeResponse(await query(input),scope,input,['PELECARD_LIVE_TERMINAL','PELECARD_LIVE_USER','PELECARD_LIVE_PASSWORD'].map(read));
   return reply(200,{transactions,source:input.action==='range'?'GetTransData':'GetTransDataByTrxId',retrievedAt:new Date(now()).toISOString()});
  }catch(error){
   // Never forward or log provider errors, personal data, or raw responses.
   const code=Object.hasOwn(statusCodes,error?.message)?error.message:'provider_unavailable';
   return reply(statusCodes[code],{error:code});
  }
 };
}
