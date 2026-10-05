import {localTime,TIME_ZONE} from './validation.js';
const record=v=>v!==null && typeof v==='object' && !Array.isArray(v);
const fail=code=>{throw Error(code)};
const scalar=v=>typeof v==='string'?v:typeof v==='number'&&Number.isSafeInteger(v)?String(v):null;
const digits=(v,max=15)=>{const s=scalar(v);return s!==null&&new RegExp(`^\\d{1,${max}}$`).test(s)?s:null};
const text=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v)&&!/(?:\d[ -]?){13,19}/.test(v)?v.trim():null;
const scopeValid=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{2,63}$/.test(v);
export {scopeValid};

function normalize(row,scope) {
 if(!record(row))return fail('invalid_provider_response');
 const transactionId=digits(row.PelecardTransactionId);
 if(!transactionId||!Number(transactionId))return fail('invalid_provider_response');
 const amount=digits(row.DebitTotal),currencyCode=digits(row.DebitCurrency,3);
 const amountMinor=amount!==null&&Number.isSafeInteger(Number(amount))?Number(amount):null;
 const shvaResult=digits(row.ShvaResult,3),jParam=digits(row.JParam,2),debitType=digits(row.DebitType,2);
 const j=Number(jParam),d=Number(debitType);
 const operation=j===5?'authorization':j===4&&[1,2,3].includes(d)?'charge':j===4&&[51,53].includes(d)?'refund':j===4&&d===52?'cancellation':'unknown';
 const m=typeof row.CreatedDate==='string'?/^(\d{2})\/(\d{2})\/(20\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(row.CreatedDate):null;
 const time=m?localTime(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]??'00'}`):null;
 return {
  id:`pelecard:${scope}:${transactionId}`,provider:'pelecard',scope,transactionId,
  occurredAt:time?.instant??null,providerLocalTime:time?.local??null,timeZone:TIME_ZONE,
  amountMinor,currency:({'1':'ILS','2':'USD','978':'EUR'})[currencyCode]??null,currencyCode,
  status:shvaResult==='000'?'succeeded':shvaResult?.length===3?'failed':'unknown',operation,
  shvaResult,jParam,debitType,approvalNumber:text(scalar(row.DebitApproveNumber),40),voucherId:text(scalar(row.VoucherId),64),
  customer:{name:text(row.CardHolderName,150),email:text(row.CardHolderEmail,254),phone:text(row.CardHolderPhone,40),cardholderId:text(scalar(row.CardHolderID),12)},
 };
}

export function normalizeResponse(payload,scope,input,privateValues=[]) {
 if(!scopeValid(scope))return fail('configuration_unavailable');
 if(!record(payload)||String(payload.StatusCode)!=='000')return fail('provider_unavailable');
 let rows=payload.ResultData;
 if(input.action==='lookup' && record(rows))rows=[rows];
 if(!Array.isArray(rows))return fail('invalid_provider_response');
 if(rows.length>500)return fail('range_too_large');
 const result=new Map();
 for(const row of rows){
  const item=normalize(row,scope);
  const check=value=>{
   if(value&&typeof value==='object'){for(const child of Object.values(value))check(child);return}
   if(typeof value!=='string')return;
   let decoded=value;try{decoded=decodeURIComponent(value)}catch{/* Keep original. */}
   if(privateValues.some(secret=>typeof secret==='string'&&secret&&(secret.length>=4?(value.includes(secret)||decoded.includes(secret)):value===secret||decoded===secret)))fail('invalid_provider_response');
  };
  check(item);
  if(input.action==='lookup'&&item.transactionId!==input.transactionId)return fail('invalid_provider_response');
  if(input.action==='range'&&item.providerLocalTime && (item.providerLocalTime<input.start+':00'||item.providerLocalTime>input.end+':59'))return fail('invalid_provider_response');
  const previous=result.get(item.id);
  if(previous && JSON.stringify(previous)!==JSON.stringify(item))return fail('conflicting_provider_records');
  result.set(item.id,item);
 }
 return [...result.values()].sort((a,b)=>(b.providerLocalTime??'').localeCompare(a.providerLocalTime??'')||a.transactionId.localeCompare(b.transactionId));
}
