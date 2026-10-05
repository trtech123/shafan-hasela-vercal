import https from 'node:https';
import {checkServerIdentity} from 'node:tls';
const host='gateway20.pelecard.biz';
const paths=Object.freeze({init:'/PaymentGW/init',lookup:'/PaymentGW/GetTransaction',validate:'/PaymentGW/ValidateByUniqueKey'});
export const ciphers='ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256';
function record(value){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_provider_response');return value;}
function pick(value,fields){const result={};for(const field of fields)if(value[field]!==undefined){if(!['string','number'].includes(typeof value[field])||String(value[field]).length>2048||/[\x00-\x1f\x7f]/.test(String(value[field])))throw new Error('invalid_provider_response');result[field]=value[field];}return result;}
function rejectCredentialEcho(value,credentials){
 const item=String(value);
 for(const secret of Object.values(credentials))if(item===secret||item===encodeURIComponent(secret))throw new Error('provider_secret_echo');
 for(const secret of [credentials.user,credentials.password])if(secret.length>=6&&(item.includes(secret)||item.includes(encodeURIComponent(secret))))throw new Error('provider_secret_echo');
}
function sanitize(action,value,credentials){
 if(action==='validate'){if(value!==0&&value!==1)throw new Error('invalid_provider_response');return value;}
 record(value);
 if(action==='lookup'){
  if(typeof value.StatusCode!=='string'||!/^\d{2,3}$/.test(value.StatusCode))throw new Error('invalid_provider_response');
  if(value.ResultData==null)return {StatusCode:value.StatusCode,ResultData:null};
  const result={StatusCode:value.StatusCode,ResultData:pick(record(value.ResultData),['TransactionId','ConfirmationKey','ShvaResult','ShvaResultEmv','DebitTotal','DebitCurrency','JParam','DebitType','ApprovedBy','DebitApproveNumber'])};
  for(const field of ['ShvaResult','ShvaResultEmv','DebitTotal','DebitCurrency','JParam','DebitType','ApprovedBy']){
   const item=result.ResultData[field];
   if(item!==undefined&&!(field.startsWith('Shva')?/^\d{2,3}$/:/^\d{1,12}$/).test(String(item)))throw new Error('invalid_provider_response');
  }
  for(const field of ['TransactionId','ConfirmationKey','DebitApproveNumber'])if(result.ResultData[field]!==undefined){
   rejectCredentialEcho(result.ResultData[field],credentials);
  }
  return result;
 }
 if(value.StatusCode!==undefined&&value.StatusCode!=='000')throw new Error('invalid_provider_response');
 const result=pick(value,['URL','TransactionId','ConfirmationKey','StatusCode']);
 for(const field of ['URL','ConfirmationKey'])if(typeof result[field]!=='string'||!result[field]||result[field].trim()!==result[field])throw new Error('invalid_provider_response');
 // Match the deployed save-session RPC so an accepted result is persistable.
 if(!/^[A-Za-z0-9_+/=-]{1,512}$/.test(result.ConfirmationKey))throw new Error('invalid_provider_response');
 const url=new URL(result.URL);if(url.origin!==`https://${host}`||url.username||url.password||url.pathname!=='/PaymentGW'||url.hash)throw new Error('invalid_provider_url');
 const transactionId=url.searchParams.get('transactionId');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(transactionId??'')||url.searchParams.size!==1||(result.TransactionId!==undefined&&result.TransactionId!==transactionId))throw new Error('invalid_provider_response');
 result.TransactionId=transactionId;
 result.URL=`https://${host}/PaymentGW?transactionId=${transactionId}`;
 for(const field of ['URL','ConfirmationKey','TransactionId'])if(result[field])rejectCredentialEcho(result[field],credentials);
 return result;
}
export function sendLive(input,request=https.request){if(input.attempt.amount_minor!==3500)throw new Error('invalid_input');return sendStoredOrder(input,request,'pelecard-controlled-live-feedback');}
export function sendStoredOrder({action,paymentId,credentials,attempt},request=https.request,feedback='pelecard-order-feedback'){
 if(!Object.hasOwn(paths,action)||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId)||!Number.isSafeInteger(attempt.amount_minor)||attempt.amount_minor<1||attempt.amount_minor>2147483647||attempt.currency!=='ILS')throw new Error('invalid_input');
 let body;
 if(action==='init'){
  const callback=new URL('https://divzxsynczeifkpnpupl.supabase.co/functions/v1/'+feedback);callback.searchParams.set('paymentId',paymentId);
  const returned=new URL(callback);returned.searchParams.set('return','1');
  body={terminal:credentials.terminal,user:credentials.user,password:credentials.password,ActionType:'J4',Currency:'1',Total:String(attempt.amount_minor),FreeTotal:'False',CreateToken:'False',UserKey:paymentId,GoodURL:returned.href,ErrorURL:returned.href,CancelURL:returned.href,ServerSideGoodFeedbackURL:callback.href,ServerSideErrorFeedbackURL:callback.href,resultDataKeyName:'result'};
 }else if(action==='lookup')body={terminal:credentials.terminal,user:credentials.user,password:credentials.password,TransactionId:attempt.transaction_id};
 else body={ConfirmationKey:attempt.confirmation_key,UniqueKey:paymentId,TotalX100:String(attempt.amount_minor)};
 const payload=JSON.stringify(body);
 return new Promise((resolve,reject)=>{
  const req=request({hostname:host,servername:host,port:443,path:paths[action],method:'POST',agent:false,minVersion:'TLSv1.2',maxVersion:'TLSv1.3',ciphers,rejectUnauthorized:true,checkServerIdentity,signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(payload)}},async response=>{
   try{
    if(response.statusCode<200||response.statusCode>=300)throw new Error('provider_http_error');
    const chunks=[];let size=0;for await(const chunk of response){size+=chunk.length;if(size>65536)throw new Error('provider_response_too_large');chunks.push(Buffer.from(chunk));}
    resolve(sanitize(action,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))),credentials));
   }catch(error){response.destroy();reject(error);}
  });req.on('error',reject);req.end(payload);
 });
}
