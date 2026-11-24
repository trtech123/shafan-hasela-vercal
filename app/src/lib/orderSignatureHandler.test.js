import {describe,it,expect,vi} from 'vitest';
import {createSignatureHandler} from '../../server/order-confirmation/handler.js';
import {confirmationHtml} from '../../server/order-confirmation/renderer.js';
import {sha256,RENDER_VERSION,SignatureError} from '../../server/order-confirmation/contract.js';
const token='a'.repeat(43), id='98000000-0000-4000-8000-000000000001';
const request=(body,headers={})=>new Request('https://example.invalid/api/order-confirmation',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
function deps(){return {authorize:vi.fn(async()=>id),rateLimit:vi.fn(async()=>true),action:vi.fn(async()=>({id,revision_number:1,status:'pending',snapshot:{data:{},text:{}},unsigned_path:id+'/unsigned.pdf',unsigned_hash:'hash'})),recordResponse:vi.fn(async()=>({ok:true})),readPdf:vi.fn(async()=>Buffer.from('%PDF-test')),writePdf:vi.fn(),renderUnsigned:vi.fn(async()=>Buffer.from('%PDF-test')),renderSigned:vi.fn(async()=>Buffer.from('%PDF-signed')),origin:'https://example.invalid',days:7};}
describe('order signature HTTP boundary',()=>{
 it('renders a created snapshot using the current server render version',async()=>{
  const d=deps();
  d.action.mockImplementation(async(action,input)=>action==='create'?{id,status:'preparing',snapshot:{data:{order_number:'QA-CURRENT'},text:input.text,renderVersion:input.renderVersion,acceptanceText:input.acceptanceText,acceptanceVersion:input.acceptanceVersion}}:{id,status:'pending'});
  d.renderUnsigned.mockImplementation(async(snapshot,url)=>Buffer.from(confirmationHtml(snapshot,url)));
  const response=await createSignatureHandler(d)(request({action:'create',orderId:id}));
  expect(response.status).toBe(200);expect(d.renderUnsigned.mock.calls[0][0].renderVersion).toBe(RENDER_VERSION);
  expect(d.action.mock.calls.some(([action])=>action==='ready')).toBe(true);
 });
 it('rejects invalid optional legacy ID before claiming and never echoes it',async()=>{
  const d=deps(),handler=createSignatureHandler(d);
  for(const signerId of ['','012345675',123456782]) {
   const response=await handler(request({action:'sign',token,requestId:id,signerId,fullName:'Synthetic Signer',accepted:true,strokes:[[{x:0,y:0},{x:1,y:1}]]}));
   expect(response.status).toBe(400);expect(await response.json()).toEqual({error:'invalid_signer_id'});
  }
  expect(d.action).not.toHaveBeenCalled();expect(d.authorize).not.toHaveBeenCalled();
 });
 it('rejects client documents before any database or rendering work',async()=>{const d=deps(),r=await createSignatureHandler(d)(request({action:'create',orderId:id,snapshot:{evil:true}}));expect(r.status).toBe(400);expect(d.action).not.toHaveBeenCalled();});
 it('protects all responses and never exposes server paths or hashes of bearer tokens',async()=>{const d=deps(),r=await createSignatureHandler(d)(request({action:'view',token}));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(r.headers.get('referrer-policy')).toBe('no-referrer');expect(await r.text()).not.toContain('unsigned_path');expect(d.authorize).not.toHaveBeenCalled();});
 it('returns only acceptance copy from a snapshot containing private legacy fields',async()=>{
  const d=deps();d.action.mockResolvedValue({id,status:'pending',snapshot:{acceptanceText:'Frozen acceptance',acceptanceVersion:'1',data:{quotation_snapshot:{created_by:'private-staff-id',selected_activities:[{internal_notes:'private-item-note'}]},customer_snapshot:{internal_notes:'private-customer-note'}},text:{private_legacy_field:'private-fixed-copy'}},token_hash:'private-token-hash',signer_id:'private-signer-id',strokes:[{private:'signature'}]});
  const r=await createSignatureHandler(d)(request({action:'view',token})),body=await r.json();
  expect(body.revision.snapshot).toEqual({acceptanceText:'Frozen acceptance',acceptanceVersion:'1'});expect(JSON.stringify(body)).not.toContain('private');
 });
 it('exposes only whitelisted frozen order facts to the public browser',async()=>{
  const d=deps();d.action.mockResolvedValue({id,status:'pending',snapshot:{acceptanceText:'Frozen',text:{ORDER_TERMS:['Frozen term']},data:{order_number:'ORD-TEST',activity_date:'2026-12-01',site:'עכו',client_name:'לקוח לדוגמה',client_phone:null,client_email:null,total_price:100,internal_notes:'secret',billing_signer_id:'123'}}});
  const body=await (await createSignatureHandler(d)(request({action:'view',token}))).json();
  expect(body.revision.summary).toMatchObject({orderNumber:'ORD-TEST',site:'עכו',clientName:'לקוח לדוגמה'});
  expect(body.revision.summary.terms).toEqual(['Frozen term']);
  expect(JSON.stringify(body)).not.toContain('secret');expect(JSON.stringify(body)).not.toContain('billing_signer_id');
 });
 it('uses authoritative server revision and bundled text when creating',async()=>{const d=deps(),r=await createSignatureHandler(d)(request({action:'create',orderId:id}));expect(r.status).toBe(200);expect(d.authorize).toHaveBeenCalledOnce();expect(d.action.mock.calls[0][0]).toBe('create');expect(d.action.mock.calls[0][1].text.ORDER_TERMS).toBeDefined();expect(d.renderUnsigned.mock.calls[0][0]).toEqual({data:{},text:{}});expect((await r.json()).signingUrl).toMatch(/^https:\/\/example.invalid\/order-sign#[A-Za-z0-9_-]{43}$/);});
 it('rate limits before database token lookup',async()=>{const d=deps();d.rateLimit.mockResolvedValue(false);const r=await createSignatureHandler(d)(request({action:'view',token}));expect(r.status).toBe(429);expect(d.action).not.toHaveBeenCalled();});
 it('requires staff auth for revocation and history',async()=>{const d=deps();d.authorize.mockRejectedValue(Error('bad jwt'));expect((await createSignatureHandler(d)(request({action:'history',orderId:id}))).status).toBe(401);expect(d.action).not.toHaveBeenCalled();});
 it('returns a signing link only after staff authorization and archive hash verification',async()=>{
  const d=deps();d.action.mockResolvedValue({id,status:'pending',expires_at:'2099-01-01T00:00:00Z',unsigned_path:id+'/unsigned.pdf',unsigned_hash:sha256(Buffer.from('%PDF-test'))});d.extractLink=vi.fn(()=> 'https://example.invalid/order-sign#'+'a'.repeat(43));
  const response=await createSignatureHandler(d)(request({action:'link',revisionId:id},{Authorization:'Bearer staff'}));
  expect(response.status).toBe(200);expect((await response.json()).signingUrl).toContain('/order-sign#');
  expect(d.action).toHaveBeenCalledWith('staff_read',{actorId:id,revisionId:id});
 });
 it('allows an authorized staff member to reach the role-checked delivery action',async()=>{
  const d=deps();d.deliver=vi.fn(async()=>({ok:true}));
  const response=await createSignatureHandler(d)(request({action:'deliver',revisionId:id,requestId:id,channel:'email',recipient:'test@example.invalid'},{Authorization:'Bearer synthetic-user-jwt'}));
  expect(response.status).toBe(200);
  expect(d.action).toHaveBeenCalledWith('staff_read',{actorId:id,revisionId:id});
  expect(d.deliver).toHaveBeenCalledWith(expect.objectContaining({actorId:id,authorization:'Bearer synthetic-user-jwt'}));
 });
 it('rejects missing and expired staff sessions before Edge delivery',async()=>{
  for(const reason of ['missing session','expired session']) {
    const d=deps();d.deliver=vi.fn();d.authorize.mockRejectedValue(Error(reason));
    const response=await createSignatureHandler(d)(request({action:'deliver',revisionId:id,requestId:id,channel:'email'}));
    expect(response.status).toBe(401);
    expect(d.action).not.toHaveBeenCalled();expect(d.deliver).not.toHaveBeenCalled();
  }
 });
 it('rejects staff without a permitted role before Edge delivery',async()=>{
  const d=deps();d.deliver=vi.fn();d.action.mockRejectedValue(new SignatureError('signature_forbidden',403));
  const response=await createSignatureHandler(d)(request({action:'deliver',revisionId:id,requestId:id,channel:'email'}));
  expect(response.status).toBe(403);expect(d.deliver).not.toHaveBeenCalled();
 });
 it('rejects blank signature without claiming token',async()=>{const d=deps();const r=await createSignatureHandler(d)(request({action:'sign',token,requestId:id,signerId:'012345674',fullName:'ישראל ישראלי',strokes:[],accepted:true}));expect(r.status).toBe(400);expect(d.action).not.toHaveBeenCalled();});
 it('finalizes only after storing evidence from the verified original bytes',async()=>{
  const d=deps(),unsigned=Buffer.from('%PDF-test'),signed=Buffer.from('%PDF-stored-evidence');
  const row={id,status:'signing',snapshot:{acceptanceText:'Frozen text',acceptanceVersion:'1'},unsigned_path:id+'/unsigned.pdf',unsigned_hash:sha256(unsigned),revision_hash:'revisionhash',signer_id:'012345674',full_name:'ישראל ישראלי',strokes:[[{x:.1,y:.1},{x:.5,y:.5}]],signed_at:'2026-10-11T10:00:00Z'};
  d.action.mockResolvedValueOnce(row).mockResolvedValueOnce({...row,status:'signed'});d.writePdf.mockResolvedValue(signed);
  const r=await createSignatureHandler(d)(request({action:'sign',token,requestId:id,signerId:'012345674',fullName:row.full_name,strokes:row.strokes,accepted:true}));
  expect(r.status).toBe(200);expect(d.renderSigned.mock.calls[0][0]).toEqual(unsigned);expect(d.renderSigned.mock.calls[0][1].acceptanceText).toBe('Frozen text');
  expect(d.renderSigned.mock.calls[0][1].snapshot).toBe(row.snapshot);
  expect(d.renderSigned.mock.calls[0][1].signerId).toBe('012345674');expect(d.action.mock.calls[0][1].signerId).toBe('012345674');expect(d.writePdf.mock.calls[0][0]).toBe(id+'/'+id+'-signed.pdf');expect(d.action.mock.calls[1]).toEqual(['finish',expect.objectContaining({signedHash:sha256(signed)})]);
 });
 it('records validated contact completion once with the signed revision',async()=>{
  const d=deps(),unsigned=Buffer.from('%PDF-test'),signed=Buffer.from('%PDF-signed');
  const row={id,status:'signing',snapshot:{acceptanceText:'Frozen',acceptanceVersion:'1'},unsigned_path:id+'/unsigned.pdf',unsigned_hash:sha256(unsigned),revision_hash:'hash',full_name:'ישראל ישראלי',strokes:[[{x:0,y:0},{x:1,y:1}]],signed_at:'2026-10-11T10:00:00Z'};
  d.action.mockResolvedValueOnce(row).mockResolvedValueOnce({...row,status:'signed'});d.writePdf.mockResolvedValue(signed);
  const input={action:'sign',token,requestId:id,fullName:'ישראל ישראלי',phone:'0501234567',email:'qa@example.invalid',signerId:'012345674',strokes:row.strokes,accepted:true};
  expect((await createSignatureHandler(d)(request(input))).status).toBe(200);
  expect(d.recordResponse).toHaveBeenCalledWith({revisionId:id,requestId:id,details:{phone:'0501234567',email:'qa@example.invalid',signerId:'012345674'}});
  expect(d.recordResponse).toHaveBeenCalledTimes(2);
  expect(d.recordResponse.mock.invocationCallOrder[0]).toBeLessThan(d.renderSigned.mock.invocationCallOrder[0]);
  expect(d.recordResponse.mock.invocationCallOrder[1]).toBeGreaterThan(d.action.mock.invocationCallOrder[1]);
 });
 it('does not render or finalize if contact evidence cannot be reserved',async()=>{
  const d=deps();d.action.mockResolvedValue({id,status:'signing'});d.recordResponse.mockRejectedValue(new SignatureError('revision_conflict',409));
  const response=await createSignatureHandler(d)(request({action:'sign',token,requestId:id,fullName:'ישראל ישראלי',strokes:[[{x:0,y:0},{x:1,y:1}]],accepted:true}));
  expect(response.status).toBe(409);expect(d.renderSigned).not.toHaveBeenCalled();expect(d.action).toHaveBeenCalledTimes(1);
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
  const d=deps(),input={action:'sign',token,requestId:id,signerId:'012345674',fullName:'Synthetic Signer',strokes:[[{x:0,y:0},{x:1,y:1}]],accepted:true};
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
