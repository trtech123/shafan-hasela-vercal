// @vitest-environment jsdom
import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import OrderConfirmationPDF from './OrderConfirmationPDF';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),panel:vi.fn(),user:{role:'admin'}}));
vi.mock('@/api/supabaseClient',()=>({supabase:{rpc:mocks.rpc}}));
vi.mock('@/lib/AuthContext',()=>({useAuth:()=>({user:mocks.user})}));
vi.mock('./OrderSignaturePanel',()=>({default:props=>{mocks.panel(props);return <section aria-label="revision management">Revision management</section>;}}));
vi.mock('../quotes/quotePdf',()=>({buildQuotePdf:vi.fn()}));
const order={id:'00000000-0000-4000-8000-000000000001',order_number:'UNTRUSTED-PROP',client_email:'mutable@example.invalid'};
const document={version:'a'.repeat(32),can_send:true,data:{id:order.id,order_number:'FROZEN-1',client_name:'לקוח שמור',client_email:'saved@example.invalid',total_price:100,quotation_snapshot:{},notes:'הערה ללקוח'}};
beforeEach(()=>{vi.clearAllMocks();mocks.user={role:'admin'};mocks.rpc.mockResolvedValue({data:document,error:null});});
afterEach(cleanup);
describe('order confirmation revision management integration',()=>{
 it('loads canonical server document and exposes staff revision management',async()=>{
  render(<OrderConfirmationPDF order={order} onClose={()=>{}}/>);
  await screen.findByRole('region',{name:'revision management'});
  expect(mocks.rpc).toHaveBeenCalledWith('order_confirmation_document',{p_order_id:order.id});
  expect(mocks.panel.mock.calls[0][0]).toMatchObject({orderId:order.id,email:'saved@example.invalid'});
  expect(screen.queryByText('UNTRUSTED-PROP')).toBeNull();expect(screen.getByText('FROZEN-1')).toBeTruthy();
 });
 it('keeps read-only access independent of managing invitations',async()=>{
  mocks.user={role:'מדריך'};mocks.rpc.mockResolvedValue({data:{...document,can_send:false},error:null});
  render(<OrderConfirmationPDF order={order} onClose={()=>{}}/>);
  await screen.findByText('FROZEN-1');expect(mocks.panel).not.toHaveBeenCalled();
  expect(screen.getByText(/האישור זמין לצפייה ולהורדה בלבד/)).toBeTruthy();
 });
 it('does not show management or use mutable props when the authoritative read fails',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message:'denied'}});render(<OrderConfirmationPDF order={order} onClose={()=>{}}/>);
  await screen.findByRole('alert');expect(mocks.panel).not.toHaveBeenCalled();expect(screen.queryByText('UNTRUSTED-PROP')).toBeNull();
 });
 it('clearly separates the live preview from archived signed revisions',async()=>{
  render(<OrderConfirmationPDF order={order} onClose={()=>{}}/>);await screen.findByText('FROZEN-1');
  expect(screen.getByText(/התצוגה להלן היא ההזמנה הנוכחית/)).toBeTruthy();
  expect(mocks.rpc.mock.calls.map(([name])=>name)).toEqual(['order_confirmation_document']);
 });
});
