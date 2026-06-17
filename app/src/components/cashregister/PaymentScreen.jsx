import { useState } from "react";
import { ArrowRight, CreditCard, Banknote, Smartphone, Building2, Receipt, FileText, Split, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const PAYMENT_METHODS = [
  { key: "מזומן",       label: "מזומן",         icon: Banknote,     color: "from-emerald-600 to-emerald-700", hint: "קבל מזומן וסמן ידנית" },
  { key: "אשראי",      label: "אשראי",          icon: CreditCard,   color: "from-blue-600 to-blue-700",     hint: "סלק דרך מסוף האשראי" },
  { key: "צ'ק",        label: "צ'ק",            icon: FileText,     color: "from-rose-600 to-rose-700",      hint: "הזנה ידנית של פרטי הצ'ק" },
  { key: "העברה",      label: "העברה בנקאית",  icon: Building2,    color: "from-purple-600 to-purple-700",  hint: "העברה / ביט / פייבוקס" },
  { key: "אפליקציה",   label: "ביט / Paybox",   icon: Smartphone,   color: "from-orange-600 to-orange-700", hint: "סלק דרך אפליקציה" },
  { key: "חשבונית",   label: "חשבונית / חח״ד", icon: Receipt,      color: "from-slate-600 to-slate-700",   hint: "חיוב מאוחר / ארגון" },
];

const CHECK_METHOD = "צ'ק";
const SPLIT_METHOD = "מפוצל"; // sale.method marker for split payments
const SPLIT_LINE_METHODS = ["מזומן", "אשראי", "צ'ק"];

const emptyCheck = {
  check_number: "",
  bank: "",
  branch: "",
  account_number: "",
  account_holder: "",
  due_date: "",
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

export default function PaymentScreen({ total, cartItems, onConfirm, onBack }) {
  // null = method grid; CHECK_METHOD = single-check form; SPLIT_METHOD = split builder.
  const [detailFor, setDetailFor] = useState(null);
  const [check, setCheck] = useState({ ...emptyCheck, amount: String(total) });
  // Split builder: starts with the full total on a single cash line.
  const [lines, setLines] = useState([makeLine("מזומן", total)]);

  const handleMethodClick = (key) => {
    if (key === CHECK_METHOD) {
      setCheck({ ...emptyCheck, amount: String(total) });
      setDetailFor(CHECK_METHOD);
      return;
    }
    onConfirm(key);
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
    // Minimal validation — a check needs at least a number and an amount.
    if (!check.check_number.trim()) return;
    const details = {
      ...check,
      check_number: check.check_number.trim(),
      bank: check.bank.trim(),
      branch: check.branch.trim(),
      account_number: check.account_number.trim(),
      account_holder: check.account_holder.trim(),
      notes: check.notes.trim(),
      amount: Number(check.amount) || total,
    };
    onConfirm(CHECK_METHOD, details);
  };

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
            {lines.map((l, idx) => (
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
            disabled={!splitValid}
            className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-2xl"
          >
            אשר תשלום מפוצל
          </Button>
        </div>
      </div>
    );
  }

  if (detailFor === CHECK_METHOD) {
    const set = (k) => (e) => setCheck((c) => ({ ...c, [k]: e.target.value }));
    const valid = check.check_number.trim().length > 0;
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
            <div />
            <div className="col-span-2">
              <Field label="הערות">
                <input className={inputCls} value={check.notes} onChange={set("notes")} />
              </Field>
            </div>
          </div>

          <Button
            onClick={submitCheck}
            disabled={!valid}
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
      <div className="w-full max-w-lg space-y-8">

        <div className="text-center">
          <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm mb-6 mx-auto">
            <ArrowRight className="w-4 h-4" /> חזור לתפריט
          </button>
          <p className="text-slate-400 text-sm mb-1">סכום לתשלום</p>
          <p className="text-6xl font-bold text-emerald-300">{total.toLocaleString()}₪</p>
          <p className="text-slate-500 text-sm mt-2">{cartItems.length} פריטים</p>
        </div>

        <div className="space-y-2">
          <p className="text-slate-400 text-sm font-medium text-center mb-4">בחר אמצעי תשלום</p>
          {PAYMENT_METHODS.map(method => {
            const Icon = method.icon;
            return (
              <button
                key={method.key}
                onClick={() => handleMethodClick(method.key)}
                className={`w-full bg-gradient-to-l ${method.color} rounded-2xl p-5 flex items-center gap-4 hover:opacity-90 active:scale-[0.98] transition-all text-right`}
              >
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-lg">{method.label}</p>
                  <p className="text-white/60 text-sm">{method.hint}</p>
                </div>
                <div className="mr-auto text-white/40 text-2xl">←</div>
              </button>
            );
          })}

          {/* Split payment entry */}
          <button
            onClick={enterSplit}
            className="w-full mt-2 border border-dashed border-slate-600 rounded-2xl p-4 flex items-center gap-4 hover:bg-slate-800 active:scale-[0.98] transition-all text-right"
          >
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
              <Split className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="font-bold text-lg">תשלום מפוצל</p>
              <p className="text-white/60 text-sm">חלק את התשלום בין כמה אמצעים</p>
            </div>
            <div className="mr-auto text-white/40 text-2xl">←</div>
          </button>
        </div>
      </div>
    </div>
  );
}
