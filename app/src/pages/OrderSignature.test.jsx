// @ts-nocheck -- Vitest replaces browser APIs and the request module with test doubles.
// @vitest-environment jsdom
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import OrderSignature from './OrderSignature';
import {signatureRequest} from '@/lib/orderSignatureClient';
vi.mock('@/api/supabaseClient',()=>({supabase:{}}));
vi.mock('@/lib/orderSignatureClient',async importOriginal=>({...await importOriginal(),signatureRequest:vi.fn()}));
const token='a'.repeat(43),revision={id:'r1',revision_number:1,status:'awaiting_signature',expires_at:'2026-10-18T12:00:00Z',snapshot:{acceptanceText:'קראתי ומאשר את ההזמנה והתנאים הכלליים'}};
beforeEach(()=>{
 vi.clearAllMocks();window.history.replaceState(null,'','/order-sign#'+token);
 URL.createObjectURL=vi.fn(()=> 'blob:local-pdf');URL.revokeObjectURL=vi.fn();
 window.PointerEvent=class extends MouseEvent{constructor(type,props){super(type,props);this.pointerId=props.pointerId;this.pointerType=props.pointerType;}};
 HTMLCanvasElement.prototype.getContext=vi.fn(()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}}));HTMLCanvasElement.prototype.setPointerCapture=vi.fn();
 signatureRequest.mockImplementation(async body=>body.action==='view'?{revision}:body.action==='pdf'?new Blob(['local PDF'],{type:'application/pdf'}):{ok:true});
});
afterEach(cleanup);
async function fill(pointerType='mouse'){
 const name=await screen.findByLabelText('שם מלא');fireEvent.change(name,{target:{value:'ישראל ישראלי'}});
 const canvas=screen.getByRole('img');canvas.getBoundingClientRect=()=>({left:0,top:0,width:640,height:240});
 fireEvent.pointerDown(canvas,{pointerType,pointerId:1,clientX:20,clientY:30});fireEvent.pointerMove(canvas,{pointerType,pointerId:1,clientX:200,clientY:120});fireEvent.pointerUp(canvas,{pointerType,pointerId:1});
 fireEvent.click(screen.getByRole('checkbox'));
}
describe('public order confirmation signing',()=>{
 it('shows frozen order facts and browser fields without requiring a PDF viewer',async()=>{
  signatureRequest.mockImplementation(async body=>body.action==='view'?{revision:{...revision,summary:{orderNumber:'ORD-TEST',activityDate:'2026-12-01',site:'עכו',clientName:'לקוח לדוגמה',clientEmail:'',clientPhone:'',totalPrice:100}}}:body.action==='pdf'?new Blob(['pdf']):{ok:true});
  render(<OrderSignature/>);
  await screen.findByText(/ORD-TEST/);
  expect(screen.getByText(/עכו/)).toBeTruthy();
  expect(screen.getByLabelText('טלפון להשלמה')).toBeTruthy();
  expect(screen.getByLabelText('אימייל להשלמה')).toBeTruthy();
  expect(screen.getByLabelText('תעודת זהות של החותם (רשות)')).toBeTruthy();
  expect(screen.getByRole('button',{name:'אישור וחתימה'})).toBeTruthy();
 });
 it('keeps signer ID optional for a complete signature',async()=>{
  render(<OrderSignature/>);await fill();expect(screen.getByLabelText('תעודת זהות של החותם (רשות)')).toBeTruthy();expect(screen.getByRole('button',{name:'אישור וחתימה'}).disabled).toBe(false);
 });
 it('views server PDF without consuming authority and strips token fragment',async()=>{
  render(<OrderSignature/>);await screen.findByLabelText('שם מלא');
  expect(window.location.hash).toBe('');expect(signatureRequest.mock.calls.map(([body])=>body.action)).toEqual(['view']);
  expect(screen.getByRole('button',{name:'אישור וחתימה'}).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'צפייה בקובץ האישור המלא (PDF)'}));
  await screen.findByText('פתיחת האישור המלא / הורדת PDF');
  expect(screen.getByText(/פתיחת האישור המלא/).getAttribute('href')).toBe('blob:local-pdf');
 });
 it('requires explicit acceptance and submits only signature inputs with stable replay identity',async()=>{
  let tries=0;signatureRequest.mockImplementation(async body=>{if(body.action==='view')return {revision};if(body.action==='pdf')return new Blob(['pdf']);if(++tries===1)throw Error('timeout');return {ok:true};});
  render(<OrderSignature/>);await fill();fireEvent.click(screen.getByRole('button',{name:'אישור וחתימה'}));
  const retry=await screen.findByRole('button',{name:'בדיקת ושמירת אותה חתימה'});
  expect(screen.getByLabelText('שם מלא').disabled).toBe(true);expect(screen.getByRole('checkbox').disabled).toBe(true);
  fireEvent.click(retry);
  await screen.findByText('האישור נחתם בהצלחה');
  const calls=signatureRequest.mock.calls.map(([body])=>body).filter(body=>body.action==='sign');
  expect(calls[0]).not.toHaveProperty('signerId');expect(calls).toHaveLength(2);expect(calls[0]).toEqual(calls[1]);
  expect(Object.keys(calls[0]).sort()).toEqual(['accepted','action','fullName','requestId','strokes','token'].sort());
 });
 it('expired/revoked/invalid links disclose no revision and provide no form',async()=>{
  signatureRequest.mockRejectedValue(Error('link_unavailable'));render(<OrderSignature/>);
  await screen.findByRole('alert');expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.queryByLabelText('שם מלא')).toBeNull();
 });
 it('does not allow a second acceptance for a signed link',async()=>{
  signatureRequest.mockResolvedValue({revision:{...revision,status:'signed'},signed:true});render(<OrderSignature/>);
  await screen.findByText('האישור נחתם בהצלחה');expect(signatureRequest).toHaveBeenCalledTimes(1);expect(screen.queryByRole('checkbox')).toBeNull();
 });
});

