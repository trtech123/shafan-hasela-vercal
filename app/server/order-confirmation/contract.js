import {createHash, randomBytes} from 'node:crypto';

export const ACCEPTANCE_VERSION = '1';
export const RENDER_VERSION = '1';
export const ACCEPTANCE_TEXT = 'קראתי את אישור ההזמנה המצורף ואני מאשר/ת את פרטי ההזמנה ואת תנאי ההתקשרות המופיעים בו. חתימה זו מאשרת את ההזמנה בלבד ואינה מחליפה חתימות על הצהרות בטיחות, בריאות או אישור הורים.';
export const BUCKET = 'order-signatures-private';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const secureToken = () => randomBytes(32).toString('base64url');
export function hashToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new SignatureError('link_unavailable',404);
  return sha256(token);
}
export class SignatureError extends Error {
  constructor(message, status=400) { super(message); this.status=status; }
}
export function tokenLifetimeDays(value='7') {
  const days=Number(value);
  if (!Number.isInteger(days) || days<1 || days>30) throw new SignatureError('server_not_configured',503);
  return days;
}
export function validId(value) { return typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value); }
export function validateSignature(input) {
  const fullName=typeof input.fullName==='string' ? input.fullName.trim().normalize('NFC') : '';
  if (fullName.length<3 || fullName.length>120 || /[\p{Cc}\p{Cf}<>]/u.test(fullName) || !/^\p{L}[\p{L}\p{M}'’". -]*\s+\p{L}[\p{L}\p{M}'’". -]*$/u.test(fullName) || input.accepted!==true) throw new SignatureError('invalid_signature');
  const strokes=input.strokes;
  if (!Array.isArray(strokes) || !strokes.length || strokes.length>64) throw new SignatureError('invalid_signature');
  let count=0, distance=0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length<2 || stroke.length>512) throw new SignatureError('invalid_signature');
    count+=stroke.length;
    stroke.forEach((p,i)=>{
      if (!p || Object.keys(p).some(k=>!['x','y'].includes(k)) || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x<0 || p.y<0 || p.x>1 || p.y>1) throw new SignatureError('invalid_signature');
      if(i) distance+=Math.hypot(p.x-stroke[i-1].x,p.y-stroke[i-1].y);
    });
  }
  if(count>4096 || distance<0.03) throw new SignatureError('invalid_signature');
  return {fullName,strokes};
}
export function canonicalJson(value) {
  if(Array.isArray(value)) return '['+value.map(canonicalJson).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
