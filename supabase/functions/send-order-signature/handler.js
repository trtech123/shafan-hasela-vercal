import {destinationFor,revisionForMessage,validId,DeliveryError,safeProviderId} from '../send-order-doc/_deployed_shared/order-delivery/contract.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export function createSignatureDeliveryHandler(deps) {
  return async request=>{
    if(request.method!=='POST') return json({error:'method_not_allowed'},405);
    try {
      if(!await deps.authorize(request)) return json({error:'authentication_required'},401);
      const raw=await request.text();if(raw.length>4096) return json({error:'invalid_request'},400);
      const body=JSON.parse(raw);
      if(Object.keys(body).some(k=>!['actorId','revisionId','channel','requestId','recipient','signingUrl','resendOf','confirmed'].includes(k))||!['email','whatsapp'].includes(body.channel)||!['actorId','revisionId','requestId'].every(k=>validId(body[k]))||(body.channel==='whatsapp'&&body.recipient!==undefined)||(body.resendOf&&(!validId(body.resendOf)||body.confirmed!==true))) return json({error:'invalid_request'},400);
      const revision=await deps.read(body.revisionId,body.actorId);
      await deps.verifyLink(body.signingUrl,revision.id);
      const destination=destinationFor(body.channel,revision.snapshot.data,body.recipient);
      const bytes=await deps.download(revision.unsigned_path);
      if(await deps.hash(bytes)!==revision.unsigned_hash) return json({error:'artifact_unavailable'},503);
      const provider=deps.provider(body.channel,body.signingUrl),capabilities=await provider.capabilities();
      if(!capabilities.canSend) return json({error:capabilities.reason||'delivery_unavailable'},503);
      const claim=await deps.claim({...body,destination});
      if(!claim.claimed) return json({ok:true,attempt:claim.attempt,replayed:true});
      let state='accepted',reason=null,providerId=null;
      try {
        providerId=safeProviderId(await provider.send({...revisionForMessage(revision.snapshot.data),destination,pdfBytes:bytes}));
        if(!providerId) throw new DeliveryError('provider_response_uncertain',502,'uncertain');
      }catch(error) {
        state=error instanceof DeliveryError&&error.state==='failed'?'failed':'uncertain';
        reason=error instanceof DeliveryError&&['provider_rejected','provider_timeout','provider_unavailable','provider_response_uncertain'].includes(error.code)?error.code:'provider_unavailable';providerId=null;
      }
      let attempt;
      try{attempt=await deps.finish({actorId:body.actorId,requestId:body.requestId,state,reason,providerId});}
      catch{attempt={...claim.attempt,state:'uncertain',reason:'provider_response_uncertain'};}
      return json({ok:true,attempt,replayed:false});
    }catch(error) {return json({error:error instanceof DeliveryError?error.code:'delivery_unavailable'},error instanceof DeliveryError?error.status:503);}
  };
}
