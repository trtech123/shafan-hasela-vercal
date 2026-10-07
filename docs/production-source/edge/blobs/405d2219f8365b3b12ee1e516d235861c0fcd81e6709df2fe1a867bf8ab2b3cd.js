import { DeliveryError, boundedOperation } from './contract.js';
export function createAuthorization({ url, anon, configured, createClient, scoped = false }) {
  return async request => {
    if (!url || !anon || !configured) throw new DeliveryError('server_not_configured', 503);
    const authorization = request.headers.get('Authorization');
    if (!authorization) throw new DeliveryError('authentication_required', 401);
    const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await boundedOperation(() => caller.auth.getUser(), 10000, 'authentication_unavailable');
    if (error || !data?.user) throw new DeliveryError('authentication_required', 401);
    const profile = await boundedOperation(() => caller.from('profiles').select('role').eq('id', data.user.id).single(), 10000, 'authentication_unavailable');
    if (profile.error || !['admin', 'operations'].includes(profile.data?.role)) throw new DeliveryError('quotation_delivery_forbidden', 403);
    return scoped ? {actorId:data.user.id,assertQuoteAccess:async quoteId=>{
      const visible=await boundedOperation(()=>caller.from('quotes').select('id').eq('id',quoteId).maybeSingle(),10000,'authentication_unavailable');
      if(visible.error || !visible.data)throw new DeliveryError('quotation_not_found',404);
    }} : data.user.id;
  };
}
