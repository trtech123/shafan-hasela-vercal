import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpLeft,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CreditCard,
  FileCheck2,
  Landmark,
  Loader2,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import ImmediateAccountingPanel from "@/components/accounting/ImmediateAccountingPanel";

const OPERATION_COLUMNS = [
  "event_id", "source_type", "source_id", "purpose", "accounting_provider",
  "payment_transaction_id", "provider_transaction_id", "order_id", "order_number",
  "sale_id", "local_receipt_number", "amount", "currency", "payment_status",
  "payment_succeeded_at", "accounting_status", "accounting_document_id",
  "accounting_document_status", "external_document_number", "document_url",
  "attempt_count", "last_attempt_at", "last_error", "next_attempt_at",
  "reconciliation_required", "retry_allowed", "created_at", "updated_at",
].join(",");

const ACCOUNTING_STATUS = {
  pending: { label: "ממתין להנה״ח", tone: "amber" },
  processing: { label: "בעיבוד", tone: "blue" },
  succeeded: { label: "הושלם", tone: "green" },
  retryable_error: { label: "שגיאה זמנית", tone: "amber" },
  permanent_error: { label: "שגיאה קבועה", tone: "red" },
  reconciliation_required: { label: "נדרשת התאמה ידנית", tone: "red" },
  configuration_required: { label: "נדרשת הפעלה והגדרה", tone: "slate" },
};

const TONE_CLASSES = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  blue: "border-sky-200 bg-sky-50 text-sky-800",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  red: "border-rose-200 bg-rose-50 text-rose-800",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
};

function statusMeta(status) {
  return ACCOUNTING_STATUS[status] ?? { label: "מצב לא ידוע", tone: "slate" };
}

