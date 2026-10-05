// Display the newest attempt without letting an older uncertain ancestor hide
// its explicitly confirmed child. Unknown local requests stay blocked until read.
export function latestDeliveryAttempt(history, local, channel) {
 const rows=history.filter(x=>x.channel===channel);
 const ids=new Set(rows.map(x=>x.id));
 if(local && !ids.has(local.id || local.requestId)) return local;
 const parents=new Set(rows.map(x=>x.resend_of).filter(Boolean));
 return rows.find(x=>!parents.has(x.id)) || local || null;
}
export function canManuallyResend(attempt,now=Date.now()) {
 if(!attempt?.id || !['accepted','failed','uncertain','dispatched'].includes(attempt.state))return false;
 if(attempt.state!=='dispatched')return true;
 const started=Date.parse(attempt.dispatched_at || attempt.created_at);
 return Number.isFinite(started) && now-started>=120000;
}
export function reconcileLocalAttempt(rows, previous, channel) {
 if(!previous)return null;
 return rows.find(x=>x.channel===channel && (x.id===(previous.id || previous.requestId) || (previous.resendOf && x.resend_of===previous.resendOf) || (!previous.resendOf&&!previous.id&&!x.resend_of&&previous.version&&x.version===previous.version))) || previous;
}
