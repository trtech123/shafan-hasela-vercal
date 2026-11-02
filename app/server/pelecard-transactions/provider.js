import https from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {validateInput} from './validation.js';

export async function queryProvider(input,read,request=https.request) {
 // Revalidate at the transport boundary. There is no caller-controlled endpoint.
 const checked=validateInput(input.action==='range'?{action:'range',start:input.start,end:input.end}:input);
 const credentials={terminalNumber:read('PELECARD_LIVE_TERMINAL'),user:read('PELECARD_LIVE_USER'),password:read('PELECARD_LIVE_PASSWORD')};
 if(Object.values(credentials).some(v=>typeof v!=='string'||!v||v.length>2048||v!==v.trim()))throw Error('configuration_unavailable');
 const path=checked.action==='range'?'/services/GetTransData':'/services/GetTransDataByTrxId';
 const body=checked.action==='range'?{...credentials,startDate:checked.startDate,endDate:checked.endDate}:{...credentials,DebitTrxId:checked.transactionId};
 const payload=JSON.stringify(body);
 return new Promise((resolve,reject)=>{
  const failed=code=>reject(Error(code));
  const q=request({hostname:'gateway20.pelecard.biz',servername:'gateway20.pelecard.biz',port:443,path,method:'POST',agent:false,minVersion:'TLSv1.2',maxVersion:'TLSv1.3',ciphers:'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256',rejectUnauthorized:true,checkServerIdentity,signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(payload)}},async response=>{
   try{
    if(response.statusCode!==200){response.destroy();return failed('provider_unavailable')}
    const chunks=[];let size=0;
    for await(const chunk of response){size+=Buffer.byteLength(chunk);if(size>2*1024*1024){response.destroy();return failed('range_too_large')}chunks.push(Buffer.from(chunk));}
    resolve(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
   }catch{response.destroy();failed('provider_unavailable')}
  });
  q.on('error',error=>failed(['AbortError','TimeoutError'].includes(error?.name)?'provider_timeout':'provider_unavailable'));
  q.end(payload);
 });
}
