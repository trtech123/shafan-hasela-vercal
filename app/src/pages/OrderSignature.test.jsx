// @vitest-environment jsdom
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import OrderSignature from './OrderSignature';
import {signatureRequest} from '@/lib/orderSignatureClient';
vi.mock('@/lib/orderSignatureClient',async()=>({signatureRequest:vi.fn(),validSignerName:value=>value.trim().split(/\s+/).length>=2}));
const token='a'.repeat(43),revision={id:'r1',revision_number:1,status:'awaiting_signature',expires_at:'2026-10-18T12:00:00Z',snapshot:{acceptanceText:'קראתי ומאשר את ההזמנה והתנאים הכלליים'}};
beforeEach(()=>{
 vi.clearAllMocks();window.history.replaceState(null,'','/order-sign#'+token);
 URL.createObjectURL=vi.fn(()=> 'blob:local-pdf');URL.revokeObjectURL=vi.fn();
 window.PointerEvent=class extends MouseEvent{constructor(type,props){super(type,props);this.pointerId=props.pointerId;}};
 HTMLCanvasElement.prototype.getContext=vi.fn(()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}}));HTMLCanvasElement.prototype.setPointerCapture=vi.fn();
 signatureRequest.mockImplementation(async body=>body.action==='view'?{revision}:body.action==='pdf'?new Blob(['local PDF'],{type:'application/pdf'}):{ok:true});
});
afterEach(cleanup);
async function fill(){
 const name=await screen.findByLabelText('שם מלא');fireEvent.change(name,{target:{value:'ישראל ישראלי'}});
 const canvas=screen.getByRole('img');canvas.getBoundingClientRect=()=>({left:0,top:0,width:640,height:240});
 fireEvent.pointerDown(canvas,{pointerId:1,clientX:20,clientY:30});fireEvent.pointerMove(canvas,{pointerId:1,clientX:200,clientY:120});fireEvent.pointerUp(canvas,{pointerId:1});
 fireEvent.click(screen.getByRole('checkbox'));
}
describe('public order confirmation signing',()=>{
 it('requires no signer ID to submit a complete signature',async()=>{
 render(<OrderSignature/>);await fill();expect(screen.queryByLabelText('תעודת זהות של החותם')).toBeNull();expect(screen.getByRole('button',{name:'אישור וחתימה'}).disabled).toBe(false);
 });
 it('views server PDF without consuming authority and strips token fragment',async()=>{
  render(<OrderSignature/>);await screen.findByLabelText('שם מלא');
  expect(window.location.hash).toBe('');expect(signatureRequest.mock.calls.map(([body])=>body.action)).toEqual(['view','pdf']);
  expect(screen.getByRole('button',{name:'אישור וחתימה'}).disabled).toBe(true);
  expect(screen.getByText(/פתיחת האישור המלא/).getAttribute('href')).toBe('blob:local-pdf');
 });
 it('requires explicit acceptance and submits only signature inputs with stable replay identity',async()=>{
  let tries=0;signatureRequest.mockImplementation(async body=>{if(body.action==='view')return {revision};if(body.action==='pdf')return new Blob(['pdf']);if(++tries===1)throw Error('timeout');return {ok:true};});
  render(<OrderSignature/>);await fill();fireEvent.click(screen.getByRole('button',{name:'אישור וחתימה'}));
  fireEvent.click(await screen.findByRole('button',{name:'בדיקת ושמירת אותה חתימה'}));
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
