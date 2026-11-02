import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import moment from "moment";
import { findConflictingBlocks, findConflictingOrders } from "@/lib/blocking";
import { publishOrderChange } from "@/lib/orderEvents";
import { changedOrderFields } from "@/lib/orderUpdate";

const timeSlots = [
  "07:00","07:30","08:00","08:30","09:00","09:30","10:00","10:30",
  "11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30",
  "15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30",
  "19:00","19:30","20:00"
];

const SITES = ["עכו", "טבריה", "נוף הגליל", "שטח", "פודטראק", "קפה אקסטרים"];
const PAYMENT_METHODS = ["לא שולם", "שובר", "אשראי", "צ'ק", "מזומן"];
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
  const [instructors, setInstructors] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [pendingSave, setPendingSave] = useState(null);
  const [warningConflicts, setWarningConflicts] = useState([]);
  const [instructorTouched, setInstructorTouched] = useState(false);
  const [quoteTouched, setQuoteTouched] = useState(false);

  const selectedActivity = activities.find(a => a.id === form.activity_id);
  const isTaskMode = selectedActivity && TASK_CATEGORIES.includes(selectedActivity.category);

  useEffect(() => {
    const fetchInstructors = async () => {
      const { data, error } = await supabase
        .from('instructors')
        .select('*');
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

  useEffect(() => {
    setPendingSave(null);
    setWarningConflicts([]);
    setInstructorTouched(false);
    setQuoteTouched(false);
  }, [order, open]);

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
        start_time: order.start_time?.slice(0, 5) || "",
        end_time: order.end_time?.slice(0, 5) || "",
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

  const handleChange = (field, value) => {
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

  const persistOrder = async (data) => {
    setSaving(true);
    try {
      const update = order ? changedOrderFields(order, data) : data;
      if (order && Object.keys(update).length === 0) {
        toast.info('לא בוצעו שינויים בהזמנה');
        onClose();
        return;
      }
      const result = order
        ? await supabase.from('orders').update(update).eq('id', order.id).select('id, activity_date, start_time, end_time').single()
        : await supabase.from('orders').insert(update).select('id').single();
      if (result.error || !result.data?.id) throw result.error || new Error('No order row returned');
      publishOrderChange();
      toast.success(order ? 'ההזמנה עודכנה בהצלחה' : 'ההזמנה נשמרה בהצלחה');
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('save order error:', err);
      toast.error('שמירת ההזמנה נכשלה. בדקו הרשאות ונתונים ונסו שוב.');
    } finally {
      setSaving(false);
      setPendingSave(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving || pendingSave) return;
    setSaving(true);
    try {
      const data = {
        ...form,
        // UUID FK fields: empty string / NO_INSTRUCTOR sentinel → null
        // (Postgres rejects "" and "__none__" as UUIDs).
        activity_id: form.activity_id || null,
        instructor_id: !instructorTouched && order ? order.instructor_id :
          form.instructor_id && form.instructor_id !== NO_INSTRUCTOR
            ? form.instructor_id
            : null,
        // UUID FK to quotes; null when "ללא הצעה" sentinel chosen. Same empty-string-rejected pattern as instructor_id.
        quote_id: !quoteTouched && order ? order.quote_id :
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

      if (!isTaskMode && data.activity_date) {
        const [blocksResult, ordersResult] = await Promise.all([
          supabase.from('blocked_slots').select('id, block_date, site, start_time, end_time, reason, source, source_order_id').eq('block_date', data.activity_date),
          supabase.from('orders').select('id, order_number, activity_date, start_time, end_time, site, instructor_id, status').eq('activity_date', data.activity_date),
        ]);
        if (blocksResult.error || ordersResult.error || !blocksResult.data || !ordersResult.data) {
          throw blocksResult.error || ordersResult.error || new Error('Availability query returned no rows');
        }
        const blockConflicts = findConflictingBlocks(
          blocksResult.data.filter((b) => !(b.source === 'order_lock' && b.source_order_id === order?.id)),
          { site: data.site, date: data.activity_date, start_time: data.start_time, end_time: data.end_time },
        ).map((b) => ({ id: b.id, kind: 'block', label: b.reason, site: b.site, start_time: b.start_time, end_time: b.end_time }));
        const orderConflicts = findConflictingOrders(ordersResult.data, data, order?.id)
          .map((o) => {
            const reason = o.site && data.site && o.site === data.site ? 'אותו אתר'
              : o.instructor_id && data.instructor_id && o.instructor_id === data.instructor_id ? 'אותו מדריך'
                : 'אתר לא ידוע — חפיפה אפשרית';
            return { id: o.id, kind: 'order', label: `הזמנה ${o.order_number || o.id.slice(0, 8)} (${reason})`, site: o.site, start_time: o.start_time, end_time: o.end_time };
          });
        const found = [...blockConflicts, ...orderConflicts];
        if (found.length) {
          setWarningConflicts(found);
          setPendingSave(data);
          return;
        }
      }
      await persistOrder(data);
    } catch (err) {
      console.error('availability check error:', err);
      toast.error('לא ניתן לבדוק חפיפות כרגע. ההזמנה לא נשמרה. נסו שוב.');
    } finally {
      setSaving(false);
    }
  };

  return (<>
    <Dialog open={open} onOpenChange={onClose}>
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
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
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
            <div onPointerDownCapture={(event) => { if (event.target instanceof Element && event.target.closest('[role="combobox"]')) setInstructorTouched(true); }} onKeyDownCapture={(event) => { if (event.target instanceof Element && event.target.closest('[role="combobox"]')) setInstructorTouched(true); }}>
              <Label>מדריך משובץ</Label>
              <Select value={form.instructor_id} onValueChange={v => handleChange("instructor_id", v)}>
                <SelectTrigger><SelectValue placeholder="בחר מדריך" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INSTRUCTOR}>ללא מדריך</SelectItem>
                  {instructors.filter(i => i.status === 'פעיל' || i.id === order?.instructor_id).map(i => (
                    <SelectItem key={i.id} value={i.id}>{i.full_name} — {i.phone}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isTaskMode && (
            <div onPointerDownCapture={(event) => { if (event.target instanceof Element && event.target.closest('[role="combobox"]')) setQuoteTouched(true); }} onKeyDownCapture={(event) => { if (event.target instanceof Element && event.target.closest('[role="combobox"]')) setQuoteTouched(true); }}>
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
                <Input value={form.client_name} onChange={e => handleChange("client_name", e.target.value)} required />
              </div>
              <div>
                <Label>טלפון *</Label>
                <Input value={form.client_phone} onChange={e => handleChange("client_phone", e.target.value)} required />
              </div>
              <div>
                <Label>אימייל</Label>
                <Input type="email" value={form.client_email} onChange={e => handleChange("client_email", e.target.value)} />
              </div>
              <div>
                <Label>ארגון / חברה</Label>
                <Input value={form.organization} onChange={e => handleChange("organization", e.target.value)} />
              </div>
            </div>
          )}

          {isTaskMode && (
            <div className="p-3 rounded-xl bg-orange-50 border border-orange-200">
              <p className="text-xs font-medium text-orange-700 mb-2">📋 פרטי המשימה</p>
              <div>
                <Label>תיאור / שם המשימה</Label>
                <Input
                  value={form.organization}
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
              <Input type="date" value={form.activity_date} onChange={e => handleChange("activity_date", e.target.value)} required />
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
                <Input type="number" min="0" value={form.num_participants} onChange={e => handleChange("num_participants", e.target.value)} />
              </div>
              <div>
                <Label>עלות כוללת (₪)</Label>
                <Input type="number" min="0" value={form.total_price} onChange={e => handleChange("total_price", e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-2">
              <div>
                <Label>מספר משתתפים *</Label>
                <Input type="number" min="1" value={form.num_participants} onChange={e => handleChange("num_participants", e.target.value)} required />
              </div>
              <div>
                <Label>מחיר למשתתף (₪)</Label>
                <Input type="number" min="0" value={form.price_per_person} onChange={e => handleChange("price_per_person", e.target.value)} />
              </div>
              <div>
                <Label>סה״כ לתשלום (₪)</Label>
                <Input type="number" min="0" value={form.total_price} onChange={e => handleChange("total_price", e.target.value)} />
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
                    <Input value={form.billing_institution_name} onChange={e => handleChange("billing_institution_name", e.target.value)} placeholder="לדוגמה: עיריית חיפה" />
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
                    <Input value={form.billing_company_id} onChange={e => handleChange("billing_company_id", e.target.value)} placeholder="מספר ח.פ או ע.מ" />
                  </div>
                  <div>
                    <Label>מייל הנהח</Label>
                    <Input type="email" value={form.billing_accounting_email} onChange={e => handleChange("billing_accounting_email", e.target.value)} placeholder="accounting@company.com" />
                  </div>
                </div>
              </TabsContent>
            )}

          </Tabs>

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "שומר..." : order ? "עדכון" : isTaskMode ? "צור משימה" : "צור הזמנה"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={!!pendingSave} onOpenChange={(isOpen) => { if (!isOpen) { setPendingSave(null); setWarningConflicts([]); } }}>
      <AlertDialogContent dir="rtl" aria-label="אזהרת הזמנות חופפות">
        <AlertDialogHeader>
          <AlertDialogTitle>נמצאה חפיפה בלוח הזמנים</AlertDialogTitle>
          <AlertDialogDescription>אפשר לשמור את ההזמנה למרות החפיפה רק באישור מפורש.</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-44 overflow-y-auto space-y-2 text-sm">
          {warningConflicts.map((item) => <li key={item.id}>
            {item.label} · {item.site || (item.kind === 'block' ? 'כל האתרים' : 'אתר לא צוין')} · {item.start_time && item.end_time ? `${item.start_time.slice(0, 5)}–${item.end_time.slice(0, 5)}` : item.kind === 'block' ? 'כל היום' : item.start_time ? `${item.start_time.slice(0, 5)} (שעת סיום לא צוינה)` : 'שעות לא צוינו'}
          </li>)}
        </ul>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button type="button" variant="outline" onClick={() => { setPendingSave(null); setWarningConflicts([]); }}>ביטול / חזרה לעריכה</Button>
          <Button type="button" disabled={saving} onClick={() => persistOrder(pendingSave)}>אישור והמשך בכל זאת</Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  </>);
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
