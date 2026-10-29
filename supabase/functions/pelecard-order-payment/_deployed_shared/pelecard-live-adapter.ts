import {PaymentError} from './payment-types.ts';
export const LIVE_ADAPTER_URL='https://shafan-hasela-vercal.vercel.app/api/pelecard-live';
export function createLiveAdapter(read:(name:string)=>string|undefined,fetcher:typeof fetch=fetch,now:()=>number=Date.now){return adapter(read,fetcher,now,false);}
export function createOrderLiveAdapter(read:(name:string)=>string|undefined,fetcher:typeof fetch=fetch,now:()=>number=Date.now){return adapter(read,fetcher,now,true);}
function adapter(read:(name:string)=>string|undefined,fetcher:typeof fetch,now:()=>number,orderMode:boolean){
 const path=orderMode?'/api/pelecard-order':'/api/pelecard-live';
 return async(action:'init'|'lookup'|'validate'|'hosted',paymentId:string):Promise<unknown>=>{
  const key=read('PELECARD_LIVE_ADAPTER_AUTH_KEY');
  if(!key||!/^[a-f0-9]{64}$/.test(key))throw new PaymentError('invalid_configuration');
  if(!['init','lookup','validate',...(orderMode?['hosted']:[])].includes(action)||!/^[0-9a-f-]{36}$/.test(paymentId))throw new PaymentError('invalid_input');
  const raw=JSON.stringify({action,paymentId,issuedAt:now()});
  const encoder=new TextEncoder();
  const cryptoKey=await crypto.subtle.importKey('raw',encoder.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',cryptoKey,encoder.encode(`POST\n${path}\n${raw}`)));
  const hex=[...signature].map(b=>b.toString(16).padStart(2,'0')).join('');
  try{
   const response=await fetcher(orderMode?'https://shafan-hasela-vercal.vercel.app'+path:LIVE_ADAPTER_URL,{method:'POST',headers:{'Content-Type':'application/json','x-pelecard-signature':hex},body:raw,redirect:'error',signal:AbortSignal.timeout(20_000)});
   if(!response.ok||!response.body)throw new PaymentError('provider_unavailable');
   const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65_536){await reader.cancel();throw new PaymentError('invalid_provider_response');}chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch(error){if(error instanceof PaymentError)throw error;throw new PaymentError('provider_unavailable');}
 };
}
