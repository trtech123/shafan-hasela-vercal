import {describe,expect,test,vi} from 'vitest';
import {createPendingRecoveryHandler,runPendingRecovery} from './recovery.ts';

const paymentId='a0000000-0000-4000-8000-000000000001';
const claimToken='b0000000-0000-4000-8000-000000000001';
const claim={paymentId,source:'pos' as const,claimToken};
function setup(){
  const take=vi.fn(async()=>claim);
  const recover=vi.fn(async()=>({approved:true,apiStatus:'000',transactionStatus:'000'}));
  const finish=vi.fn(async()=>undefined);
  const log=vi.fn();
  return {take,recover,finish,log};
}
describe('future-only pending payment recovery',()=>{
  test('a scheduled request needs its own token, empty body, and both activation gates',async()=>{
    const s=setup();
    const handle=createPendingRecoveryHandler('a-long-isolated-recovery-token',()=>false,s);
    const request=(token:string,body?:string)=>new Request('https://edge.test/recovery',{
      method:'POST',headers:{authorization:`Bearer ${token}`},body});
    expect((await handle(request('wrong'))).status).toBe(401);
    expect((await handle(request('a-long-isolated-recovery-token','unexpected'))).status).toBe(400);
    expect((await handle(request('a-long-isolated-recovery-token'))).status).toBe(403);
    expect(s.take).not.toHaveBeenCalled();
  });
  test('a missed POS callback uses one existing payment, finalizes then wakes through existing recovery',async()=>{
    const s=setup();
    expect(await runPendingRecovery(s)).toEqual({processed:1,outcome:'verified'});
    expect(s.recover).toHaveBeenCalledExactlyOnceWith('pos',paymentId);
    expect(s.finish).toHaveBeenCalledExactlyOnceWith(paymentId,claimToken,'verified','000','000');
    expect(s.recover.mock.invocationCallOrder[0]).toBeLessThan(s.finish.mock.invocationCallOrder[0]);
  });
  test('Orders use the same claimed and verified path',async()=>{
    const s=setup();s.take.mockResolvedValueOnce({...claim,source:'order'});
    await runPendingRecovery(s);
    expect(s.recover).toHaveBeenCalledExactlyOnceWith('order',paymentId);
  });
  test('nonapproval remains pending; a provider timeout creates an actionable reason',async()=>{
    const s=setup();s.recover.mockResolvedValueOnce({approved:false,apiStatus:'425',transactionStatus:'173'});
    expect(await runPendingRecovery(s)).toEqual({processed:1,outcome:'pending'});
    expect(s.finish).toHaveBeenCalledWith(paymentId,claimToken,'pending','425','173');
    const timeout=setup();timeout.recover.mockRejectedValueOnce(new Error('private provider detail'));
    expect(await runPendingRecovery(timeout)).toEqual({processed:1,outcome:'provider_unavailable'});
    expect(timeout.finish).toHaveBeenCalledWith(paymentId,claimToken,'provider_unavailable',null,null);
    expect(JSON.stringify(timeout.log.mock.calls)).not.toContain('private provider detail');
  });
  test('an explicit provider decline remains uncharged and requires review',async()=>{
    const s=setup();s.recover.mockResolvedValueOnce({approved:false,apiStatus:'000',transactionStatus:'005'});
    expect(await runPendingRecovery(s)).toEqual({processed:1,outcome:'declined'});
    expect(s.finish).toHaveBeenCalledWith(paymentId,claimToken,'declined','000','005');
  });
  test('a verification mismatch is held without leaking provider or billing data',async()=>{
    const s=setup();s.recover.mockRejectedValueOnce(new Error('provider_correlation_mismatch'));
    expect(await runPendingRecovery(s)).toEqual({processed:1,outcome:'review_required'});
    expect(s.finish).toHaveBeenCalledWith(paymentId,claimToken,'review_required',null,null);
  });
  test('no claim means no lookup; duplicate schedules cannot process another payment',async()=>{
    const s=setup();s.take.mockResolvedValueOnce(null);
    expect(await runPendingRecovery(s)).toEqual({processed:0,outcome:'idle'});
    expect(s.recover).not.toHaveBeenCalled();
  });
  test('overlapping scans use one database claim, leaving delayed callbacks to guarded finalizers',async()=>{
    const s=setup();s.take.mockResolvedValueOnce(claim).mockResolvedValueOnce(null);
    const results=await Promise.all([runPendingRecovery(s),runPendingRecovery(s)]);
    expect(results).toEqual(expect.arrayContaining([{processed:1,outcome:'verified'},
      {processed:0,outcome:'idle'}]));
    expect(s.recover).toHaveBeenCalledTimes(1);
  });
});
