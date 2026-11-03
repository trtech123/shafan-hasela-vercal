import {describe,expect,test,vi} from 'vitest';
import {createPosHandler,createPosFeedback,type PosDependencies} from './pos-handler.ts';
const paymentId='11111111-1111-4111-8111-111111111111';
const requestKey='22222222-2222-4222-8222-222222222222';
const productId='33333333-3333-4333-8333-333333333333';
const actorId='44444444-4444-4444-8444-444444444444';
function setup(role='cashier'){
  let state='initiated';let saleId:string|null=null;let hostedState='usable';
  const reserve=vi.fn(async()=>({paymentId,created:true,amountMinor:100}));
  const call=vi.fn(async(action:string)=>action==='lookup'?{StatusCode:'000',ResultData:{TransactionId:paymentId,
    ConfirmationKey:'confirmation',ShvaResult:'000',JParam:'4',DebitTotal:'100',DebitCurrency:'1',DebitType:'01',ApprovedBy:'1',DebitApproveNumber:'approval'}}:action==='validate'?1:{reachable:true});
  const observe=vi.fn(async(_id:string,nextState:string)=>{hostedState=nextState;});
  const finalize=vi.fn(async()=>{state='succeeded';saleId='55555555-5555-4555-8555-555555555555';});
  const onPaymentFinalized=vi.fn();
  const log=vi.fn();
  const deps:PosDependencies={read:()=> 'true',allowedOrigins:['https://example.org'],log,
    auth:{authenticate:async()=>({id:actorId,role})},reserve,
    view:async()=>({paymentId,amountMinor:100,currency:'ILS',status:state,saleId,
      receiptNumber:saleId?'RCP-1':null,hostedState,hostedExpiresAt:'2099-01-01T00:00:00Z',
      redirectUrl:`https://gateway20.pelecard.biz/PaymentGW?transactionId=${paymentId}`,canVerify:state==='pending_provider',dispatchStarted:state!=='initiated'}),
    get:async()=>({payment_id:paymentId,amount_minor:100,currency:'ILS',transaction_id:paymentId,
      confirmation_key:'confirmation',hosted_state:hostedState,hosted_expires_at:'2099-01-01T00:00:00Z'}),
    observe,finalize,onPaymentFinalized,call,cancel:async()=>true,
  };
  const handler=createPosHandler(deps);
  const post=(body:unknown,auth=true)=>handler(new Request('https://example.org/payment',{method:'POST',
    headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer valid'}:{})},body:JSON.stringify(body)}));
  return {post,deps,reserve,call,observe,finalize,onPaymentFinalized,log,setPending:()=>{state='pending_provider'},setPaid:()=>{state='succeeded';saleId='55555555-5555-4555-8555-555555555555'}};
}
const prepared={action:'prepare',requestKey,lines:[{kind:'product',id:productId,qty:1}],discount:null,
  billing:{kind:'person',name:'',identity:'',email:''}};
describe('POS Edge payment boundary',()=>{
  test.each(['admin','cashier'])('%s can prepare with only item IDs and quantities',async role=>{
    const s=setup(role);expect((await s.post(prepared)).status).toBe(201);
    expect(s.reserve).toHaveBeenCalledWith(actorId,requestKey,prepared.lines,null,prepared.billing);
    expect(s.call).not.toHaveBeenCalled();
  });
  test.each(['operations','instructor'])('%s cannot reserve or see payment status',async role=>{
    const s=setup(role);expect((await s.post(prepared)).status).toBe(403);expect(s.reserve).not.toHaveBeenCalled();
  });
  test('missing session and browser amount tampering have no side effects',async()=>{
    const s=setup();expect((await s.post(prepared,false)).status).toBe(401);
    expect((await s.post({...prepared,amountMinor:1})).status).toBe(400);expect(s.reserve).not.toHaveBeenCalled();
  });
  test('initialization calls the provider adapter only after preparation',async()=>{
    const s=setup();expect((await s.post({action:'initialize',requestKey})).status).toBe(200);
    expect(s.call).toHaveBeenCalledWith('init',paymentId);
  });
  test('an already-dispatched attempt cannot initialize a second hosted session',async()=>{
    const s=setup();s.setPending();
    expect((await s.post({action:'initialize',requestKey})).status).toBe(409);
    expect(s.call).not.toHaveBeenCalled();
  });
  test('verified approval finalizes once and repeated verification reads success',async()=>{
    const s=setup();s.setPending();
    const first=await s.post({action:'verify',paymentId});expect(first.status).toBe(200);
    expect((await first.json()).paid).toBe(true);expect(s.finalize).toHaveBeenCalledTimes(1);
    expect(s.onPaymentFinalized).toHaveBeenCalledExactlyOnceWith(paymentId);
    expect((await s.post({action:'verify',paymentId})).status).toBe(200);
    expect(s.finalize).toHaveBeenCalledTimes(1);
    expect(s.onPaymentFinalized).toHaveBeenCalledTimes(1);
  });
  test('nonapproved lookup never finalizes a sale',async()=>{
    const s=setup();s.setPending();s.call.mockImplementation(async(action:string)=>action==='lookup'?{StatusCode:'510',ResultData:null}:action==='validate'?1:{reachable:true});
    const response=await s.post({action:'verify',paymentId});expect(response.status).toBe(200);
    expect((await response.json()).paid).toBe(false);expect(s.finalize).not.toHaveBeenCalled();
    expect(s.onPaymentFinalized).not.toHaveBeenCalled();
    expect(s.call).not.toHaveBeenCalledWith('hosted',paymentId);
  });
  test('provider timeout closes the hosted link without declaring a charge outcome',async()=>{
    const s=setup();s.setPending();s.call.mockImplementation(async(action:string)=>action==='lookup'
      ?{StatusCode:'301',ResultData:null}:action==='validate'?1:{reachable:true});
    const response=await s.post({action:'verify',paymentId});expect(response.status).toBe(200);
    const body=await response.json();expect(body.paid).toBe(false);expect(body.canResume).toBe(false);
    expect(body.verification).toMatchObject({approved:false,resolution:'unknown',apiStatus:'301'});
    expect(s.observe).toHaveBeenCalledWith(paymentId,'expired','301',null,true);
    expect(s.call).not.toHaveBeenCalledWith('hosted',paymentId);
    expect(s.finalize).not.toHaveBeenCalled();expect(s.onPaymentFinalized).not.toHaveBeenCalled();
  });
  test('failed database finalization never wakes Payper',async()=>{
    const s=setup();s.setPending();s.finalize.mockRejectedValueOnce(new Error('database_unavailable'));
    expect((await s.post({action:'verify',paymentId})).status).toBe(502);
    expect(s.onPaymentFinalized).not.toHaveBeenCalled();
  });
  test('nested hosted callback performs provider verification before finalization and wake',async()=>{
    const s=setup();s.setPending();
    const callback=new Request(`https://edge.test/feedback?paymentId=${paymentId}`,{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({result:JSON.stringify({ResultData:{
        ConfirmationKey:'confirmation',TransactionId:paymentId,
      }})}),
    });
    expect((await createPosFeedback(s.deps)(callback)).status).toBe(200);
    expect(s.call).toHaveBeenCalledWith('lookup',paymentId);
    expect(s.call).toHaveBeenCalledWith('validate',paymentId);
    expect(s.finalize).toHaveBeenCalledTimes(1);
    expect(s.onPaymentFinalized).toHaveBeenCalledExactlyOnceWith(paymentId);
  });
  test('nested callback with wrong correlation never reads provider or finalizes',async()=>{
    const s=setup();s.setPending();
    const callback=new Request(`https://edge.test/feedback?paymentId=${paymentId}`,{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({result:JSON.stringify({ResultData:{
        ConfirmationKey:'forged',TransactionId:paymentId,
      }})}),
    });
    expect((await createPosFeedback(s.deps)(callback)).status).toBe(400);
    expect(s.call).not.toHaveBeenCalled();
    expect(s.finalize).not.toHaveBeenCalled();
    expect(s.onPaymentFinalized).not.toHaveBeenCalled();
  });
  test('provider duplicate warning is logged without finalization or customer data',async()=>{
    const s=setup();s.setPending();
    s.call.mockImplementation(async(action:string)=>action==='lookup'
      ?{StatusCode:'425',ResultData:{ShvaResult:'173'}}:action==='validate'?1:{reachable:true});
    const callback=new Request(`https://edge.test/feedback?paymentId=${paymentId}`,{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:JSON.stringify({ResultData:{ConfirmationKey:'confirmation',TransactionId:paymentId}}),
    });
    expect((await createPosFeedback(s.deps)(callback)).status).toBe(200);
    expect(s.finalize).not.toHaveBeenCalled();
    expect(s.onPaymentFinalized).not.toHaveBeenCalled();
    expect(s.log).toHaveBeenCalledWith({event:'pelecard_pos_callback_checked',paymentId,approved:false,
      apiStatus:'425',transactionStatus:'173'});
    expect(JSON.stringify(s.log.mock.calls)).not.toContain('confirmation');
  });
});
