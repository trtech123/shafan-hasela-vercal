// GetTransaction: Services REST API Jan 2025, p18 (root TamalData).
// Observations only. No success inference, provider calls, or RawResponse retention.
const isRecord=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const present=value=>value!==undefined&&value!==null&&value!=='';
const cleanText=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);

/** The injected guard is the transport's credential-echo check. This function
 * does not throw for malformed document metadata or change financial evidence. */
export function parseDocumentMetadata(response,rejectCredentialEcho=()=>{}){
 if(!isRecord(response)||!Object.hasOwn(response,'TamalData'))return null;
 const data=response.TamalData;
 const result={schemaVersion:1,provider:'tamal',source:'pelecard_get_transaction',state:'unverified',invoiceStatus:null,invoiceNumber:null,invoiceUrl:null,errorPresent:false,errorCode:null,rawResponsePresent:false,metadataInvalid:false,urlReviewRequired:false};
 if(!isRecord(data)){result.metadataInvalid=true;return result;}
 const guarded=(value,parse)=>{
  try{return parse(value);}catch{result.metadataInvalid=true;return null;}
 };
 if(present(data.InvoiceStatus))result.invoiceStatus=guarded(data.InvoiceStatus,value=>{
  if(!cleanText(value,32)||!/^[ A-Za-z0-9_-]{1,32}$/.test(value))throw Error();
  rejectCredentialEcho(value);rejectCredentialEcho(value.trim());return value;
 });
 if(present(data.InvoiceNumber))result.invoiceNumber=guarded(data.InvoiceNumber,value=>{
  if(typeof value==='number'){if(!Number.isSafeInteger(value)||value<0)throw Error();value=String(value);}
  if(!cleanText(value,64)||!/^ *[0-9]{1,12}(?:[-/][0-9]{1,12})? *$/.test(value))throw Error();
  rejectCredentialEcho(value);rejectCredentialEcho(value.trim());return value;
 });
 result.errorPresent=present(data.InvoiceError);
 if(result.errorPresent)result.errorCode=guarded(data.InvoiceError,value=>{
  // Free text and structured errors are reduced to presence, never serialized.
  if(typeof value==='string'&&value.length<=4096)rejectCredentialEcho(value);
  return typeof value==='string'&&/^\d{1,6}$/.test(value)?value:null;
 });
 result.rawResponsePresent=present(data.RawResponse);
 if(present(data.InvoiceLink))result.invoiceUrl=guarded(data.InvoiceLink,value=>{
  if(!cleanText(value,2048)||value.trim()!==value)throw Error();
  rejectCredentialEcho(value);
  // Check decoded candidates too, before deciding whether a URL is forwardable.
  let decoded=value;
  for(let i=0;i<2;i++){const next=decodeURIComponent(decoded);rejectCredentialEcho(next);if(next===decoded)break;decoded=next;}
  const url=new URL(value);
  for(const [key,item] of url.searchParams){rejectCredentialEcho(key);rejectCredentialEcho(item);}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)throw Error();
  if(url.hostname!=='cloud.tamal.co.il'){result.urlReviewRequired=true;return null;}
  if(url.pathname!=='/GetDocument.aspx')throw Error();
  // The supplied GetTransaction example documents no query contract.
  if(url.search){result.urlReviewRequired=true;return null;}
  return url.href;
 });
 return result;
}
