import {expect,test} from 'vitest';
import {classifyPosRpcError} from './pos-rpc-error.ts';

test('maps the existing pending payment constraint to a safe conflict',()=>{
  const error=classifyPosRpcError({code:'23514',message:'pos_payment_in_progress'},'reserve_pos_pelecard');
  expect(error).toMatchObject({status:409,code:'pos_payment_in_progress'});
});

test('does not disclose unexpected database messages or customer data',()=>{
  const error=classifyPosRpcError({code:'23514',message:'private customer 123456789'},'reserve_pos_pelecard');
  expect(error).toMatchObject({status:502,code:'payment_database_unavailable'});
  expect(JSON.stringify(error)).not.toContain('123456789');
});
