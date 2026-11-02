import {describe,expect,test,vi} from 'vitest';
import {requestPosPayment,redirectPosPayment} from './posPayments';
const id='11111111-1111-4111-8111-111111111111';
const view={mode:'pos',paymentId:id,amountMinor:100,currency:'ILS',status:'initiated',paid:false,serverTime:new Date().toISOString()};
describe('POS browser boundary',()=>{
  test('sends no payment amount when preparing a cart',async()=>{
    const invoke=vi.fn(async()=>({data:view,error:null}));
    await requestPosPayment({functions:{invoke}},{action:'prepare',requestKey:id,lines:[{kind:'product',id,qty:1}],discount:null,billing:{kind:'person',name:'',identity:'',email:''}});
    expect(invoke).toHaveBeenCalledWith('pelecard-pos-payment',{body:expect.not.objectContaining({amountMinor:expect.anything()})});
  });
  test('accepts only the exact Pelecard hosted URL',()=>{
    const assign=vi.fn();
    redirectPosPayment(`https://gateway20.pelecard.biz/PaymentGW?transactionId=${id}`,{assign});
    expect(assign).toHaveBeenCalledTimes(1);
    expect(()=>redirectPosPayment('https://example.com/pay',{assign})).toThrow();
  });
});
