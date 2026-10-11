import {describe,it,expect} from 'vitest';
import {hashToken,validateSignature,tokenLifetimeDays,secureToken} from '../../server/order-confirmation/contract.js';
describe('signature boundary',()=>{
 it('generates opaque 256-bit tokens and hashes only valid tokens',()=>{const t=secureToken();expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(hashToken(t)).toMatch(/^[a-f0-9]{64}$/);expect(()=>hashToken('short')).toThrow();});
 it('bounds expiry configuration',()=>{expect(tokenLifetimeDays()).toBe(7);expect(tokenLifetimeDays('3')).toBe(3);for(const n of ['0','400','NaN','2.5'])expect(()=>tokenLifetimeDays(n)).toThrow();});
 it('requires fullname acceptance and nontrivial normalized strokes',()=>{const valid={fullName:'ישראל ישראלי',accepted:true,strokes:[[{x:.1,y:.1},{x:.4,y:.4},{x:.6,y:.1}]]};expect(validateSignature(valid).fullName).toBe(valid.fullName);for(const delta of [{fullName:'א'},{accepted:false},{strokes:[]},{strokes:[[{x:0,y:0},{x:0,y:0}]]},{strokes:[[{x:-1,y:0},{x:1,y:1}]]},{fullName:'A\nB'}])expect(()=>validateSignature({...valid,...delta})).toThrow();});
 it('rejects malformed and oversized names, strokes and point collections',()=>{
  const input={fullName:'Synthetic Signer',accepted:true},stroke=[{x:0,y:0},{x:1,y:1}];
  for(const strokes of [[[{x:0,y:0},null]],[Array.from({length:513},(_,i)=>({x:i%2,y:0}))],Array.from({length:65},()=>stroke),Array.from({length:9},()=>Array.from({length:512},(_,i)=>({x:i%2,y:0}))),[[{x:0,y:0},{x:1,y:1,total:123}]]])expect(()=>validateSignature({...input,strokes})).toThrow();
  for(const fullName of ['A '+ 'x'.repeat(120),'A <B>','A\u202e B'])expect(()=>validateSignature({...input,fullName,strokes:[stroke]})).toThrow();
 });
});
