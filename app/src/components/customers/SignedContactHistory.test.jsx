// @vitest-environment jsdom
import {render,screen,cleanup,fireEvent,waitFor,act} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import SignedContactHistory from './SignedContactHistory';
import {signatureRequest} from '@/lib/orderSignatureClient';

const from=vi.fn(),row={revision_id:'r1',order_id:'o1',lead_id:'l1',lead_link_status:'linked',full_name:'ישראל ישראלי',details:{phone:'0501234567',email:'qa@example.invalid'},signed_at:'2026-11-24T10:00:00Z'};
vi.mock('@/api/supabaseClient',()=>({supabase:{from:(...args)=>from(...args)}}));
vi.mock('@/lib/orderSignatureClient',()=>({signatureRequest:vi.fn()}));
beforeEach(()=>{
 from.mockReset();
 from.mockImplementation(()=>({select:()=>({eq:(column,id)=>{from.filter=[column,id];return {order:()=>({limit:async()=>({data:[row],error:null})})};}})}));
 signatureRequest.mockReset();signatureRequest.mockResolvedValue(new Blob(['signed pdf'],{type:'application/pdf'}));
 URL.createObjectURL=vi.fn(()=> 'blob:signed');URL.revokeObjectURL=vi.fn();
});
afterEach(cleanup);

it.each([['customerId','c1','customer_id'],['orderId','o1','order_id'],['leadId','l1','lead_id']])('shows signed evidence for %s without updating records',async(prop,id,column)=>{
 render(<SignedContactHistory {...{[prop]:id}}/>);
 expect(await screen.findByText('0501234567')).toBeTruthy();
 expect(from.filter).toEqual([column,id]);
 expect(screen.getByText(/ליד מקושר/)).toBeTruthy();
 expect(from).toHaveBeenCalledWith('order_signature_responses');
});
it('opens the signed private revision only through staff authorization',async()=>{
 const view=render(<SignedContactHistory leadId="l1"/>);
 fireEvent.click(await screen.findByRole('button',{name:'צפייה בחתימה ובאישור החתום'}));
 await waitFor(()=>expect(signatureRequest).toHaveBeenCalledWith({action:'pdf',revisionId:'r1',signed:true},{staff:true}));
 expect(await screen.findByTitle('אישור הזמנה חתום')).toBeTruthy();
 view.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:signed');
});
it('marks unmatched responses for review without inventing a lead',async()=>{
 from.mockImplementation(()=>({select:()=>({eq:()=>({order:()=>({limit:async()=>({data:[{...row,lead_id:null,lead_link_status:'unmatched'}],error:null})})})})}));
 render(<SignedContactHistory orderId="o1"/>);
 expect(await screen.findByText(/לא נמצא ליד מקושר.*בדיקה/)).toBeTruthy();
});
it('does not expose a late private PDF after the lead view closes',async()=>{
 let resolvePdf;signatureRequest.mockImplementation(()=>new Promise(resolve=>{resolvePdf=resolve;}));
 const view=render(<SignedContactHistory leadId="l1"/>);
 fireEvent.click(await screen.findByRole('button',{name:'צפייה בחתימה ובאישור החתום'}));
 await waitFor(()=>expect(resolvePdf).toBeTypeOf('function'));
 view.unmount();
 await act(async()=>{resolvePdf(new Blob(['signed']));});
 expect(URL.createObjectURL).not.toHaveBeenCalled();
});
