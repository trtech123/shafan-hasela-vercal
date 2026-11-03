// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach, expect, test, vi} from 'vitest';
import PosPayment from './PosPayment';

vi.mock('@/lib/AuthContext',()=>({useAuth:()=>({user:{role:'admin'}})}));
vi.mock('react-router-dom',()=>({
  Link:({children})=><span>{children}</span>,
  useLocation:()=>({search:'',state:null}),
}));
vi.mock('@/api/supabaseClient',()=>({supabase:{}}));
vi.mock('@/payments/posPayments',()=>({
  posCheckoutRequestKey:()=> '22222222-2222-4222-8222-222222222222',
  requestPosPayment:vi.fn(async()=>({
    paymentId:'11111111-1111-4111-8111-111111111111',
    amountMinor:300,status:'pending_provider',paid:false,
    canResume:true,redirectUrl:'https://gateway20.pelecard.biz/PaymentGW?transactionId=33333333-3333-4333-8333-333333333333',
    canVerify:true,
  })),
  redirectPosPayment:vi.fn(),
  posPaymentErrorMessage:()=>'',
}));
vi.mock('@/payments/orderPayments',()=>({validOrderId:()=>true}));

afterEach(cleanup);

test('a saved pending provider session cannot be reopened from the POS screen',async()=>{
  render(<PosPayment/>);
  expect(await screen.findByText('ממתין לתוצאת פלאקארד')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'המשך לניסיון התשלום הקיים'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'בדוק תוצאת תשלום'})).toBeInTheDocument();
});
