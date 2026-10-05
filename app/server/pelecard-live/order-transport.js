import https from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {sendStoredOrder,ciphers} from './transport.js';
export const sendOrderLive=(input,request=https.request)=>sendStoredOrder(input,request);

// A page observation is NEVER evidence of payment failure or permission to retry.
// Unknown HTML is deliberately not classified as a usable payment form.
export function inspectHostedPage(attempt,request=https.request){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attempt.transaction_id??'')||!Number.isSafeInteger(attempt.amount_minor)||attempt.amount_minor<1||attempt.amount_minor>2147483647||attempt.currency!=='ILS')throw Error('invalid_attempt');
 return new Promise((resolve,reject)=>{
  const req=request({hostname:'gateway20.pelecard.biz',servername:'gateway20.pelecard.biz',port:443,path:'/PaymentGW?transactionId='+attempt.transaction_id,method:'GET',agent:false,minVersion:'TLSv1.2',maxVersion:'TLSv1.3',ciphers,rejectUnauthorized:true,checkServerIdentity,signal:AbortSignal.timeout(10000),headers:{Accept:'text/html'}},async response=>{
   try{
    if(response.statusCode!==200||!response.headers['content-type']?.toLowerCase().includes('text/html')){response.destroy();return resolve({state:'unknown',code:null});}
    let raw='';for await(const chunk of response){raw+=chunk.toString('utf8');if(raw.length>150000)throw Error('provider_response_too_large');}
    const text=raw.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ');
    const expired=/Request\s+has\s+expired/i.test(text)&&/Error code:\s*0003(?:\s|$)/i.test(text);
    // Reachability only retains an init-confirmed session's usability; it does
    // not promote unknown sessions or establish any financial outcome.
    resolve(expired?{state:'expired',code:'0003'}:{state:'unknown',code:null,reachable:true});
   }catch{response.destroy();reject(Error('hosted_observation_unavailable'));}
  });req.on('error',()=>reject(Error('hosted_observation_unavailable')));req.end();
 });
}
