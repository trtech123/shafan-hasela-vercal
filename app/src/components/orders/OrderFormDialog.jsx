import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import moment from "moment";
import CustomerSelector from "@/components/customers/CustomerSelector";
import { customerToRecord, customerErrorMessage } from "@/lib/customers";
import { findConflictingBlocks } from "@/lib/blocking";

const timeSlots = [
  "07:00","07:30","08:00","08:30","09:00","09:30","10:00","10:30",
  "11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30",
  "15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30",
  "19:00","19:30","20:00"
];

const SITES = ["עכו", "טבריה", "נוף הגליל", "שטח", "פודטראק", "קפה אקסטרים"];
const PAYMENT_METHODS = ["לא שולם", "אשראי", "צ'ק", "מזומן"];
const TASK_CATEGORIES = ["סדנת שטח"];

// Radix Select requires every SelectItem to have a non-empty `value`.
// Use this sentinel for "no instructor selected" and convert it to null when
// persisting to Supabase (instructor_id is a nullable UUID FK).
const NO_INSTRUCTOR = "__none__";
const NO_QUOTE = "__none__";

const emptyForm = {
  client_name: "", client_phone: "", client_email: "", organization: "",
  activity_id: "", instructor_id: NO_INSTRUCTOR, quote_id: NO_QUOTE,
  activity_date: "", start_time: "", end_time: "",
  site: "", num_participants: "", price_per_person: "", total_price: "",
  status: "ממתין לאישור", payment_status: "לא שולם", notes: "", internal_notes: "",
  billing_institution_name: "", billing_signer_name: "", billing_signer_id: "",
  billing_signer_role: "", billing_signer_phone: "", billing_company_id: "",
  billing_accounting_email: "",
};