function StatusPill({ status }) {
  const meta = statusMeta(status);
  return (
    <span className={cn(
      "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold",
      TONE_CLASSES[meta.tone],
    )}>
      {status === "succeeded" ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
      {status === "processing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {meta.label}
    </span>
  );
}

function formatMoney(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: /^[A-Z]{3}$/.test(currency || "") ? currency : "ILS",
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || ""}`.trim();
  }
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function safeDocumentUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function controlledErrorText(row) {
  if (!row.last_error) return null;
  if (row.accounting_status === "configuration_required") {
    return "נדרשת השלמת הגדרות Rivhit לפני יצירת מסמך.";
  }
  if (row.accounting_status === "reconciliation_required") {
    return "נדרש בירור ידני לפני ניסיון נוסף.";
  }
  if (row.accounting_status === "retryable_error") {
    return "הפעולה נכשלה זמנית ותישאר זמינה לניסיון חוזר.";
  }
  return "לא ניתן היה להשלים את פעולת הנהלת החשבונות.";
}

function SummaryCard({ icon: Icon, label, value, tone = "slate" }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
      <div className={cn(
        "flex h-10 w-10 items-center justify-center rounded-xl",
        tone === "green" && "bg-emerald-50 text-emerald-700",
        tone === "amber" && "bg-amber-50 text-amber-700",
        tone === "red" && "bg-rose-50 text-rose-700",
        tone === "slate" && "bg-slate-100 text-slate-700",
      )}><Icon className="h-5 w-5" /></div>
      <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-black tabular-nums">{value}</p></div>
    </div>
  );
}

export default function AccountingOperations() {
  const { user } = useAuth();
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyEventId, setBusyEventId] = useState(null);
  const [filter, setFilter] = useState("all");

  const loadOperations = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from("payment_accounting_operations")
        .select(OPERATION_COLUMNS)
        .order("payment_succeeded_at", { ascending: false });
      if (error) throw error;
      setOperations(data ?? []);
    } catch {
      setOperations([]);
      setLoadError(true);
      toast.error("לא הצלחנו לטעון את נתוני הנהלת החשבונות");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOperations(); }, [loadOperations]);

  const counts = useMemo(() => ({
    payments: operations.filter((row) => row.payment_status === "succeeded").length,
    completed: operations.filter((row) => row.accounting_status === "succeeded").length,
    waiting: operations.filter((row) => ["pending", "processing", "retryable_error"].includes(row.accounting_status)).length,
    attention: operations.filter((row) => ["configuration_required", "permanent_error", "reconciliation_required"].includes(row.accounting_status)).length,
  }), [operations]);

  const visibleOperations = operations.filter((row) => {
    if (filter === "all") return true;
    if (filter === "attention") {
      return ["configuration_required", "permanent_error", "reconciliation_required"].includes(row.accounting_status);
    }
    if (filter === "open") return row.accounting_status !== "succeeded";
    return row.accounting_status === filter;
  });

  const retryAccounting = async (row) => {
    if (!row.retry_allowed || busyEventId) return;
    setBusyEventId(row.event_id);
    const body = { eventId: row.event_id };
    if (row.accounting_status === "configuration_required") body.forceRetry = true;
    try {
      const { data, error } = await supabase.functions.invoke(
        "payment-accounting-worker",
        { body },
      );
      if (error || !data?.ok) throw error ?? new Error("worker_failed");
      toast.success("הנהלת החשבונות הופעלה מחדש");
      await loadOperations();
    } catch {
      toast.error("הניסיון החוזר לא הושלם. אפשר לנסות שוב מאוחר יותר.");
    } finally {
      setBusyEventId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[22rem] items-center justify-center" dir="rtl">
        <div className="text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-slate-700" />
          <p className="text-sm">טוען נתוני הנהלת חשבונות…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[22rem] items-center justify-center" dir="rtl">
        <div role="alert" className="max-w-lg rounded-3xl border border-rose-200 bg-rose-50 p-7 text-center text-rose-900 shadow-sm">
          <CircleAlert className="mx-auto h-9 w-9" />
          <h1 className="mt-3 text-xl font-black">לא ניתן לטעון את בקרת הנהלת החשבונות</h1>
          <p className="mt-2 text-sm text-rose-800/80">נתוני התשלום לא שונו. אפשר לנסות לטעון את המסך מחדש.</p>
          <Button type="button" variant="outline" className="mt-5 border-rose-300 bg-white" onClick={loadOperations}>נסה שוב</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <header className="relative overflow-hidden rounded-3xl bg-[linear-gradient(125deg,#172033,#263752_62%,#976b24)] px-6 py-7 text-white shadow-lg md:px-8">
        <div className="absolute -left-14 -top-20 h-52 w-52 rounded-full border border-white/10" />
        <div className="absolute bottom-0 right-1/3 h-px w-2/3 bg-gradient-to-l from-amber-300/60 to-transparent" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-amber-200"><ShieldCheck className="h-4 w-4" /> תשלום מאומת · מסמך חשבונאי נפרד</p>
            <h1 className="text-3xl font-black tracking-tight md:text-4xl">בקרת הנה״ח</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-200">מעקב אחרי מסמכי Rivhit בלי לשנות את הצלחת התשלום, המכירה או ההזמנה.</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            {user?.role === 'admin' && (
              <Button asChild variant="outline" className="gap-2 border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white">
                <a href="/pelecard-transactions"><CreditCard className="h-4 w-4" /> עסקאות פלאקארד</a>
              </Button>
            )}
            <Button variant="outline" className="gap-2 border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={loadOperations}>
              <RefreshCw className="h-4 w-4" /> רענון
            </Button>
          </div>
        </div>
      </header>

      <ImmediateAccountingPanel />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="סיכום הנהלת חשבונות">
        <SummaryCard icon={CheckCircle2} label="תשלומים עם אירוע הנה״ח" value={counts.payments} tone="green" />
        <SummaryCard icon={FileCheck2} label="מסמכים שהושלמו" value={counts.completed} tone="green" />
        <SummaryCard icon={Clock3} label="בטיפול או בהמתנה" value={counts.waiting} tone="amber" />
        <SummaryCard icon={AlertTriangle} label="דורשים תשומת לב" value={counts.attention} tone="red" />
      </section>

      <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black">עסקאות ומסמכי Rivhit</h2>
            <p className="mt-1 text-sm text-muted-foreground">{visibleOperations.length} אירועים מוצגים · החדשים ביותר ראשונים</p>
          </div>
          <select aria-label="סינון מצב הנהלת חשבונות" value={filter} onChange={(event) => setFilter(event.target.value)} className="h-10 rounded-xl border bg-background px-3 text-sm font-medium">
            <option value="all">כל המצבים</option>
            <option value="open">כל האירועים הפתוחים</option>
            <option value="attention">דורשים תשומת לב</option>
            <option value="succeeded">הושלמו</option>
          </select>
        </div>

        {visibleOperations.length === 0 ? (
          <div className="px-6 py-16 text-center text-muted-foreground">
            <Landmark className="mx-auto mb-3 h-9 w-9 opacity-40" />
            <p className="font-semibold">אין אירועי הנהלת חשבונות להצגה</p>
            <p className="mt-1 text-sm">מסמכי תשלומי פלאקארד מיועדים ל-PAYPER, הממתין להפעלה. לא מופק עבורם מסמך נוסף בריווחית. הפקת מסמכים למזומן ולהמחאות נשארת מושהית.</p>
          </div>
        ) : (
          <div>
            <div className="hidden grid-cols-[1.25fr_1fr_1fr_1.1fr] gap-4 border-b bg-slate-50 px-5 py-3 text-xs font-bold text-slate-500 lg:grid">
              <span>מקור וזהות</span><span>תשלום</span><span>הנהלת חשבונות</span><span>מסמך ופעולות</span>
            </div>
            <div className="divide-y">
              {visibleOperations.map((row) => {
                const documentUrl = safeDocumentUrl(row.document_url);
                const errorText = controlledErrorText(row);
                const isBusy = busyEventId === row.event_id;
                return (
                  <article key={row.event_id} className={cn(
                    "relative grid gap-5 p-5 lg:grid-cols-[1.25fr_1fr_1fr_1.1fr] lg:items-start",
                    row.reconciliation_required && "bg-rose-50/35",
                  )}>
                    {row.reconciliation_required ? (
                      <div role="alert" className="col-span-full flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p><strong>נדרשת התאמה ידנית.</strong> התשלום נשאר תקין; אין לשנות או לבטל אותו בגלל כשל במסמך.</p>
                      </div>
                    ) : null}

                    <div className="min-w-0 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">מקור וזהות</p>
                      <div className="flex items-center gap-2"><ReceiptText className="h-4 w-4 text-slate-500" /><strong>{row.order_number || "ללא הזמנה מקושרת"}</strong></div>
                      <p className="text-xs text-muted-foreground">עסקת תשלום · {row.payment_transaction_id || row.source_id}</p>
                      <p className="text-xs text-muted-foreground">Pelecard: <span className="font-mono text-foreground">{row.provider_transaction_id || "—"}</span></p>
                      <p className="text-xs text-muted-foreground">מכירה: {row.local_receipt_number || row.sale_id || "—"}</p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">תשלום</p>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
                        <CheckCircle2 className="h-3.5 w-3.5" />{row.payment_status === "succeeded" ? "התשלום הצליח" : "מצב התשלום אינו תקין"}
                      </span>
                      <p className="text-lg font-black tabular-nums">{formatMoney(row.amount, row.currency)}</p>
                      <p className="text-xs text-muted-foreground">אומת ב־{formatDate(row.payment_succeeded_at)}</p>
                    </div>

                    <div className="min-w-0 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">הנהלת חשבונות</p>
                      <StatusPill status={row.accounting_status} />
                      <p className="text-xs text-muted-foreground">{Number(row.attempt_count) === 1 ? "ניסיון אחד" : `${Number(row.attempt_count) || 0} ניסיונות`}</p>
                      {row.next_attempt_at ? <p className="text-xs text-muted-foreground">הניסיון הבא: {formatDate(row.next_attempt_at)}</p> : null}
                      {errorText ? <p className="text-xs leading-relaxed text-slate-700">{errorText}</p> : null}
                      {row.last_error?.code ? <code className="block break-all text-[10px] text-muted-foreground">{row.last_error.code}</code> : null}
                    </div>

                    <div className="space-y-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">מסמך ופעולות</p>
                      {row.accounting_document_status ? <StatusPill status={row.accounting_document_status} /> : <p className="text-sm text-muted-foreground">טרם נוצר מסמך Rivhit</p>}
                      {documentUrl && row.external_document_number ? (
                        <a href={documentUrl} target="_blank" rel="noopener noreferrer" className="flex w-fit items-center gap-1.5 text-sm font-bold text-sky-700 underline-offset-4 hover:underline">
                          מסמך {row.external_document_number}<ArrowUpLeft className="h-3.5 w-3.5" />
                        </a>
                      ) : row.external_document_number ? <p className="text-sm font-bold">מסמך {row.external_document_number}</p> : null}
                      {row.retry_allowed ? (
                        <Button type="button" size="sm" variant="outline" className="gap-2" disabled={isBusy} aria-label={`ניסיון חוזר עבור ${row.payment_transaction_id || row.source_id}`} onClick={() => retryAccounting(row)}>
                          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} ניסיון חוזר
                        </Button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
