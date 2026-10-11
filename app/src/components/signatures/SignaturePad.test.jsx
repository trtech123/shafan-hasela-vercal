// @vitest-environment jsdom
import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import SignaturePad from './SignaturePad';
import {emptySignature,validSignature} from '@/lib/signature';
import VoucherSignaturePad from '../vouchers/SignaturePad';

beforeEach(()=>{
 window.PointerEvent=class extends MouseEvent{constructor(type,props){super(type,props);this.pointerId=props.pointerId;this.pointerType=props.pointerType;}};
 HTMLCanvasElement.prototype.getContext=vi.fn(()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}}));
 HTMLCanvasElement.prototype.setPointerCapture=vi.fn();
});
afterEach(cleanup);
function Form(){const [value,setValue]=useState(emptySignature);return <><SignaturePad value={value} onChange={setValue}/><output data-testid="value">{JSON.stringify(value)}</output></>;}
describe('neutral and HAKAFA pointer signatures',()=>{
 for(const pointerType of ['mouse','touch'])it(`${pointerType} capture, normalized strokes, clear and redraw`,()=>{
  render(<Form/>);const canvas=screen.getByRole('img');canvas.getBoundingClientRect=()=>({left:0,top:0,width:640,height:240});
  const draw=()=>{fireEvent.pointerDown(canvas,{pointerId:1,pointerType,clientX:20,clientY:30});fireEvent.pointerMove(canvas,{pointerId:1,pointerType,clientX:150,clientY:120});fireEvent.pointerUp(canvas,{pointerId:1,pointerType});};
  draw();expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);expect(validSignature(JSON.parse(screen.getByTestId('value').textContent))).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'ניקוי חתימה'}));expect(JSON.parse(screen.getByTestId('value').textContent).strokes).toEqual([]);draw();expect(validSignature(JSON.parse(screen.getByTestId('value').textContent))).toBe(true);
 });
 it('rejects empty, malformed and oversized strokes',()=>{
  expect(validSignature(emptySignature())).toBe(false);
  expect(validSignature({width:1,height:1,strokes:[[null,{x:0,y:1}]]})).toBe(false);
  expect(validSignature({width:1,height:1,strokes:[Array.from({length:513},()=>({x:.1,y:.5}))]})).toBe(false);
 });
 it('preserves the voucher-facing copy and readonly behavior',()=>{
  const {rerender}=render(<VoucherSignaturePad value={emptySignature()} onChange={()=>{}}/>);
  expect(screen.getByText(/החתימה נשמרת עם השובר/)).toBeTruthy();
  rerender(<VoucherSignaturePad value={emptySignature()} onChange={()=>{}} readOnly/>);
  expect(screen.queryByRole('button')).toBeNull();expect(screen.getByRole('img').getAttribute('aria-label')).toBe('חתימת הלקוח השמורה');
 });
});
