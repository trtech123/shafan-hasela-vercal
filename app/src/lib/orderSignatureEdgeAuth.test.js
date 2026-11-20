import {describe,it,expect} from 'vitest';
import {signatureEdgeHeaders} from '../../server/order-confirmation/runtime.js';

const jwt=(expiry,role='service_role')=>[
  {alg:'HS256',typ:'JWT'},
  {role,exp:expiry},
  'synthetic-signature',
].map(part=>typeof part==='string'?part:Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');

describe('signature Edge gateway credentials',()=>{
  it('uses a dedicated legacy service-role JWT for both Edge headers',()=>{
    const edgeJwt=jwt(Math.floor(Date.now()/1000)+3600);
    const databaseJwt=jwt(Math.floor(Date.now()/1000)+7200);
    expect(signatureEdgeHeaders({SUPABASE_SERVICE_ROLE_KEY:databaseJwt,SUPABASE_EDGE_SERVICE_ROLE_JWT:edgeJwt})).toEqual({
      'Content-Type':'application/json',Authorization:`Bearer ${edgeJwt}`,apikey:edgeJwt,
    });
  });
  it('fails closed without a dedicated Edge JWT, even if the database key exists',()=>{
    expect(()=>signatureEdgeHeaders({SUPABASE_SERVICE_ROLE_KEY:jwt(Math.floor(Date.now()/1000)+3600)})).toThrow('server_not_configured');
  });
  it('rejects an expired, malformed or non-service-role Edge JWT before dispatch',()=>{
    for(const value of [jwt(Math.floor(Date.now()/1000)-1),jwt(Math.floor(Date.now()/1000)+3600,'anon'),'sb_secret_synthetic']) {
      expect(()=>signatureEdgeHeaders({SUPABASE_EDGE_SERVICE_ROLE_JWT:value})).toThrow('server_not_configured');
    }
  });
});
