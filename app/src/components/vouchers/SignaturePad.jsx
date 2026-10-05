import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { emptySignature } from '@/lib/vouchers';

export default function SignaturePad({ value, onChange, readOnly = false, disabled = false }) {
  const canvas = useRef(null);
  const active = useRef(null);
  const current = useRef(value);
  current.current = value;
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, 640, 240); context.lineWidth = 2; context.strokeStyle = '#0f172a'; context.lineCap = 'round';
    for (const stroke of value?.strokes || []) {
      context.beginPath();
      stroke.forEach((point, index) => context[index ? 'lineTo' : 'moveTo'](point.x * 640, point.y * 240));
      context.stroke();
    }
  }, [value]);
  const point = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const normalize = (value) => Number(Math.max(0, Math.min(1, value)).toFixed(5));
    return { x: normalize((event.clientX - rect.left) / rect.width), y: normalize((event.clientY - rect.top) / rect.height) };
  };
  const change = (strokes) => { const next = { width: 1, height: 1, strokes }; current.current = next; onChange(next); };
  const stop = () => { if (active.current !== null && current.current.strokes.at(-1)?.length < 2) change(current.current.strokes.slice(0, -1)); active.current = null; };
  return <div className="space-y-2">
    <canvas ref={canvas} width={640} height={240} role="img" aria-label={readOnly ? 'חתימת הלקוח השמורה' : 'אזור חתימה באמצעות עכבר או מסך מגע'} className="w-full rounded border bg-white" style={{ touchAction: 'none' }}
      onPointerDown={(event) => { if (readOnly || disabled || active.current !== null || current.current.strokes.length >= 64) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); active.current = event.pointerId; change([...current.current.strokes, [point(event)]]); }}
      onPointerMove={(event) => { if (active.current !== event.pointerId || disabled) return; const strokes = current.current.strokes; if (strokes.at(-1).length >= 512 || strokes.reduce((sum, stroke) => sum + stroke.length, 0) >= 4096) return; change([...strokes.slice(0, -1), [...strokes.at(-1), point(event)]]); }}
      onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} />
    {!readOnly && <><p className="text-sm text-muted-foreground">יש לחתום בעכבר או באצבע. החתימה נשמרת עם השובר.</p><Button type="button" variant="outline" disabled={disabled} onClick={() => { stop(); onChange(emptySignature()); }}>ניקוי חתימה</Button></>}
  </div>;
}
