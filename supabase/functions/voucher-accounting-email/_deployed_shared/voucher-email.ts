export type VoucherForEmail = {
  id: string; created_at: string; snapshot: Record<string, unknown>; signature?: unknown;
};
type Claim = { claimed: boolean; status?: string; voucher?: VoucherForEmail };
type Message = { to: string; subject: string; text: string };
export type VoucherEmailDependencies = {
  claim: (voucherId: string, requestId: string, actorId: string, recipient: string) => Promise<Claim>;
  finish: (requestId: string, status: 'accepted' | 'uncertain', messageId: string | null) => Promise<void>;
  send: (message: Message) => Promise<{ messageId?: string }>;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function validAccountingRecipient(value: string): boolean {
  return value.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
}
export function voucherEmailText(v: VoucherForEmail): string {
  const s = v.snapshot;
  const value = (key: string) => typeof s[key] === 'string' ? String(s[key]) : '';
  return [
    'שובר שירות ללא תשלום — לטיפול ידני בהנהלת חשבונות.',
    'משלוח זה אינו אישור תשלום ואינו אישור להפקת מסמך חשבונאי.',
    `מזהה שובר: ${v.id}`, `נוצר: ${v.created_at}`, `הזמנה: ${value('order_number')}`,
    `קופה: ${value('register_name')} (${value('register_code')})`, `שם לחיוב: ${value('billing_name')}`,
    `ח.פ / ע.מ: ${value('billing_company_id')}`, `איש קשר: ${value('contact_name')}`,
    `טלפון: ${value('phone')}`, `שירות: ${value('service_description')}`,
    `הערות: ${value('notes')}`, `נוצר על ידי: ${value('creator_name')} (${value('created_by')})`, `תפקיד יוצר: ${value('creator_role')}`,
    `מע״מ: ${s.vat_applicable === true ? 'חל' : s.vat_applicable === false ? 'לא חל' : 'טרם נבדק'}`,
    'החתימה והנתונים ההיסטוריים המלאים שמורים ברשומת השובר בשפן הסלע.',
    `צפייה בשובר החתום (נדרשת התחברות): https://shafan-hasela-vercal.vercel.app/vouchers?voucherId=${encodeURIComponent(v.id)}`,
  ].join('\n');
}

// A durable claim precedes SMTP. No automatic retry, including after ambiguous
// SMTP or database failures. An accepted email is never accounting completion.
export async function sendVoucherEmail(
  body: Record<string, unknown>, actorId: string, recipient: string, deps: VoucherEmailDependencies,
): Promise<{ status: string; sentNow: boolean }> {
  if (!validAccountingRecipient(recipient)) {
    throw new Error('accounting_recipient_not_configured');
  }
  if (Object.keys(body).some(k => !['voucherId', 'requestId'].includes(k)) ||
    typeof body.voucherId !== 'string' || !uuid.test(body.voucherId) ||
    typeof body.requestId !== 'string' || !uuid.test(body.requestId)) throw new Error('invalid_email_request');
  const claim = await deps.claim(body.voucherId, body.requestId, actorId, recipient);
  if (!claim.claimed) return { status: claim.status || 'uncertain', sentNow: false };
  if (!claim.voucher || claim.voucher.id !== body.voucherId) throw new Error('invalid_email_claim');
  try {
    const result = await deps.send({ to: recipient, subject: `שובר לטיפול חשבונאי ${claim.voucher.id}`,
      text: voucherEmailText(claim.voucher) });
    const messageId = typeof result.messageId === 'string' && result.messageId.length <= 300 ? result.messageId : null;
    await deps.finish(body.requestId, 'accepted', messageId);
    return { status: 'accepted', sentNow: true };
  } catch {
    try { await deps.finish(body.requestId, 'uncertain', null); } catch { /* Durable dispatch claim remains; never resend. */ }
    return { status: 'uncertain', sentNow: false };
  }
}
