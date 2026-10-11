import * as documentText from '../../src/lib/orderDocText.js';
import {ACCEPTANCE_TEXT,ACCEPTANCE_VERSION,RENDER_VERSION,SignatureError,canonicalJson,hashToken,secureToken,sha256,validId,validateSignature} from './contract.js';

const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json'}});
const fields={create:['orderId'],history:['orderId'],revoke:['revisionId'],view:['token'],pdf:['token','revisionId','signed'],sign:['token','requestId','fullName','signerId','strokes','accepted'],deliver:['revisionId','channel','requestId','recipient','resendOf','confirmed']};
async function readBody(request) {
  if(!request.headers.get('content-type')?.startsWith('application/json')) throw new SignatureError('invalid_request');
  const reader=request.body?.getReader(); if(!reader) throw new SignatureError('invalid_request');
  let size=0; const chunks=[];
  while(true) { const {value,done}=await reader.read(); if(done)break; size+=value.length;if(size>131072){await reader.cancel();throw new SignatureError('invalid_request',413);} chunks.push(value); }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SignatureError('invalid_request');}
}
// Customer review uses the protected archive; the JSON response needs only the
// checkbox copy, never raw legacy order/customer records or fixed-text metadata.
const publicRevision=r=>({id:r.id,revision_number:r.revision_number,status:r.status,snapshot:{acceptanceText:r.snapshot?.acceptanceText,acceptanceVersion:r.snapshot?.acceptanceVersion},expires_at:r.expires_at,revision_hash:r.revision_hash});
const signedResult=r=>({ok:true,signedAt:r.signed_at,fullName:r.full_name});
export function createSignatureHandler(deps) {
  return async request=>{
    if(request.method!=='POST') return json({error:'method_not_allowed'},405);
    try {
      const body=await readBody(request), action=body?.action;
      if(!Object.hasOwn(fields,action) || Object.keys(body).some(k=>k!=='action'&&!fields[action].includes(k))) throw new SignatureError('invalid_request');
      if(!await deps.rateLimit(request)) throw new SignatureError('too_many_requests',429);
      const isPublic=['view','sign'].includes(action)||(action==='pdf'&&body.token!==undefined);
      let actorId;
      if(!isPublic) {try{actorId=await deps.authorize(request);}catch{throw new SignatureError('authentication_required',401);} }
      for(const key of ['orderId','revisionId','requestId']) if(body[key]!==undefined&&!validId(body[key])) throw new SignatureError('invalid_request');
      if(['create','history'].includes(action)&&!validId(body.orderId)) throw new SignatureError('invalid_request');
      if(['revoke','deliver'].includes(action)&&!validId(body.revisionId)) throw new SignatureError('invalid_request');
      const tokenHash=isPublic?hashToken(body.token):undefined;
      if(action==='create') {
        const token=secureToken();
        const signingUrl=deps.origin+'/order-sign#'+token;
        const revision=await deps.action('create',{actorId,orderId:body.orderId,tokenHash:hashToken(token),days:deps.days,text:documentText,renderVersion:RENDER_VERSION,acceptanceVersion:ACCEPTANCE_VERSION,acceptanceText:ACCEPTANCE_TEXT});
        const bytes=await deps.renderUnsigned(revision.snapshot,signingUrl);
        await deps.writePdf(revision.id+'/unsigned.pdf',bytes);
        const ready=await deps.action('ready',{actorId,revisionId:revision.id,revisionHash:sha256(canonicalJson(revision.snapshot)),unsignedHash:sha256(bytes)});
        return json({revision:publicRevision(ready),signingUrl});
      }
      if(action==='history') return json(await deps.action('history',{actorId,orderId:body.orderId}));
      if(action==='revoke') {const r=await deps.action('revoke',{actorId,revisionId:body.revisionId});return json({revision:publicRevision(r)});}
      if(action==='view') {const r=await deps.action('view',{tokenHash});return json({revision:publicRevision(r),signed:r.status==='signed'});}
      if(action==='pdf') {
        if(!isPublic&&!validId(body.revisionId)) throw new SignatureError('invalid_request');
        if(isPublic&&(body.signed||body.revisionId)) throw new SignatureError('invalid_request');
        const r=await deps.action(isPublic?'view':'staff_read',isPublic?{tokenHash}:{actorId,revisionId:body.revisionId});
        const path=body.signed?r.signed_path:r.unsigned_path, hash=body.signed?r.signed_hash:r.unsigned_hash;
        if(!path) throw new SignatureError('artifact_unavailable',404);
        const bytes=await deps.readPdf(path);
        if(sha256(bytes)!==hash) throw new SignatureError('artifact_unavailable',503);
        return new Response(bytes,{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':'inline; filename="order-confirmation.pdf"'}});
      }
      if(action==='sign') {
        if(!validId(body.requestId)) throw new SignatureError('invalid_signature');
        const signature=validateSignature(body);
        const r=await deps.action('claim',{tokenHash,requestId:body.requestId,...signature,accepted:true});
        if(r.status==='signed') return json(signedResult(r));
        const unsigned=await deps.readPdf(r.unsigned_path);
        if(sha256(unsigned)!==r.unsigned_hash) throw new SignatureError('artifact_unavailable',503);
        const evidence={snapshot:r.snapshot,fullName:r.full_name,signerId:r.signer_id,strokes:r.strokes,signedAt:r.signed_at,revisionHash:r.revision_hash,unsignedHash:r.unsigned_hash,acceptanceText:r.snapshot.acceptanceText,acceptanceVersion:r.snapshot.acceptanceVersion,revisionId:r.id};
        // An immutable deterministic object key makes crash retries and competing
        // identical requests converge on exactly the same stored evidence PDF.
        const signed=await deps.writePdf(r.id+'/'+body.requestId+'-signed.pdf',await deps.renderSigned(unsigned,evidence));
        const finished=await deps.action('finish',{tokenHash,requestId:body.requestId,signedHash:sha256(signed)});
        return json(signedResult(finished));
      }
      if(action==='deliver') {
        if(!validId(body.requestId)||!['email','whatsapp'].includes(body.channel)) throw new SignatureError('invalid_request');
        const r=await deps.action('staff_read',{actorId,revisionId:body.revisionId});
        if(body.resendOf&&(!validId(body.resendOf)||body.confirmed!==true)) throw new SignatureError('invalid_request');
        return json(await deps.deliver({actorId,revision:r,channel:body.channel,requestId:body.requestId,recipient:body.recipient,resendOf:body.resendOf,confirmed:body.confirmed}));
      }
    }catch(error) {
      return json({error:error instanceof SignatureError?error.message:'signature_unavailable'},error instanceof SignatureError?error.status:503);
    }
  };
}
