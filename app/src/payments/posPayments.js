import {validOrderId} from './orderPayments';

const safeCodes=new Set(['capability_disabled','pos_payment_in_progress','catalog_item_unavailable',
  'cart_invalid','cart_line_invalid','cart_amount_invalid','discount_invalid','request_key_conflict',
  'pos_payment_forbidden','invalid_input','payment_database_unavailable']);
export function posPaymentErrorMessage(code){
  const messages={
    capability_disabled:'תשלום פלאקארד בקופה מושבת כעת. לא נשמר סל חדש; פנו למנהל לפני ניסיון נוסף.',
    pos_payment_in_progress:'קיים ניסיון תשלום קודם שטרם הוכרע בחשבון זה. אין להתחיל ניסיון חדש; פנו למנהל לבירור.',
    catalog_item_unavailable:'המוצר או השירות אינו פעיל בקטלוג או שמחירו אינו תקין. חזרו לקופה ובדקו את הפריט.',
    cart_invalid:'הסל אינו תקין. חזרו לקופה ובחרו פריט פעיל.',
    cart_line_invalid:'אחד מפריטי הסל אינו תקין. חזרו לקופה ובדקו את הפריטים.',
    cart_amount_invalid:'סכום הסל אינו תקין. חזרו לקופה ובדקו את המחירים.',
    discount_invalid:'ההנחה אינה מאושרת או אינה תקינה. בדקו את ההנחה לפני ניסיון נוסף.',
    request_key_conflict:'מזהה הסל כבר שייך לניסיון אחר. פנו למנהל לבירור; אין להתחיל ניסיון נוסף.',
    pos_payment_forbidden:'לחשבון זה אין הרשאה לשמור סל לתשלום פלאקארד.',
  };
  return messages[code]||'לא ניתן לאמת את שמירת הסל. בדקו את מצב הניסיון הקיים ופנו למנהל; אין להתחיל חיוב נוסף.';
}

export function posCheckoutRequestKey(checkoutId,cart,savedRaw,create=()=>crypto.randomUUID()){
  if(validOrderId(checkoutId))return checkoutId;
  try{const saved=JSON.parse(savedRaw||'null');
    if(saved&&validOrderId(saved.requestKey)&&(!cart||saved.cart===JSON.stringify(cart)))return saved.requestKey;
  }catch{/* An invalid prior pointer cannot identify this checkout. */}
  return create();
}

export async function requestPosPayment(client,body){
  if(!client?.functions?.invoke||!body||!['prepare','initialize','status','verify','cancel'].includes(body.action))throw Error('invalid_request');
  const startedAt=performance.now();
  const {data,error}=await client.functions.invoke('pelecard-pos-payment',{body});
  if(error){
    let code='payment_status_unavailable';
    try{const body=await error.context?.json();if(safeCodes.has(body?.error?.code))code=body.error.code;}catch{/* Keep an unknown response generic. */}
    throw Object.assign(new Error(code),{code});
  }
  if(!data||data.mode!=='pos'||!validOrderId(data.paymentId)||!Number.isSafeInteger(data.amountMinor)||data.amountMinor<1||data.currency!=='ILS'||typeof data.paid!=='boolean')throw Error('payment_status_unavailable');
  const remaining=Date.parse(data.hostedExpiresAt)-Date.parse(data.serverTime);
  return {...data,hostedDeadlineMs:Number.isFinite(remaining)?startedAt+Math.max(0,remaining):null};
}

export function redirectPosPayment(url,location=window.location){
  if(typeof url!=='string'||!/^https:\/\/gateway20\.pelecard\.biz\/PaymentGW\?transactionId=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(url))throw Error('invalid_redirect');
  location.assign(url);
}
