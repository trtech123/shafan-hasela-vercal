import {describe,it,expect,vi} from 'vitest';
import {createSignatureAuthorization} from './authorization.js';

const id='98000000-0000-4000-8000-000000000001';
const request=token=>new Request('https://example.invalid/functions/v1/send-order-signature',{
  method:'POST',headers:token?{Authorization:`Bearer ${token}`}:{},body:'{}',
});

describe('signature Edge user authorization',()=>{
  const setup=()=>{
    const getUser=vi.fn(async()=>({data:{user:{id}},error:null}));
    const createClient=vi.fn(()=>({auth:{getUser}}));
    return {authorize:createSignatureAuthorization({url:'https://example.supabase.co',anon:'synthetic-anon-key',createClient}),createClient,getUser};
  };
  it('accepts a valid user JWT through a user-scoped Supabase Auth client',async()=>{
    const d=setup();expect(await d.authorize(request('synthetic-user-jwt'))).toBe(id);
    expect(d.createClient).toHaveBeenCalledWith('https://example.supabase.co','synthetic-anon-key',expect.objectContaining({global:{headers:{Authorization:'Bearer synthetic-user-jwt'}}}));
    expect(d.getUser).toHaveBeenCalledOnce();
  });
  it('rejects a missing or malformed Authorization header before Auth lookup',async()=>{
    const d=setup();
    await expect(d.authorize(request())).rejects.toMatchObject({code:'authentication_required',status:401});
    await expect(d.authorize(new Request('https://example.invalid',{headers:{Authorization:'Bearer '}}))).rejects.toMatchObject({code:'authentication_required',status:401});
    expect(d.createClient).not.toHaveBeenCalled();
  });
  it('rejects invalid and expired user sessions reported by Supabase Auth',async()=>{
    const d=setup();
    for(const message of ['invalid JWT','JWT expired']) {
      d.getUser.mockResolvedValueOnce({data:{user:null},error:{message}});
      await expect(d.authorize(request('synthetic-user-jwt'))).rejects.toMatchObject({code:'authentication_required',status:401});
    }
  });
});
