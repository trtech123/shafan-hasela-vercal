import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {signatureRuntime} from '../../server/order-confirmation/runtime.js';

vi.mock('@supabase/supabase-js',()=>({createClient:vi.fn()}));

const actorId='98000000-0000-4000-8000-000000000001';
const request=authorization=>new Request('https://example.invalid/api/order-confirmation',{
  method:'POST',headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},
  body:JSON.stringify({action:'history',orderId:actorId}),
});
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic',ORDER_SIGNATURE_PUBLIC_ORIGIN:'https://example.invalid'};

describe('signature staff session validation',()=>{
  let getUser,rpc;
  beforeEach(()=>{
    getUser=vi.fn();rpc=vi.fn(name=>name==='order_signature_rate_limit'
      ?Promise.resolve({data:true,error:null})
      :Promise.resolve({data:{revisions:[],deliveries:[]},error:null}));
    vi.mocked(createClient).mockReturnValue({auth:{getUser},rpc});
  });
  it('rejects a missing session without querying order history',async()=>{
    const response=await signatureRuntime(env)(request());
    expect(response.status).toBe(401);expect(getUser).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name])=>name)).toEqual(['order_signature_rate_limit']);
  });
  it('rejects an expired session reported by Supabase Auth',async()=>{
    getUser.mockResolvedValue({data:{user:null},error:{message:'JWT expired'}});
    const response=await signatureRuntime(env)(request('Bearer expired-user-token'));
    expect(response.status).toBe(401);expect(getUser).toHaveBeenCalledWith('expired-user-token');
    expect(rpc.mock.calls.map(([name])=>name)).toEqual(['order_signature_rate_limit']);
  });
  it('uses the verified user ID and enforces the database staff role',async()=>{
    getUser.mockResolvedValue({data:{user:{id:actorId}},error:null});
    const response=await signatureRuntime(env)(request('Bearer valid-user-token'));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('order_signature_action',{p_action:'history',p_input:{actorId,orderId:actorId}});
  });
  it('blocks an authenticated user without a permitted staff role',async()=>{
    getUser.mockResolvedValue({data:{user:{id:actorId}},error:null});
    rpc.mockImplementation(name=>name==='order_signature_rate_limit'
      ?Promise.resolve({data:true,error:null})
      :Promise.resolve({data:null,error:{message:'signature_forbidden',code:'42501'}}));
    const response=await signatureRuntime(env)(request('Bearer valid-user-token'));
    expect(response.status).toBe(403);
  });
});
