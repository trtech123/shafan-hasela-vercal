// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,test,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import PelecardPendingReview,{PelecardPendingAlert} from './PelecardPendingReview';
const rpc=vi.fn();
vi.mock('@/api/supabaseClient',()=>({supabase:{rpc:(...args)=>rpc(...args)}}));
afterEach(()=>{cleanup();rpc.mockReset();});
test('Admin sees an actionable pending payment with safe reason and reference',async()=>{
  rpc.mockResolvedValue({data:[{payment_id:'payment-1',source:'pos',order_number:null,
    last_reason:'provider_unavailable',last_lookup_status:null,last_transaction_status:null,
    last_checked_at:'2026-11-03T03:00:00Z',checks:2}],error:null});
  render(<PelecardPendingReview/>);
  expect(await screen.findByText(/לא התקבלה תשובה ודאית/)).toBeInTheDocument();
  expect(screen.getByText(/payment-1/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('אין לבצע חיוב חדש');
  expect(rpc).toHaveBeenCalledWith('list_pelecard_pending_alerts');
});
test('Global Admin notification links to Accounting',async()=>{
  rpc.mockResolvedValue({data:[{payment_id:'payment-2',source:'order',order_number:'ORD-9',
    last_reason:'provider_pending'}],error:null});
  render(<MemoryRouter><PelecardPendingAlert/></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('1 תשלומי פלאקארד');
  expect(screen.getByRole('alert')).toHaveAttribute('href','/accounting-operations');
});
test('Unavailable recovery list warns instead of showing a false all-clear',async()=>{
  rpc.mockResolvedValue({data:null,error:new Error('unavailable')});
  render(<PelecardPendingReview/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('לא ניתן לטעון');
});
