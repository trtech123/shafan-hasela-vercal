// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach, expect, test, vi} from 'vitest';
import PosPayment from './PosPayment';

const state=vi.hoisted(()=>({user:{role:'admin',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},request:vi.fn()}));
vi.mock('@/lib/AuthContext',()=>({useAuth:()=>({user:state.user})}));
vi.mock('react-router-dom',()=>({
  Link:({children})=><span>{children}</span>,
  useLocation:()=>({search:'',state:null}),
}));
vi.mock('@/api/supabaseClient',()=>({supabase:{}}));
vi.mock('@/payments/posPayments',()=>({
  posPendingKey:'pelecard.posPending.v1',
  posPendingKeyForActor:actorId=>actorId?'pelecard.posPending.v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':null,
  posCheckoutRequestKey:(_id,_cart,savedRaw)=>JSON.parse(savedRaw||'null')?.requestKey||'22222222-2222-4222-8222-222222222222',
  requestPosPayment:(...args)=>state.request(...args),
  redirectPosPayment:vi.fn(),
  posPaymentErrorMessage:()=>'',
}));
vi.mock('@/payments/orderPayments',()=>({validOrderId:value=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||'')}));

afterEach(()=>{cleanup();sessionStorage.clear();state.request.mockReset();state.user={role:'admin',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};});

test('a saved pending provider session cannot be reopened from the POS screen',async()=>{
  state.request.mockResolvedValue({paymentId:'11111111-1111-4111-8111-111111111111',amountMinor:300,
    status:'pending_provider',paid:false,canVerify:true});
  render(<PosPayment/>);
  expect(await screen.findByText('ממתין לתוצאת פלאקארד')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'המשך לניסיון התשלום הקיים'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'בדוק תוצאת תשלום'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'שמור סל ובדוק את הסכום בשרת'})).toBeNull();
});

test('saved checkout is looked up after the authenticated profile finishes loading',async()=>{
  const key='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  sessionStorage.setItem('pelecard.posPending.v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    JSON.stringify({requestKey:key,actorId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}));
  state.user=null;
  state.request.mockResolvedValue({paymentId:'11111111-1111-4111-8111-111111111111',amountMinor:300,
    status:'pending_provider',paid:false,canVerify:true});
  const result=render(<PosPayment/>);
  state.user={role:'admin',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
  result.rerender(<PosPayment/>);
  await screen.findByText('ממתין לתוצאת פלאקארד');
  expect(state.request).toHaveBeenCalledWith(expect.anything(),{action:'status',requestKey:key});
});
