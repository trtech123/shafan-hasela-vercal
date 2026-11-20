import {describe,it,expect} from 'vitest';
import {signatureEdgeHeaders} from '../../server/order-confirmation/runtime.js';

describe('signature Edge request contract',()=>{
  it('forwards the verified user JWT with the public project API key',()=>{
    expect(signatureEdgeHeaders('Bearer synthetic-user-jwt',{VITE_SUPABASE_ANON_KEY:'synthetic-anon-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key'})).toEqual({
      'Content-Type':'application/json',Authorization:'Bearer synthetic-user-jwt',apikey:'synthetic-anon-key',
    });
  });
  it('rejects missing or malformed user authorization',()=>{
    for(const value of [null,'','Bearer ','Basic synthetic-token']) {
      expect(()=>signatureEdgeHeaders(value,{VITE_SUPABASE_ANON_KEY:'synthetic-anon-key'})).toThrow('authentication_required');
    }
  });
  it('fails closed without the public project API key',()=>{
    expect(()=>signatureEdgeHeaders('Bearer synthetic-user-jwt',{SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key'})).toThrow('server_not_configured');
  });
});
