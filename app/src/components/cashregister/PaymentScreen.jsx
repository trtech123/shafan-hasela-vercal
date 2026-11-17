import { useState } from "react";
import { ArrowRight, CreditCard, Banknote, Smartphone, Building2, Receipt, FileText, Split, Plus, Trash2, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import PhysicalTerminalStatus from './PhysicalTerminalStatus.jsx';
import { billingReviewIssues } from '@/payments/payperBilling';

const PAYMENT_METHODS = [
  { key: "מזומן",       label: "מזומן",         icon: Banknote,     color: "from-emerald-600 to-emerald-700", hint: "קבל מזומן וסמן ידנית" },
  { key: "אשראי",      label: "אשראי — חיצוני",  icon: CreditCard,   color: "from-blue-600 to-blue-700",     hint: "תשלום ידני שכבר בוצע במסוף חיצוני" },
  { key: "צ'ק",        label: "צ'ק",            icon: FileText,     color: "from-rose-600 to-rose-700",      hint: "הזנה ידנית של פרטי הצ'ק" },
  { key: "העברה",      label: "העברה בנקאית",  icon: Building2,    color: "from-purple-600 to-purple-700",  hint: "העברה / ביט / פייבוקס" },
  { key: "אפליקציה",   label: "ביט / Paybox",   icon: Smartphone,   color: "from-orange-600 to-orange-700", hint: "סלק דרך אפליקציה" },
  { key: "חשבונית",   label: "חשבונית / חח״ד", icon: Receipt,      color: "from-slate-600 to-slate-700",   hint: "חיוב מאוחר / ארגון" },
];

const CHECK_METHOD = "צ'ק";
const CASH_METHOD = "מזומן";
const SPLIT_METHOD = "מפוצל"; // sale.method marker for split payments
const SPLIT_LINE_METHODS = ["מזומן", "אשראי", "צ'ק"];

const emptyCheck = {
  check_number: "",
  bank: "",
  branch: "",
  account_number: "",
  account_holder: "",
  due_date: "",
  received_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
  amount: "",
  notes: "",
};

// Dark-themed labeled field for the check form (matches the POS screen).
function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-slate-400 text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500";

// Build a fresh split line. id only for React keys (Math.random fine in app code).
const makeLine = (method, amount) => ({
  id: Math.random().toString(36).slice(2),
  method,
  amount: amount != null ? String(amount) : "",
  ...emptyCheck,
});

export default function PaymentScreen({
  total,
  cartItems,
  onConfirm,
  onPelecard = (_billing) => {},
  onPhysicalTerminal = (_billing) => {},
  physicalTerminalVisible = false,
  physicalTerminalEnabled = false,
  physicalTerminalSelectable = physicalTerminalEnabled,
  physicalTerminalBusy = false,
  physicalTerminalState = null,
  physicalDeviceName = '',
  onPhysicalStatusCheck = () => {},
  onBack,
  pelecardBusy = false,
  paymentError = '',
  pelecardEnabled = false,
  pelecardHint,
  manualSaleSaving = false,
  noncardEnabled = { cash: false, check: false },
}) {
  // null = method grid; CHECK_METHOD = single-check form; SPLIT_METHOD = split builder.
  const [detailFor, setDetailFor] = useState(null);
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [physicalBillingOpen, setPhysicalBillingOpen] = useState(false);
  const [digitalBillingOpen, setDigitalBillingOpen] = useState(false);
  const [check, setCheck] = useState({ ...emptyCheck, amount: String(total) });
  const [checkBilling, setCheckBilling] = useState({ kind: 'person', name: '', identity: '', email: '' });
  const [cashReceived, setCashReceived] = useState(String(total));
  const selectedUnavailable = (selectedMethod === CASH_METHOD && !noncardEnabled.cash) ||
    (selectedMethod === CHECK_METHOD && !noncardEnabled.check) ||
    (selectedMethod === SPLIT_METHOD && !noncardEnabled.cash) ||
    (selectedMethod === 'physical' && !physicalTerminalEnabled);
  // Split builder: starts with the full total on a single cash line.
  const [lines, setLines] = useState([makeLine("מזומן", total)]);

  const handleMethodClick = (key) => {
    if (key === CASH_METHOD) {
      setCashReceived(String(total));
      setDetailFor(CASH_METHOD);
      return;
    }
    if (key === CHECK_METHOD) {
      setCheck({ ...emptyCheck, amount: String(total) });
      setDetailFor(CHECK_METHOD);
      return;
    }
    onConfirm(key);
  };

  const paySelected = () => {
    if (selectedMethod === 'digital') {
      if (billingReviewIssues(checkBilling).length) return setDigitalBillingOpen(true);
      return onPelecard(checkBilling);
    }
    if (selectedMethod === 'physical') {
      if (!physicalTerminalEnabled) return;
      if (billingReviewIssues(checkBilling).length) return setPhysicalBillingOpen(true);
      return onPhysicalTerminal(checkBilling);
    }
    if (selectedMethod === SPLIT_METHOD) return enterSplit();
    if (selectedMethod === CASH_METHOD && !noncardEnabled.cash) return;
    if (selectedMethod === CHECK_METHOD && !noncardEnabled.check) return;
    if (selectedMethod) return handleMethodClick(selectedMethod);
  };

  const enterSplit = () => {
    setLines([makeLine("מזומן", total)]);
    setDetailFor(SPLIT_METHOD);
  };

  const splitSum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const splitRemaining = Math.round((total - splitSum) * 100) / 100;
  const checkLinesValid = lines
    .filter((l) => l.method === CHECK_METHOD)
    .every((l) => l.check_number.trim().length > 0);
  const splitValid =
    lines.length >= 2 &&
    lines.every((l) => (Number(l.amount) || 0) > 0) &&
    Math.abs(splitRemaining) < 0.01 &&
    checkLinesValid;

  const setLine = (id, patch) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => [...ls, makeLine("מזומן", splitRemaining > 0 ? splitRemaining : "")]);
  const removeLine = (id) => setLines((ls) => ls.filter((l) => l.id !== id));

  const submitSplit = () => {
    if (!splitValid) return;
    const payLines = lines.map((l) => {
      const base = { method: l.method, amount: Number(l.amount) };
      if (l.method === CHECK_METHOD) {
        return {
          ...base,
          check_number: l.check_number.trim(),
          bank: l.bank.trim(),
          branch: l.branch.trim(),
          account_number: l.account_number.trim(),
          account_holder: l.account_holder.trim(),
          due_date: l.due_date,
          notes: l.notes.trim(),
        };
      }
      return base;
    });
    onConfirm(SPLIT_METHOD, { lines: payLines });
  };

  const submitCheck = () => {
    if (!/^\d{1,20}$/.test(check.check_number) || !check.bank.trim() ||
      !/^\d{1,8}$/.test(check.branch) || !/^\d{1,20}$/.test(check.account_number) ||
      !check.account_holder.trim() || !check.received_date || !check.due_date ||
      check.due_date < check.received_date || Number(check.amount) !== total ||
      billingReviewIssues(checkBilling).length > 0) return;
    const details = {
      ...check,
      check_number: check.check_number.trim(),
      bank: check.bank.trim(),
      branch: check.branch.trim(),
      account_number: check.account_number.trim(),
      account_holder: check.account_holder.trim(),
      notes: check.notes.trim(),
      amount: Number(check.amount),
      billing: checkBilling,
      document_type: 'invoice-receipt',
      reference_document_id: null,
    };
    onConfirm(CHECK_METHOD, details);
  };

  const submitCash = () => {
    if (billingReviewIssues(checkBilling).length > 0 ||
      !Number.isFinite(Number(cashReceived)) || Math.round(Number(cashReceived) * 100) < Math.round(total * 100)) return;
    onConfirm(CASH_METHOD, { billing: checkBilling, document_type: 'invoice-receipt', reference_document_id: null });
  };

  if (physicalTerminalState) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <PhysicalTerminalStatus state={physicalTerminalState} deviceName={physicalDeviceName}
        amount={total} onCheckStatus={onPhysicalStatusCheck} onBack={onBack} />
    </div>;
  }

  if (detailFor === SPLIT_METHOD) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6" dir="rtl">
        <div className="w-full max-w-lg space-y-5">
          <div className="text-center">
            <button onClick={() => setDetailFor(null)} className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm mb-4 mx-auto">
              <ArrowRight className="w-4 h-4" /> חזור לאמצעי תשלום
            </button>
            <p className="text-slate-400 text-sm mb-1">תשלום מפוצל — סה״כ</p>
            <p className="text-4xl font-bold text-emerald-300">{total.toLocaleString()}₪</p>
          </div>

          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            {lines.map((l) => (
              <div key={l.id} className="bg-slate-800/60 border border-slate-700 rounded-2xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    className={inputCls + " flex-1"}
                    value={l.method}
                    onChange={(e) => setLine(l.id, { method: e.target.value })}
                  >
                    {SPLIT_LINE_METHODS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <input
                    className={inputCls + " w-28"}
                    value={l.amount}
                    onChange={(e) => setLine(l.id, { amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="סכום ₪"
                  />
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(l.id)} className="text-slate-400 hover:text-rose-400 p-2" title="הסר שורה">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {l.method === CHECK_METHOD && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <input className={inputCls} value={l.check_number} onChange={(e) => setLine(l.id, { check_number: e.target.value })} placeholder="מספר צ'ק *" inputMode="numeric" />
                    <input className={inputCls} value={l.bank} onChange={(e) => setLine(l.id, { bank: e.target.value })} placeholder="בנק" />
                    <input className={inputCls} value={l.branch} onChange={(e) => setLine(l.id, { branch: e.target.value })} placeholder="סניף" inputMode="numeric" />
                    <input className={inputCls} value={l.account_number} onChange={(e) => setLine(l.id, { account_number: e.target.value })} placeholder="מספר חשבון" inputMode="numeric" />
                    <input className={inputCls} value={l.account_holder} onChange={(e) => setLine(l.id, { account_holder: e.target.value })} placeholder="בעל החשבון" />
                    <input className={inputCls} type="date" value={l.due_date} onChange={(e) => setLine(l.id, { due_date: e.target.value })} />
                    <input className={inputCls + " col-span-2"} value={l.notes} onChange={(e) => setLine(l.id, { notes: e.target.value })} placeholder="הערות" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <button onClick={addLine} className="w-full flex items-center justify-center gap-2 text-sm text-slate-300 border border-dashed border-slate-600 rounded-xl py-2.5 hover:bg-slate-800">
            <Plus className="w-4 h-4" /> הוסף אמצעי תשלום
          </button>

          <div className="flex items-center justify-between text-sm bg-slate-800/60 rounded-xl px-4 py-2">
            <span className="text-slate-400">שולם: <span className="text-white font-semibold">{splitSum.toLocaleString()}₪</span></span>
            <span className={Math.abs(splitRemaining) < 0.01 ? "text-emerald-300" : "text-amber-300"}>
              {splitRemaining > 0 ? `נותר: ${splitRemaining.toLocaleString()}₪` : splitRemaining < 0 ? `עודף: ${Math.abs(splitRemaining).toLocaleString()}₪` : "מאוזן ✓"}
            </span>
          </div>

          <Button
            onClick={submitSplit}
            disabled={!splitValid || manualSaleSaving}
            className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-2xl"
          >
            אשר תשלום מפוצל
          </Button>
        </div>
      </div>
    );
  }

  const cashDialog = <Dialog open={detailFor === CASH_METHOD} onOpenChange={open => { if (!open) setDetailFor(null); }}>
    <DialogContent dir="rtl" aria-describedby="cash-receipt-help" className="max-h-[90vh] overflow-y-auto bg-slate-900 text-white">
        <DialogTitle>אישור קבלת מזומן</DialogTitle>
        <p id="cash-receipt-help">סכום: {total.toFixed(2)} ₪ · לאחר הקבלה תתבקש חשבונית מס/קבלה מ־Payper.</p>
        <Field label="מזומן שהתקבל (₪)"><input className={inputCls} type="number" min={total} step="0.01" value={cashReceived} onChange={e => setCashReceived(e.target.value)} /></Field>
        {Number(cashReceived) >= total && <p>עודף: {((Math.round(Number(cashReceived) * 100) - Math.round(total * 100)) / 100).toFixed(2)} ₪</p>}
        <Field label="סוג לקוח"><select className={inputCls} value={checkBilling.kind} onChange={e => setCheckBilling({ ...checkBilling, kind: e.target.value })}><option value="person">יחיד</option><option value="organization">ארגון</option></select></Field>
        <Field label="שם לחיוב"><input className={inputCls} autoComplete="off" value={checkBilling.name} onChange={e => setCheckBilling({ ...checkBilling, name: e.target.value })} /></Field>
        <Field label="מספר זהות / חברה"><input className={inputCls} autoComplete="off" inputMode="numeric" value={checkBilling.identity} onChange={e => setCheckBilling({ ...checkBilling, identity: e.target.value })} /></Field>
        <Field label="דוא״ל למסמך"><input className={inputCls} autoComplete="off" type="email" value={checkBilling.email} onChange={e => setCheckBilling({ ...checkBilling, email: e.target.value })} /></Field>
        <Button onClick={submitCash} disabled={manualSaleSaving || billingReviewIssues(checkBilling).length > 0 ||
          !Number.isFinite(Number(cashReceived)) || Math.round(Number(cashReceived) * 100) < Math.round(total * 100)}>אשר קבלת מזומן</Button>
    </DialogContent>
  </Dialog>;
  const physicalBillingDialog = <Dialog open={physicalBillingOpen} onOpenChange={setPhysicalBillingOpen}>
    <DialogContent dir="rtl" aria-describedby="physical-billing-help" className="max-h-[90vh] overflow-y-auto bg-slate-900 text-white">
      <DialogTitle>פרטי חיוב למסופון</DialogTitle>
      <p id="physical-billing-help">פלאקארד ו־Payper דורשים פרטי חיוב מאומתים למסמך הרשמי. השלימו רק את החסר.</p>
      <Field label="סוג לקוח"><select className={inputCls} value={checkBilling.kind} onChange={e => setCheckBilling({ ...checkBilling, kind: e.target.value })}><option value="person">יחיד</option><option value="organization">ארגון</option></select></Field>
      <Field label="שם לחיוב"><input className={inputCls} autoComplete="off" value={checkBilling.name} onChange={e => setCheckBilling({ ...checkBilling, name: e.target.value })} /></Field>
      <Field label="מספר זהות / חברה"><input className={inputCls} autoComplete="off" inputMode="numeric" value={checkBilling.identity} onChange={e => setCheckBilling({ ...checkBilling, identity: e.target.value })} /></Field>
      <Field label="דוא״ל למסמך"><input className={inputCls} autoComplete="off" type="email" value={checkBilling.email} onChange={e => setCheckBilling({ ...checkBilling, email: e.target.value })} /></Field>
      <Button disabled={physicalTerminalBusy || billingReviewIssues(checkBilling).length > 0} onClick={() => {
        setPhysicalBillingOpen(false); onPhysicalTerminal(checkBilling);
      }}>המשך למסופון</Button>
    </DialogContent>
  </Dialog>;
  const digitalBillingDialog = <Dialog open={digitalBillingOpen} onOpenChange={setDigitalBillingOpen}>
    <DialogContent dir="rtl" aria-describedby="digital-billing-help" className="max-h-[90vh] overflow-y-auto bg-slate-900 text-white">
      <DialogTitle>פרטי חיוב לתשלום דיגיטלי</DialogTitle>
      <p id="digital-billing-help">למסמך הרשמי נדרשים פרטי חיוב מאומתים. השלימו את הפרטים לפני המעבר לפלאקארד.</p>
      <Field label="סוג לקוח"><select className={inputCls} value={checkBilling.kind} onChange={e => setCheckBilling({ ...checkBilling, kind: e.target.value })}><option value="person">יחיד</option><option value="organization">ארגון</option></select></Field>
      <Field label="שם לחיוב"><input className={inputCls} autoComplete="off" value={checkBilling.name} onChange={e => setCheckBilling({ ...checkBilling, name: e.target.value })} /></Field>
      <Field label="מספר זהות / חברה"><input className={inputCls} autoComplete="off" inputMode="numeric" value={checkBilling.identity} onChange={e => setCheckBilling({ ...checkBilling, identity: e.target.value })} /></Field>
      <Field label="דוא״ל למסמך"><input className={inputCls} autoComplete="off" type="email" value={checkBilling.email} onChange={e => setCheckBilling({ ...checkBilling, email: e.target.value })} /></Field>
      <Button disabled={pelecardBusy || billingReviewIssues(checkBilling).length > 0} onClick={() => {
        setDigitalBillingOpen(false); onPelecard(checkBilling);
      }}>המשך לפלאקארד</Button>
    </DialogContent>
  </Dialog>;

  if (detailFor === CHECK_METHOD) {
    const set = (k) => (e) => setCheck((c) => ({ ...c, [k]: e.target.value }));
    const valid = /^\d{1,20}$/.test(check.check_number) && check.bank.trim() &&
      /^\d{1,8}$/.test(check.branch) && /^\d{1,20}$/.test(check.account_number) &&
      check.account_holder.trim() && check.received_date && check.due_date &&
      check.due_date >= check.received_date && Number(check.amount) === total &&
      billingReviewIssues(checkBilling).length === 0;
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6" dir="rtl">
        <div className="w-full max-w-lg space-y-6">
          <div className="text-center">
            <button onClick={() => setDetailFor(null)} className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm mb-4 mx-auto">
              <ArrowRight className="w-4 h-4" /> חזור לאמצעי תשלום
            </button>
            <p className="text-slate-400 text-sm mb-1">תשלום בצ'ק — סכום</p>
            <p className="text-4xl font-bold text-rose-300">{total.toLocaleString()}₪</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="סוג לקוח"><select className={inputCls} value={checkBilling.kind} onChange={e => setCheckBilling({ ...checkBilling, kind: e.target.value })}><option value="person">יחיד</option><option value="organization">ארגון</option></select></Field>
            <Field label="מספר צ'ק *">
              <input className={inputCls} value={check.check_number} onChange={set("check_number")} inputMode="numeric" />
            </Field>
            <Field label="סכום (₪)">
              <input className={inputCls} value={check.amount} onChange={set("amount")} inputMode="decimal" />
            </Field>
            <Field label="בנק">
              <input className={inputCls} value={check.bank} onChange={set("bank")} />
            </Field>
            <Field label="סניף">
              <input className={inputCls} value={check.branch} onChange={set("branch")} inputMode="numeric" />
            </Field>
            <Field label="מספר חשבון">
              <input className={inputCls} value={check.account_number} onChange={set("account_number")} inputMode="numeric" />
            </Field>
            <Field label="בעל החשבון">
              <input className={inputCls} value={check.account_holder} onChange={set("account_holder")} />
            </Field>
            <Field label="תאריך פירעון">
              <input className={inputCls} type="date" value={check.due_date} onChange={set("due_date")} />
            </Field>
            <Field label="תאריך קבלת הצ'ק">
              <input className={inputCls} type="date" value={check.received_date} onChange={set("received_date")} />
            </Field>
            <div />
            <div className="col-span-2">
              <Field label="הערות">
                <input className={inputCls} value={check.notes} onChange={set("notes")} />
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <p className="col-span-2 text-sm">לאחר קבלת ההמחאה תתבקש חשבונית מס/קבלה מ־Payper.</p>
            <Field label="שם לחיוב"><input className={inputCls} value={checkBilling.name} onChange={e => setCheckBilling({ ...checkBilling, name: e.target.value })} /></Field>
            <Field label="מספר זהות / חברה"><input className={inputCls} inputMode="numeric" value={checkBilling.identity} onChange={e => setCheckBilling({ ...checkBilling, identity: e.target.value })} /></Field>
            <Field label="דוא״ל למסמך"><input className={inputCls} type="email" value={checkBilling.email} onChange={e => setCheckBilling({ ...checkBilling, email: e.target.value })} /></Field>
          </div>

          <Button
            onClick={submitCheck}
            disabled={!valid || manualSaleSaving}
            className="w-full h-14 text-lg font-bold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-2xl"
          >
            אשר תשלום בצ'ק
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6" dir="rtl">
      {cashDialog}
      {physicalBillingDialog}
      {digitalBillingDialog}
      <div className="w-full max-w-lg space-y-8">

        <div className="text-center">
          <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm mb-6 mx-auto">
            <ArrowRight className="w-4 h-4" /> חזור לתפריט
          </button>
          <p className="text-slate-400 text-sm mb-1">סכום לתשלום</p>
          <p className="text-6xl font-bold text-emerald-300">{total.toLocaleString()}₪</p>
          <ul className="mt-3 text-sm text-slate-300 text-right" aria-label="פריטים לתשלום">
            {cartItems.map((item, index) => <li key={`${item.id}-${index}`}>{item.name} × {item.qty}</li>)}
          </ul>
        </div>

        <div className="space-y-2">
          <p className="text-slate-400 text-sm font-medium text-center mb-4">בחר אמצעי תשלום</p>
          {paymentError && <p role="alert" className="rounded-xl border border-rose-400 bg-rose-950 p-3 text-sm text-rose-100">{paymentError}</p>}
          <button
            onClick={() => setSelectedMethod('digital')}
            aria-pressed={selectedMethod === 'digital'}
            disabled={pelecardBusy || !pelecardEnabled}
            className={`w-full bg-gradient-to-l from-cyan-600 to-sky-700 rounded-2xl p-5 flex items-center gap-4 hover:opacity-90 active:scale-[0.98] transition-all text-right disabled:opacity-60 disabled:cursor-wait ${selectedMethod === 'digital' ? 'ring-4 ring-white' : ''}`}
          >
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              {pelecardBusy
                ? <Loader2 className="w-6 h-6 text-white animate-spin" />
                : <ShieldCheck className="w-6 h-6 text-white" />}
            </div>
            <div>
              <p className="font-bold text-lg">פלאקארד — תשלום מאומת</p>
              <p className="text-white/70 text-sm">{pelecardHint || (pelecardEnabled ? 'מעבר לתשלום המאובטח' : 'תשלום פלאקארד אינו זמין לסל זה')}</p>
            </div>
            <div className="mr-auto text-white/40 text-2xl">←</div>
          </button>
          {physicalTerminalVisible && (
            <button type="button" onClick={() => setSelectedMethod('physical')}
              aria-pressed={selectedMethod === 'physical'}
              disabled={!physicalTerminalSelectable || pelecardBusy || manualSaleSaving}
              className={`w-full bg-gradient-to-l from-indigo-600 to-indigo-700 rounded-2xl p-5 flex items-center gap-4 text-right disabled:opacity-60 disabled:cursor-not-allowed ${selectedMethod === 'physical' ? 'ring-4 ring-white' : ''}`}>
              <CreditCard className="w-8 h-8 text-white" />
              <span><strong className="block text-lg">תשלום במסופון פיזי</strong>
                <small className="text-white/70">{physicalTerminalEnabled ? 'הסכום נשלח אוטומטית למסופון המשויך לקופה' :
                  physicalTerminalSelectable ? 'תשלום במסופון ממתין להפעלה מבוקרת' : 'תשלום במסופון מושבת עד לאימות מסלול פלאקארד והפעלתו'}</small></span>
            </button>
          )}
          {PAYMENT_METHODS.map(method => {
            const Icon = method.icon;
            const disabled = (method.key === CASH_METHOD && !noncardEnabled.cash) ||
              (method.key === CHECK_METHOD && !noncardEnabled.check);
            return (
              <button
                key={method.key}
                onClick={() => setSelectedMethod(method.key)}
                aria-pressed={selectedMethod === method.key}
                disabled={manualSaleSaving || disabled}
                className={`w-full bg-gradient-to-l ${method.color} rounded-2xl p-5 flex items-center gap-4 hover:opacity-90 active:scale-[0.98] transition-all text-right ${selectedMethod === method.key ? 'ring-4 ring-white' : ''}`}
              >
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-lg">{method.label}</p>
                  <p className="text-white/60 text-sm">{disabled ? method.key === CHECK_METHOD
                    ? 'תשלום בצ׳ק עדיין לא פעיל: ממתין לאישור פרטי ההמחאה על ידי הספק'
                    : 'אמצעי תשלום זה עדיין לא פעיל בקופה' : method.hint}</p>
                </div>
                <div className="mr-auto text-white/40 text-2xl">←</div>
              </button>
            );
          })}

          {/* Split payment entry */}
          <button
            onClick={() => setSelectedMethod(SPLIT_METHOD)}
            aria-pressed={selectedMethod === SPLIT_METHOD}
            disabled={manualSaleSaving || !noncardEnabled.cash}
            className={`w-full mt-2 border border-dashed border-slate-600 rounded-2xl p-4 flex items-center gap-4 hover:bg-slate-800 active:scale-[0.98] transition-all text-right ${selectedMethod === SPLIT_METHOD ? 'ring-4 ring-white' : ''}`}
          >
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
              <Split className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="font-bold text-lg">תשלום מפוצל</p>
              <p className="text-white/60 text-sm">{noncardEnabled.cash ? 'חלק את התשלום בין כמה אמצעים' : 'תשלום מפוצל עדיין לא פעיל בקופה'}</p>
            </div>
            <div className="mr-auto text-white/40 text-2xl">←</div>
          </button>
          <Button onClick={paySelected} disabled={!selectedMethod || selectedUnavailable || pelecardBusy || manualSaleSaving || physicalTerminalBusy}
            className="w-full h-14 text-lg font-bold" data-testid="cashier-pay">
            {pelecardBusy || manualSaleSaving ? 'מעבד תשלום…' : 'שלם'}
          </Button>
        </div>
      </div>
    </div>
  );
}
