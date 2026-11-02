import {validOrderId} from './orderPayments';

export async function requestPosPayment(client,body){
  if(!client?.functions?.invoke||!body||!['prepare','initialize','status','verify','cancel'].includes(body.action))throw Error('invalid_request');
  const startedAt=performance.now();
  const {data,error}=await client.functions.invoke('pelecard-pos-payment',{body});
  if(error||!data||data.mode!=='pos'||!validOrderId(data.paymentId)||!Number.isSafeInteger(data.amountMinor)||data.amountMinor<1||data.currency!=='ILS'||typeof data.paid!=='boolean')throw Error('payment_status_unavailable');
  const remaining=Date.parse(data.hostedExpiresAt)-Date.parse(data.serverTime);
  return {...data,hostedDeadlineMs:Number.isFinite(remaining)?startedAt+Math.max(0,remaining):null};
}

export function redirectPosPayment(url,location=window.location){
  if(typeof url!=='string'||!/^https:\/\/gateway20\.pelecard\.biz\/PaymentGW\?transactionId=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(url))throw Error('invalid_redirect');
  location.assign(url);
}
