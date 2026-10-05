export const TIME_ZONE = 'Asia/Jerusalem';
const invalid = () => { throw Error('invalid_request'); };
const formatter = new Intl.DateTimeFormat('en-GB', {timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});

// The provider uses Israel wall time without an offset. Never guess at a DST fold.
export function localTime(value) {
 const m = /^(20\d{2})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value ?? '');
 if (!m) return null;
 const [,y,mo,d,h,mi,s='00'] = m;
 const wall = Date.UTC(+y,+mo-1,+d,+h,+mi,+s);
 const local = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
 if (new Date(wall).toISOString().slice(0,19) !== local) return null;
 const candidates = [120,180].map(offset => wall-offset*60000).filter(t => {
  const p = Object.fromEntries(formatter.formatToParts(t).map(v => [v.type,v.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` === local;
 });
 return {local,wall,instant:candidates.length===1?new Date(candidates[0]).toISOString():null};
}

export function validateInput(body, now=Date.now()) {
 if (!body || typeof body!=='object' || Array.isArray(body)) return invalid();
 if (body.action==='lookup') {
  if(Object.keys(body).sort().join(',')!=='action,transactionId' || typeof body.transactionId!=='string' || !/^[1-9]\d{0,14}$/.test(body.transactionId)) return invalid();
  return {action:'lookup',transactionId:body.transactionId};
 }
 if(body.action!=='range' || Object.keys(body).sort().join(',')!=='action,end,start') return invalid();
 if(![body.start,body.end].every(v=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v))) return invalid();
 const start=localTime(body.start),end=localTime(body.end);
 if(!start?.instant || !end?.instant || start.wall>end.wall || end.wall-start.wall>31*86400000 || Date.parse(end.instant)>now+60000) return invalid();
 const provider=v=>`${v.slice(8,10)}/${v.slice(5,7)}/${v.slice(0,4)} ${v.slice(11,16)}`;
 return {action:'range',start:body.start,end:body.end,startDate:provider(body.start),endDate:provider(body.end)};
}
