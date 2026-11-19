import {createClient} from '@supabase/supabase-js';
import {PDFDocument,PDFName,PDFString,PDFHexString} from 'pdf-lib';
import {createSignatureHandler} from './handler.js';
import {BUCKET,SignatureError,sha256,tokenLifetimeDays} from './contract.js';
import {renderUnsigned,renderSigned} from './renderer.js';

export function signingLinkFromPdf(document,origin) {
  for(const page of document.getPages()) {
    const annotations=page.node.Annots();
    for(let i=0;i<(annotations?.size()||0);i++) {
      const annotation=document.context.lookup(annotations.get(i));
      const action=annotation?.lookup?.(PDFName.of('A'));
      const uri=action?.lookup?.(PDFName.of('URI'));
      if(!(uri instanceof PDFString)&&!(uri instanceof PDFHexString)) continue;
      const value=uri.decodeText();
      if(value.startsWith(origin+'/order-sign#')&&/^[A-Za-z0-9_-]{43}$/.test(value.split('#')[1])) return value;
    }
  }
  throw new SignatureError('artifact_unavailable',503);
}
export function signatureRuntime(env=process.env) {
  const url=env.SUPABASE_URL||env.VITE_SUPABASE_URL, key=env.SUPABASE_SERVICE_ROLE_KEY;
  const origin=env.ORDER_SIGNATURE_PUBLIC_ORIGIN;
  if(!url||!key||!origin||new URL(origin).origin!==origin||!origin.startsWith('https://')) throw new SignatureError('server_not_configured',503);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,options)=>fetch(input,{...options,signal:AbortSignal.timeout(20000)})}});
  const result=async promise=>{
    const {data,error}=await promise;
    if(error) {
      const safe=['billing_customer_incomplete','signature_forbidden','link_unavailable','order_not_found','revision_conflict','invalid_signature','invalid_signer_id','delivery_already_claimed','delivery_conflict','invalid_destination','delivery_still_in_progress','delivery_resend_stale'];
      throw new SignatureError(safe.includes(error.message)?error.message:'signature_unavailable',error.code==='42501'?403:error.code==='PT404'?404:error.code==='PT409'?409:503);
    }
    return data;
  };
  const readPdf=async path=>Buffer.from(await (await result(db.storage.from(BUCKET).download(path))).arrayBuffer());
  return createSignatureHandler({
    origin,days:tokenLifetimeDays(env.ORDER_SIGNATURE_TOKEN_DAYS),renderUnsigned,renderSigned,
    authorize:async request=>{
      const authorization=request.headers.get('authorization');
      if(!authorization?.startsWith('Bearer ')) throw new SignatureError('authentication_required',401);
      const {data,error}=await db.auth.getUser(authorization.slice(7));
      if(error||!data?.user?.id) throw new SignatureError('authentication_required',401);
      return data.user.id;
    },
    rateLimit:request=>result(db.rpc('order_signature_rate_limit',{p_bucket:sha256(key+':'+(request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()||'unknown'))})),
    action:(action,input)=>result(db.rpc('order_signature_action',{p_action:action,p_input:input})),
    readPdf,
    writePdf:async(path,bytes)=>{
      const {error}=await db.storage.from(BUCKET).upload(path,bytes,{contentType:'application/pdf',upsert:false});
      if(!error) return bytes;
      // Only an existing immutable object can be accepted on a retry. Storage
      // failures are not mistaken for successful uploads.
      if(String(error.statusCode)!=='409' && error.message!=='The resource already exists') throw new SignatureError('artifact_unavailable',503);
      return readPdf(path);
    },
    deliver:async({actorId,revision,channel,requestId,recipient,resendOf,confirmed})=>{
      const bytes=await readPdf(revision.unsigned_path);
      if(sha256(bytes)!==revision.unsigned_hash) throw new SignatureError('artifact_unavailable',503);
      const signingUrl=signingLinkFromPdf(await PDFDocument.load(bytes),origin);
      const response=await fetch(url+'/functions/v1/send-order-signature',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key,apikey:key},
        body:JSON.stringify({actorId,revisionId:revision.id,channel,requestId,recipient,signingUrl,resendOf,confirmed}),signal:AbortSignal.timeout(55000),
      });
      const data=await response.json();
      if(!response.ok) throw new SignatureError(data.error||'delivery_unavailable',response.status);
      return data;
    },
  });
}