describe('local signing guidance and touch consent',()=>{
 it.each([
  ['', 'יש להזין שם מלא: שם פרטי ושם משפחה.'],
  ['ישראל','כתוב את השם כפי שמופיע בהזמנה'],
  ['123 abc','כתוב את השם כפי שמופיע בהזמנה']
 ])('explains invalid name %s without submitting',async(name,message)=>{
  render(<OrderSignature/>);await fill();fireEvent.change(screen.getByLabelText('שם מלא'),{target:{value:name}});
  fireEvent.click(screen.getByRole('button',{name:'אישור וחתימה'}));
  expect((await screen.findByRole('alert')).textContent).toBe(message);
  expect(signatureRequest.mock.calls.some(([body])=>body.action==='sign')).toBe(false);
 });
 it('explains missing ink without submitting',async()=>{
  render(<OrderSignature/>);await fill();fireEvent.click(screen.getByRole('button',{name:'ניקוי חתימה'}));
  fireEvent.click(screen.getByRole('button',{name:'אישור וחתימה'}));
  expect((await screen.findByRole('alert')).textContent).toBe('יש לצייר חתימה באצבע או בעכבר לפני האישור.');
  expect(signatureRequest.mock.calls.some(([body])=>body.action==='sign')).toBe(false);
 });
 it('explains missing explicit consent without submitting',async()=>{
  render(<OrderSignature/>);await fill();fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'אישור וחתימה'}));
  expect((await screen.findByRole('alert')).textContent).toBe('יש לסמן שקראתם ואישרתם את ההזמנה והתנאים הכלליים.');
  expect(signatureRequest.mock.calls.some(([body])=>body.action==='sign')).toBe(false);
 });
 it.each(['mouse','touch'])('accepts drawn %s ink and label-tap consent',async pointerType=>{
  render(<OrderSignature/>);await fill(pointerType);
  const checkbox=screen.getByRole('checkbox',{name:'אישור ההזמנה והתנאים הכלליים'});
  fireEvent.click(checkbox);expect(checkbox.checked).toBe(false);
  fireEvent.click(screen.getByText(revision.snapshot.acceptanceText));expect(checkbox.checked).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'אישור וחתימה'}));await screen.findByText('האישור נחתם בהצלחה');
  expect(signatureRequest.mock.calls.find(([body])=>body.action==='sign')[0]).toMatchObject({fullName:'ישראל ישראלי',accepted:true,strokes:[[{x:0.03125,y:0.125},{x:0.3125,y:0.5}]]});
 });
});
