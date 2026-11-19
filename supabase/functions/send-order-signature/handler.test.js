import {describe,it,expect,vi} from 'vitest';
import {createSignatureDeliveryHandler} from './handler.js';
const id='98000000-0000-4000-8000-000000000001';
const body={actorId:id,revisionId:id,channel:'email',requestId:id,signingUrl:'https://example.invalid/order-sign#'+'a'.repeat(43)};
const req=value=>new Request('https://example.invalid',{method:'POST',body:JSON.stringify(value)});
const deps=()=>({authorize:vi.fn(async()=>true),read:vi.fn(async()=>({id,status:'pending',snapshot:{data:{client_name:'Test client',client_email:'test@example.invalid',order_number:'ABC-1',activity_date:'2026-12-01'}},unsigned_hash:'hash',unsigned_path:id+'/unsigned.pdf'})),verifyLink:vi.fn(),download:vi.fn(async()=>new Uint8Array([37,80,68,70])),hash:vi.fn(async()=> 'hash'),provider:vi.fn(()=>({capabilities:async()=>({canSend:true}),send:async()=> 'provider-id'})),claim:vi.fn(async()=>({claimed:true,attempt:{id,state:'dispatched'}})),finish:vi.fn(async()=>({id,state:'accepted'}))});
describe('archived signature delivery',()=>{
 it('rejects a caller-supplied PDF',async()=>{const d=deps();expect((await createSignatureDeliveryHandler(d)(req({...body,pdfBase64:'evil'}))).status).toBe(400);expect(d.claim).not.toHaveBeenCalled();});
 it('sends only private authoritative archive with its verified signing URL',async()=>{const d=deps();const r=await createSignatureDeliveryHandler(d)(req(body));expect(r.status).toBe(200);expect(d.verifyLink).toHaveBeenCalledWith(body.signingUrl,id);expect(d.claim.mock.calls[0][0].destination).toBe('test@example.invalid');expect(d.provider).toHaveBeenCalledWith('email',body.signingUrl);});
 it('does not resend idempotent claim or an artifact with wrong hash',async()=>{const d=deps();d.claim.mockResolvedValue({claimed:false,attempt:{id,state:'accepted'}});const provider={capabilities:vi.fn(async()=>({canSend:true})),send:vi.fn()};d.provider.mockReturnValue(provider);expect((await createSignatureDeliveryHandler(d)(req(body))).status).toBe(200);expect(provider.send).not.toHaveBeenCalled();d.hash.mockResolvedValue('wrong');expect((await createSignatureDeliveryHandler(d)(req(body))).status).toBe(503);});
 it('service authentication is required',async()=>{const d=deps();d.authorize.mockResolvedValue(false);expect((await createSignatureDeliveryHandler(d)(req(body))).status).toBe(401);expect(d.read).not.toHaveBeenCalled();});
});
