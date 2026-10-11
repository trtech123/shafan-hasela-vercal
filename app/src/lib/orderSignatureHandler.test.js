import {describe,it,expect,vi} from 'vitest';
import {createSignatureHandler} from '../../server/order-confirmation/handler.js';
import {sha256} from '../../server/order-confirmation/contract.js';
const token='a'.repeat(43), id='98000000-0000-4000-8000-000000000001';
const request=(body,headers={})=>new Request('https://example.invalid/api/order-confirmation',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
function deps(){return {authorize:vi.fn(async()=>id),rateLimit:vi.fn(async()=>true),action:vi.fn(async()=>({id,revision_number:1,status:'pending',snapshot:{data:{},text:{}},unsigned_path:id+'/unsigned.pdf',unsigned_hash:'hash'})),readPdf:vi.fn(async()=>Buffer.from('%PDF-test')),writePdf:vi.fn(),renderUnsigned:vi.fn(async()=>Buffer.from('%PDF-test')),renderSigned:vi.fn(async()=>Buffer.from('%PDF-signed')),origin:'https://example.invalid',days:7};}
describe('order signature HTTP boundary',()=>{
 it('rejects client documents before any database or rendering work',async()=>{const d=deps(),r=await createSignatureHandler(d)(request({action:'create',orderId:id,snapshot:{evil:true}}));expect(r.status).toBe(400);expect(d.action).not.toHaveBeenCalled();});
 it('protects all responses and never exposes server paths or hashes of bearer tokens',async()=>{const d=deps(),r=await createSignatureHandler(d)(request({action:'view',token}));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(r.headers.get('referrer-policy')).toBe('no-referrer');expect(await r.text()).not.toContain('unsigned_path');expect(d.authorize).not.toHaveBeenCalled();});
 it('returns only acceptance copy from a snapshot containing private legacy fields',async()=>{
  const d=deps();d.action.mockResolvedValue({id,status:'pending',snapshot:{acceptanceText:'Frozen acceptance',acceptanceVersion:'1',data:{quotation_snapshot:{created_by:'private-staff-id',selected_activities:[{internal_notes:'private-item-note'}]},customer_snapshot:{internal_notes:'private-customer-note'}},text:{private_legacy_field:'private-fixed-copy'}},token_hash:'private-token-hash',strokes:[{private:'signature'}]});
  const r=await createSignatureHandler(d)(request({action:'view',token})),body=await r.json();
  expect(body.revision.snapshot).toEqual({acceptanceText:'Frozen acceptance',acceptanceVersion:'1'});expect(JSON.stringify(body)).not.toContain('private');
 });
 it('uses authoritative server revision and bundled text when creating',async()=>{const d=deps(),r=await createSignatureHandler(d)(request({action:'create',orderId:id}));expect(r.status).toBe(200);expect(d.authorize).toHaveBeenCalledOnce();expect(d.action.mock.calls[0][0]).toBe('create');expect(d.action.mock.calls[0][1].text.ORDER_TERMS).toBeDefined();expect(d.renderUnsigned.mock.calls[0][0]).toEqual({data:{},text:{}});expect((await r.json()).signingUrl).toMatch(/^https:\/\/example.invalid\/order-sign#[A-Za-z0-9_-]{43}$/);});
 it('rate limits before database token lookup',async()=>{const d=deps();d.rateLimit.mockResolvedValue(false);const r=await createSignatureHandler(d)(request({action:'view',token}));expect(r.status).toBe(429);expect(d.action).not.toHaveBeenCalled();});
 it('requires staff auth for revocation and history',async()=>{const d=deps();d.authorize.mockRejectedValue(Error('bad jwt'));expect((await createSignatureHandler(d)(request({action:'history',orderId:id}))).status).toBe(401);expect(d.action).not.toHaveBeenCalled();});
 it('rejects blank signature without claiming token',async()=>{const d=deps();const r=await createSignatureHandler(d)(request({action:'sign',token,requestId:id,fullName:'ישראל ישראלי',strokes:[],accepted:true}));expect(r.status).toBe(400);expect(d.action).not.toHaveBeenCalled();});
 it('finalizes only after storing evidence from the verified original bytes',async()=>{
  const d=deps(),unsigned=Buffer.from('%PDF-test'),signed=Buffer.from('%PDF-stored-evidence');
  const row={id,status:'signing',snapshot:{acceptanceText:'Frozen text',acceptanceVersion:'1'},unsigned_path:id+'/unsigned.pdf',unsigned_hash:sha256(unsigned),revision_hash:'revisionhash',full_name:'ישראל ישראלי',strokes:[[{x:.1,y:.1},{x:.5,y:.5}]],signed_at:'2026-10-11T10:00:00Z'};
  d.action.mockResolvedValueOnce(row).mockResolvedValueOnce({...row,status:'signed'});d.writePdf.mockResolvedValue(signed);
  const r=await createSignatureHandler(d)(request({action:'sign',token,requestId:id,fullName:row.full_name,strokes:row.strokes,accepted:true}));
  expect(r.status).toBe(200);expect(d.renderSigned.mock.calls[0][0]).toEqual(unsigned);expect(d.renderSigned.mock.calls[0][1].acceptanceText).toBe('Frozen text');
  expect(d.writePdf.mock.calls[0][0]).toBe(id+'/'+id+'-signed.pdf');expect(d.action.mock.calls[1]).toEqual(['finish',expect.objectContaining({signedHash:sha256(signed)})]);
 });
 it('a failed upload never finalizes and a committed replay never renders again',async()=>{
  const d=deps(),input={action:'sign',token,requestId:id,fullName:'ישראל ישראלי',strokes:[[{x:.1,y:.1},{x:.5,y:.5}]],accepted:true};
  const row={id,status:'signing',snapshot:{},unsigned_path:id+'/unsigned.pdf',unsigned_hash:sha256(Buffer.from('%PDF-test'))};
  d.action.mockResolvedValue(row);d.writePdf.mockRejectedValue(Error('storage failure'));
  expect((await createSignatureHandler(d)(request(input))).status).toBe(503);expect(d.action).toHaveBeenCalledOnce();
  d.renderSigned.mockClear();d.action.mockResolvedValue({...row,status:'signed',full_name:input.fullName,signed_at:'server-time'});
  expect((await createSignatureHandler(d)(request(input))).status).toBe(200);expect(d.renderSigned).not.toHaveBeenCalled();
 });
 it('public bearer cannot request a signed staff-only artifact',async()=>{
  const d=deps();expect((await createSignatureHandler(d)(request({action:'pdf',token,signed:true}))).status).toBe(400);expect(d.readPdf).not.toHaveBeenCalled();
 });
 it('concurrent identical submissions converge on one immutable object and evidence hash',async()=>{
  const d=deps(),input={action:'sign',token,requestId:id,fullName:'Synthetic Signer',strokes:[[{x:0,y:0},{x:1,y:1}]],accepted:true};
  const row={id,status:'signing',snapshot:{acceptanceText:'Frozen acceptance',acceptanceVersion:'1'},unsigned_path:id+'/unsigned.pdf',unsigned_hash:sha256(Buffer.from('%PDF-test')),full_name:input.fullName,strokes:input.strokes,signed_at:'2026-10-11T10:00:00Z'};
  let renders=0;const objects=new Map();
  d.action.mockImplementation(async action=>action==='claim'?row:{...row,status:'signed'});
  d.renderSigned.mockImplementation(async()=>Buffer.from('%PDF-concurrent-'+(++renders)));
  d.writePdf.mockImplementation(async(path,bytes)=>{if(!objects.has(path))objects.set(path,bytes);return objects.get(path);});
  const handler=createSignatureHandler(d),results=await Promise.all([handler(request(input)),handler(request(input))]);
  expect(results.map(result=>result.status)).toEqual([200,200]);expect(objects.size).toBe(1);
  const finishes=d.action.mock.calls.filter(([action])=>action==='finish');expect(finishes).toHaveLength(2);expect(finishes[0][1].signedHash).toBe(finishes[1][1].signedHash);
 });
});
