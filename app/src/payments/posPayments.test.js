import {describe,expect,test,vi} from 'vitest';
import {requestPosPayment,redirectPosPayment,posPaymentErrorMessage,posCheckoutRequestKey,startPosCheckout} from './posPayments';
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
  test('preserves the safe 503 gate code and explains why cart preparation stopped',async()=>{
    const context=new Response(JSON.stringify({error:{code:'capability_disabled'}}),{status:503});
    const invoke=vi.fn(async()=>({data:null,error:{context}}));
    await expect(requestPosPayment({functions:{invoke}},{action:'prepare'})).rejects.toMatchObject({code:'capability_disabled'});
    expect(posPaymentErrorMessage('capability_disabled')).toMatch(/מושבת/);
  });
  test('explains an existing unsettled POS attempt without suggesting a new checkout',()=>{
    expect(posPaymentErrorMessage('pos_payment_in_progress')).toMatch(/ניסיון תשלום קודם/);
    expect(posPaymentErrorMessage('pos_payment_in_progress')).toMatch(/אין להתחיל/);
  });
  test('new purchase key wins over an older pending checkout with identical cart',()=>{
    const cart={lines:[{kind:'product',id,qty:1}],discount:null};
    const oldKey='22222222-2222-4222-8222-222222222222';
    const nextKey='33333333-3333-4333-8333-333333333333';
    const saved=JSON.stringify({requestKey:oldKey,cart:JSON.stringify(cart)});
    expect(posCheckoutRequestKey(nextKey,cart,saved)).toBe(nextKey);
    expect(posCheckoutRequestKey(null,cart,saved)).toBe(oldKey);
  });
  test('one Pay action prepares, initializes and redirects with server amount',async()=>{
    const hosted={...view,status:'hosted',canResume:true,redirectUrl:`https://gateway20.pelecard.biz/PaymentGW?transactionId=${id}`,
      hostedExpiresAt:new Date(Date.now()+60000).toISOString()};
    const invoke=vi.fn(async(_route,{body})=>({data:body.action==='prepare'?view:hosted,error:null}));
    const redirect=vi.fn();
    await startPosCheckout({functions:{invoke}},{requestKey:id,cart:{lines:[{kind:'product',id,qty:1}],discount:null},billing:{},redirect});
    expect(invoke.mock.calls.map(([,args])=>args.body.action)).toEqual(['prepare','initialize']);
    expect(invoke.mock.calls[1][1].body).toEqual({action:'initialize',requestKey:id});
    expect(redirect).toHaveBeenCalledWith(hosted.redirectUrl);
  });
  test('does not initialize an already dispatched or uncertain attempt',async()=>{
    const invoke=vi.fn(async()=>({data:{...view,dispatchStarted:true},error:null}));
    await startPosCheckout({functions:{invoke}},{requestKey:id,cart:{lines:[],discount:null},billing:{},redirect:vi.fn()});
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
