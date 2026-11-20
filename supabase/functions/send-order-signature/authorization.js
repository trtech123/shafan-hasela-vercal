import {boundedOperation,DeliveryError} from '../send-order-doc/_deployed_shared/quotation-delivery/contract.js';

export function createSignatureAuthorization({url,anon,createClient}) {
  return async request=>{
    if(!url||!anon) throw new DeliveryError('server_not_configured',503);
    const authorization=request.headers.get('authorization');
    if(!/^Bearer \S+$/.test(authorization||'')) throw new DeliveryError('authentication_required',401);
    const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await boundedOperation(()=>caller.auth.getUser(),10000,'authentication_unavailable');
    if(error||!data?.user?.id) throw new DeliveryError('authentication_required',401);
    return data.user.id;
  };
}