export default function OrderFormDialog({ open, onClose, order, activities, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [reviewingCustomer, setReviewingCustomer] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const pendingRequest = useRef(null);
  const customerLocked = Boolean(order?.customer_snapshot_id || selectedCustomer);
  const displayedForm = selectedCustomer ? { ...form, ...customerToRecord(selectedCustomer), billing_institution_name: selectedCustomer.billing_name || selectedCustomer.display_name || '' } : form;
  const [instructors, setInstructors] = useState([]);
  const [quotes, setQuotes] = useState([]);
  // Same-day blocked_slots for the picked activity_date; used for conflict warning.
  const [blocks, setBlocks] = useState([]);
  // User must explicitly acknowledge before save proceeds over a conflict.
  // Resets whenever the relevant slot fields change (see effect below).
  const [overrideAck, setOverrideAck] = useState(false);

  const selectedActivity = activities.find(a => a.id === form.activity_id);
  const isTaskMode = selectedActivity && TASK_CATEGORIES.includes(selectedActivity.category);

  useEffect(() => {
    const fetchInstructors = async () => {
      const { data, error } = await supabase
        .from('instructors')
        .select('*')
        .eq('status', 'פעיל');
      if (error) console.error('instructors fetch error:', error);
      else setInstructors(data ?? []);
    };
    fetchInstructors();
  }, []);

  useEffect(() => {
    const fetchQuotes = async () => {
      const { data, error } = await supabase
        .from('quotes')
        .select('id, quote_number, client_name, event_date')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) console.error('quotes fetch error:', error);
      else setQuotes(data ?? []);
    };
    fetchQuotes();
  }, []);

  // Fetch same-day blocked_slots when the picked date changes.
  // Task-mode orders skip the check entirely — internal task workflows
  // aren't customer bookings.
  useEffect(() => {
    if (!form.activity_date || isTaskMode) {
      setBlocks([]);
      return;
    }
    const fetchBlocks = async () => {
      const { data, error } = await supabase
        .from('blocked_slots')
        .select('*')
        .eq('block_date', form.activity_date);
      if (error) {
        console.error('blocks fetch error:', error);
        return;
      }
      setBlocks(data ?? []);
    };
    fetchBlocks();
  }, [form.activity_date, isTaskMode]);

  // Compute conflicting blocks for the current slot. Exclude any order_lock
  // that originated from THIS order (avoids self-conflict on edit).
  const conflicts = useMemo(() => {
    if (isTaskMode) return [];
    const filtered = blocks.filter(b => !(b.source === 'order_lock' && b.source_order_id === order?.id));
    return findConflictingBlocks(filtered, {
      site: form.site || null,
      date: form.activity_date,
      start_time: form.start_time || null,
      end_time:   form.end_time   || null,
    });
  }, [blocks, form.site, form.activity_date, form.start_time, form.end_time, isTaskMode, order?.id]);

  // Reset override acknowledgement whenever any slot input changes — if the
  // user tweaks the slot after acknowledging, they must re-confirm.
  useEffect(() => {
    setOverrideAck(false);
  }, [form.activity_date, form.site, form.start_time, form.end_time]);

  useEffect(() => {
    if (order) {
      setForm({
        client_name: order.client_name || "",
        client_phone: order.client_phone || "",
        client_email: order.client_email || "",
        organization: order.organization || "",
        activity_id: order.activity_id || "",
        // null instructor_id in DB → sentinel so the picker displays "ללא מדריך"
        instructor_id: order.instructor_id ?? NO_INSTRUCTOR,
        // null quote_id in DB → sentinel so the picker displays "ללא הצעה מקושרת"
        quote_id: order.quote_id ?? NO_QUOTE,
        activity_date: order.activity_date || "",
        start_time: order.start_time || "",
        end_time: order.end_time || "",
        site: order.site || "",
        num_participants: order.num_participants || "",
        price_per_person: order.price_per_person || "",
        total_price: order.total_price || "",
        status: order.status || "ממתין לאישור",
        payment_status: order.payment_status || "לא שולם",
        notes: order.notes || "",
        internal_notes: order.internal_notes || "",
        billing_institution_name: order.billing_institution_name || "",
        billing_signer_name: order.billing_signer_name || "",
        billing_signer_id: order.billing_signer_id || "",
        billing_signer_role: order.billing_signer_role || "",
        billing_signer_phone: order.billing_signer_phone || "",
        billing_company_id: order.billing_company_id || "",
        billing_accounting_email: order.billing_accounting_email || "",
      });
    } else {
      setForm(emptyForm);
    }
  }, [order, open]);

  useEffect(() => {
    setSelectedCustomer(null); setReviewingCustomer(false); setSaveError(''); setUncertain(false);
    pendingRequest.current = null;
  }, [order, open]);

  const handleChange = (field, value) => {
    if (field === 'activity_id' && TASK_CATEGORIES.includes(activities.find(activity => activity.id === value)?.category)) {
      setSelectedCustomer(null); setReviewingCustomer(false);
    }
    setForm(prev => {
      const updated = { ...prev, [field]: value };
      // Auto-calc total from price_per_person * num_participants
      if (field === "price_per_person" || field === "num_participants") {
        const ppp = field === "price_per_person" ? Number(value) : Number(updated.price_per_person);
        const num = field === "num_participants" ? Number(value) : Number(updated.num_participants);
        if (ppp && num) updated.total_price = ppp * num;
      }
      // Auto-fill price_per_person from activity default
      if (field === "activity_id" && value) {
        const act = activities.find(a => a.id === value);
        if (act?.price_per_person) {
          updated.price_per_person = act.price_per_person;
          const num = Number(updated.num_participants);
          if (num) updated.total_price = act.price_per_person * num;
        }
      }
      return updated;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (inFlight.current || (conflicts.length > 0 && !overrideAck)) return;
    if (selectedCustomer && typeof selectedCustomer.vat_applicable !== 'boolean') {
      setSaveError('יש לבחור מדיניות מע״מ בכרטיס הלקוח לפני שמירה.'); return;
    }
    inFlight.current = true;
    setSaving(true); setSaveError('');
    try {
      const data = {
        ...form,
        // UUID FK fields: empty string / NO_INSTRUCTOR sentinel → null
        // (Postgres rejects "" and "__none__" as UUIDs).
        activity_id: form.activity_id || null,
        instructor_id:
          form.instructor_id && form.instructor_id !== NO_INSTRUCTOR
            ? form.instructor_id
            : null,
        // UUID FK to quotes; null when "ללא הצעה" sentinel chosen. Same empty-string-rejected pattern as instructor_id.
        quote_id:
          form.quote_id && form.quote_id !== NO_QUOTE
            ? form.quote_id
            : null,
        // TIME / DATE columns: Postgres rejects empty string for these types.
        // start_time / end_time are nullable; activity_date is NOT NULL and
        // the input is `required`, but normalize defensively so a stray empty
        // string surfaces as a clean "NOT NULL violation" instead of a parse error.
        activity_date: form.activity_date || null,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        // CHECK-constrained TEXT column: empty string is NOT in the allowed set
        // (orders_site_check IN ('עכו','טבריה','נוף הגליל','שטח')). User can
        // toggle a site button off → form.site = "" → constraint violation.
        // Column is nullable, so null passes the check.
        site: form.site || null,
        num_participants: Number(form.num_participants) || 0,
        price_per_person: Number(form.price_per_person) || 0,
        total_price: Number(form.total_price) || 0,
      };

      if (isTaskMode) {
        data.client_name = data.client_name || "משימה פנימית";
        data.client_phone = data.client_phone || "—";
      }
      // Snapshot fields may contain nulls; never rewrite them from display-normalized inputs.
      if (order?.customer_snapshot_id) {
        for (const key of ['client_name', 'client_phone', 'client_email', 'organization', 'billing_institution_name', 'billing_company_id', 'billing_accounting_email']) delete data[key];
      }

      // Unknown transport outcomes must retry the exact request, including its key.
      pendingRequest.current ??= {
        p_request_id: crypto.randomUUID(), p_order_id: order?.id || null,
        p_data: data, p_customer_id: isTaskMode ? null : selectedCustomer?.id || null,
        p_expected_version: order?.customer_record_version ?? 0,
      };
      const { error, data: saved } = await supabase.rpc('save_order_form', pendingRequest.current);
      if (error) {
        if (/^[0-9A-Z]{5}$/.test(error.code || '') && !error.code.startsWith('PGRST')) {
          pendingRequest.current = null; setUncertain(false);
        } else setUncertain(true);
        setSaveError(customerErrorMessage(error));
        return;
      }
      if (!saved?.id) throw new Error('order_save_result_missing');
      pendingRequest.current = null; setUncertain(false);

      if (data.instructor_id) {
        const instructor = instructors.find(i => i.id === data.instructor_id);
        if (instructor) {
          toast.success(
            `הזמנה נשמרה! פרטי מדריך: ${instructor.full_name} — ${instructor.phone}${instructor.email ? " | " + instructor.email : ""}`,
            { duration: 6000 }
          );
        }
      } else {
        toast.success('הזמנה נשמרה בהצלחה');
      }

      onSaved();
      onClose();
    } catch (err) {
      console.error('handleSubmit error:', err);
      setUncertain(true);
      setSaveError('תוצאת השמירה אינה ידועה. לחצו שוב על שמירה כדי לבדוק את אותה בקשה בלי ליצור הזמנה נוספת.');
      toast.error('שגיאה בשמירת ההזמנה');
    } finally {
      inFlight.current = false; setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => { if (!saving && !uncertain) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>
            {order ? (isTaskMode ? "עריכת משימה" : "עריכת הזמנה") : (isTaskMode ? "משימה חדשה" : "הזמנה חדשה")}
          </DialogTitle>
          {isTaskMode && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-orange-400"></span>
              מצב משימה פנימית — ללא פרטי לקוח
            </p>
          )}
        </DialogHeader>
        {!isTaskMode && <fieldset disabled={saving || uncertain} className="space-y-3">
          {order?.customer_snapshot_id && <p className="rounded border p-3 text-sm">פרטי הלקוח נשמרו להזמנה: {order.vat_applicable === true ? 'חייב במע״מ' : order.vat_applicable === false ? 'לא חייב במע״מ' : 'טרם נבדק'}. שינויים בכרטיס הלקוח אינם משנים את ההזמנה.</p>}
          {order?.customer_snapshot_id && order.payment_status === 'לא שולם' && !reviewingCustomer && <Button type="button" variant="outline" onClick={() => setReviewingCustomer(true)}>עדכון פרטי חיוב מהלקוח</Button>}
          {(!order?.customer_snapshot_id || reviewingCustomer) && <CustomerSelector value={selectedCustomer?.id} onSelect={setSelectedCustomer} onClear={() => setSelectedCustomer(null)} initialValues={form} />}
          {selectedCustomer && <p role="status" className="text-sm">נבחר לקוח: {selectedCustomer.display_name}. פרטי הלקוח והחיוב יישמרו עם שמירת ההזמנה.</p>}
          {reviewingCustomer && <Button type="button" variant="ghost" onClick={() => { setSelectedCustomer(null); setReviewingCustomer(false); }}>ביטול עדכון הלקוח</Button>}
        </fieldset>}
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <fieldset disabled={saving || uncertain}>
          <Tabs defaultValue="order" dir="rtl">
            <TabsList className="w-full">
              <TabsTrigger value="order" className="flex-1">פרטי הזמנה</TabsTrigger>
              {!isTaskMode && <TabsTrigger value="client" className="flex-1">לקוח</TabsTrigger>}
            </TabsList>

            <TabsContent value="order" className="space-y-4 mt-4">

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>פעילות *</Label>
              <Select value={form.activity_id} onValueChange={v => handleChange("activity_id", v)}>
                <SelectTrigger><SelectValue placeholder="בחר פעילות" /></SelectTrigger>
                <SelectContent>
                  {activities.filter(a => a.status === "פעיל").map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>מדריך משובץ</Label>
              <Select value={form.instructor_id} onValueChange={v => handleChange("instructor_id", v)}>
                <SelectTrigger><SelectValue placeholder="בחר מדריך" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INSTRUCTOR}>ללא מדריך</SelectItem>
                  {instructors.map(i => (
                    <SelectItem key={i.id} value={i.id}>{i.full_name} — {i.phone}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isTaskMode && (
            <div>
              <Label>הצעת מחיר מקושרת</Label>
              <Select value={form.quote_id} onValueChange={v => handleChange("quote_id", v)}>
                <SelectTrigger><SelectValue placeholder="בחר הצעת מחיר" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_QUOTE}>ללא הצעה מקושרת</SelectItem>
                  {quotes.map(q => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.quote_number} — {q.client_name}{q.event_date ? ` (${moment(q.event_date).format("DD/MM/YY")})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!isTaskMode && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>שם הלקוח *</Label>
                <Input aria-label="שם הלקוח" disabled={customerLocked} value={displayedForm.client_name} onChange={e => handleChange("client_name", e.target.value)} required />
              </div>
              <div>
                <Label>טלפון *</Label>
                <Input aria-label="טלפון" disabled={customerLocked} value={displayedForm.client_phone} onChange={e => handleChange("client_phone", e.target.value)} required />
              </div>
              <div>
                <Label>אימייל</Label>
                <Input aria-label="אימייל" type="email" disabled={customerLocked} value={displayedForm.client_email} onChange={e => handleChange("client_email", e.target.value)} />
              </div>
              <div>
                <Label>ארגון / חברה</Label>
                <Input aria-label="ארגון / חברה" disabled={customerLocked} value={displayedForm.organization} onChange={e => handleChange("organization", e.target.value)} />
              </div>
            </div>
          )}

          {isTaskMode && (
            <div className="p-3 rounded-xl bg-orange-50 border border-orange-200">
              <p className="text-xs font-medium text-orange-700 mb-2">📋 פרטי המשימה</p>
              <div>
                <Label>תיאור / שם המשימה</Label>
                <Input aria-label="תיאור המשימה"
                  disabled={customerLocked} value={displayedForm.organization}
                  onChange={e => handleChange("organization", e.target.value)}
                  placeholder="לדוגמה: סיור הכנה לאירוע, תחזוקת ציוד..."
                />
              </div>
            </div>
          )}

          <div>
            <Label>אתר</Label>
            <div className="flex gap-2 flex-wrap mt-1">
              {SITES.map(site => (
                <button
                  key={site}
                  type="button"
                  onClick={() => handleChange("site", form.site === site ? "" : site)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${
                    form.site === site
                      ? siteSelectedClass(site)
                      : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {site}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label>תאריך הפעילות *</Label>
              <Input aria-label="תאריך הפעילות" type="date" value={form.activity_date} onChange={e => handleChange("activity_date", e.target.value)} required />
            </div>
            <div>
              <Label>שעת התחלה</Label>
              <Select value={form.start_time} onValueChange={v => handleChange("start_time", v)}>
                <SelectTrigger><SelectValue placeholder="בחר שעה" /></SelectTrigger>
                <SelectContent>
                  {timeSlots.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>שעת סיום</Label>
              <Select value={form.end_time} onValueChange={v => handleChange("end_time", v)}>
                <SelectTrigger><SelectValue placeholder="בחר שעה" /></SelectTrigger>
                <SelectContent>
                  {timeSlots.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isTaskMode ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>מספר משתתפים</Label>
                <Input aria-label="מספר משתתפים" type="number" min="0" value={form.num_participants} onChange={e => handleChange("num_participants", e.target.value)} />
              </div>
              <div>
                <Label>עלות כוללת (₪)</Label>
                <Input aria-label="סך הכל לתשלום" type="number" min="0" value={form.total_price} onChange={e => handleChange("total_price", e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-2">
              <div>
                <Label>מספר משתתפים *</Label>
                <Input aria-label="מספר משתתפים" type="number" min="1" value={form.num_participants} onChange={e => handleChange("num_participants", e.target.value)} required />
              </div>
              <div>
                <Label>מחיר למשתתף (₪)</Label>
                <Input aria-label="מחיר למשתתף" type="number" min="0" value={form.price_per_person} onChange={e => handleChange("price_per_person", e.target.value)} />
              </div>
              <div>
                <Label>סה״כ לתשלום (₪)</Label>
                <Input aria-label="סך הכל לתשלום" type="number" min="0" value={form.total_price} onChange={e => handleChange("total_price", e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>סטטוס</Label>
              <Select value={form.status} onValueChange={v => handleChange("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["ממתין לאישור","מאושר","שולם","בוצע","בוטל"].map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>אמצעי תשלום</Label>
              <Select value={form.payment_status} onValueChange={v => handleChange("payment_status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>הערות (ללקוח)</Label>
            <Textarea value={form.notes} onChange={e => handleChange("notes", e.target.value)} rows={3} />
          </div>

          <div>
            <Label className="flex items-center gap-1">🔒 הערות פנימיות (צוות בלבד)</Label>
            <Textarea
              value={form.internal_notes}
              onChange={e => handleChange("internal_notes", e.target.value)}
              rows={3}
              placeholder="לא מופיע באישור ההזמנה ללקוח ולא נשלח במייל"
            />
          </div>

            </TabsContent>

            {!isTaskMode && (
              <TabsContent value="client" className="space-y-4 mt-4">
                <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">פרטים אלו ישמשו להפקת חשבונית</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <Label>שם המוסד / ארגון</Label>
                    <Input aria-label="שם המוסד / ארגון" disabled={customerLocked} value={displayedForm.billing_institution_name} onChange={e => handleChange("billing_institution_name", e.target.value)} placeholder="לדוגמה: עיריית חיפה" />
                  </div>
                  <div>
                    <Label>שם החותם</Label>
                    <Input value={form.billing_signer_name} onChange={e => handleChange("billing_signer_name", e.target.value)} placeholder="שם מלא" />
                  </div>
                  <div>
                    <Label>ת.ז של החותם</Label>
                    <Input value={form.billing_signer_id} onChange={e => handleChange("billing_signer_id", e.target.value)} placeholder="000000000" />
                  </div>
                  <div>
                    <Label>תפקיד</Label>
                    <Input value={form.billing_signer_role} onChange={e => handleChange("billing_signer_role", e.target.value)} placeholder="לדוגמה: מנהל רכש" />
                  </div>
                  <div>
                    <Label>נייד החותם</Label>
                    <Input value={form.billing_signer_phone} onChange={e => handleChange("billing_signer_phone", e.target.value)} placeholder="05X-XXXXXXX" />
                  </div>
                  <div>
                    <Label>ח.פ / ע.מ</Label>
                    <Input aria-label="ח.פ / ע.מ" disabled={customerLocked} value={displayedForm.billing_company_id} onChange={e => handleChange("billing_company_id", e.target.value)} placeholder="מספר ח.פ או ע.מ" />
                  </div>
                  <div>
                    <Label>מייל הנהח</Label>
                    <Input aria-label="מייל הנהלת חשבונות" type="email" disabled={customerLocked} value={displayedForm.billing_accounting_email} onChange={e => handleChange("billing_accounting_email", e.target.value)} placeholder="accounting@company.com" />
                  </div>
                </div>
              </TabsContent>
            )}

          </Tabs>

          {conflicts.length > 0 && (
            <div className="p-3 rounded-xl border border-red-300 bg-red-50 space-y-2">
              <p className="text-sm font-semibold text-red-800 flex items-center gap-1">
                🔒 התאריך/השעה חסומים
              </p>
              <ul className="space-y-1">
                {conflicts.map(b => (
                  <li key={b.id} className="text-xs text-red-700">
                    <span className="font-medium">{b.reason}</span>
                    {" · "}
                    {b.start_time && b.end_time
                      ? `${b.start_time.slice(0,5)}–${b.end_time.slice(0,5)}`
                      : "כל היום"}
                    {" · "}
                    {b.site || "כל האתרים"}
                    {b.source === 'order_lock' && " · נעילת הזמנה"}
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-2 text-xs text-red-800 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={overrideAck}
                  onChange={e => setOverrideAck(e.target.checked)}
                  className="mt-0.5"
                />
                <span>אני יודע/ת שיש חסימה ומאשר/ת יצירה בכל זאת</span>
              </label>
            </div>
          )}

          </fieldset>
          {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" disabled={saving || uncertain} onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={saving || (conflicts.length > 0 && !overrideAck)}>
              {saving ? "שומר..." : order ? "עדכון" : isTaskMode ? "צור משימה" : "צור הזמנה"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function siteSelectedClass(site) {
  const map = {
    "עכו": "border-blue-400 bg-blue-100 text-blue-800",
    "טבריה": "border-teal-400 bg-teal-100 text-teal-800",
    "נוף הגליל": "border-purple-400 bg-purple-100 text-purple-800",
    "שטח": "border-orange-400 bg-orange-100 text-orange-800",
  };
  return map[site] || "border-primary bg-primary/10 text-primary";
}
