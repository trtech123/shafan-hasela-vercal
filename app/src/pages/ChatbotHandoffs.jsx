import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Bot, CheckCircle2, Clock3, Loader2, MessageCircle, RefreshCw, Send, UserRound } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_LABELS = {
  waiting: "ממתין לטיפול",
  active: "בטיפול",
  resolved: "טופל",
  closed: "סגור",
};
const STATUS_STYLES = {
  waiting: "bg-amber-100 text-amber-800 border-amber-200",
  active: "bg-blue-100 text-blue-800 border-blue-200",
  resolved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
};
const REASON_LABELS = {
  specific_price: "מחיר",
  quote_request: "הצעת מחיר",
  complaint_or_problem: "בעיה או תלונה",
  event_over_50: "אירוע גדול",
  complex_or_custom_package: "אירוע מותאם",
  unknown_question: "שאלה לא מוכרת",
  handoff_only_content: "מידע לנציג",
  explicit_human_request: "בקשת נציג",
  order_confirmation_unavailable: "אישור הזמנה",
};

function contactName(handoff) {
  return handoff.customer_name || handoff.conversation?.contact?.display_name || "לקוח ללא שם";
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export default function ChatbotHandoffs() {
  const { user } = useAuth();
  const [handoffs, setHandoffs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [reply, setReply] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");

  const loadHandoffs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("bot_handoffs")
      .select("id,conversation_id,lead_id,reason,priority,summary,customer_name,callback_phone,callback_email,company,requested_site,requested_activity,group_size,preferred_date,status,assigned_to,created_at,assignee:profiles(full_name),conversation:bot_conversations!inner(id,channel,status,contact:bot_contacts!inner(display_name,phone,email))")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("לא הצלחנו לטעון את תור הפניות");
      setHandoffs([]);
    } else {
      const rows = data ?? [];
      setHandoffs(rows);
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadHandoffs(); }, [loadHandoffs]);

  const selected = handoffs.find((handoff) => handoff.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected?.conversation_id) {
      setMessages([]);
      return;
    }
    let active = true;
    setMessagesLoading(true);
    supabase
      .from("bot_messages")
      .select("id,direction,message_kind,body,response_id,delivery_status,occurred_at")
      .eq("conversation_id", selected.conversation_id)
      .order("occurred_at", { ascending: true })
      .then(({ data, error }) => {
        if (!active) return;
        setMessages(error ? [] : data ?? []);
        setMessagesLoading(false);
      });
    return () => { active = false; };
  }, [selected?.conversation_id]);

  const reasons = useMemo(() => [...new Set(handoffs.map((item) => item.reason))], [handoffs]);
  const filtered = handoffs.filter((handoff) => {
    const channel = handoff.conversation?.channel;
    const assigneeMatch = assigneeFilter === "all"
      || (assigneeFilter === "mine" && handoff.assigned_to === user?.id)
      || (assigneeFilter === "unassigned" && !handoff.assigned_to);
    return (statusFilter === "all" || handoff.status === statusFilter)
      && (channelFilter === "all" || channel === channelFilter)
      && (reasonFilter === "all" || handoff.reason === reasonFilter)
      && assigneeMatch;
  });

  const invokeAction = async (action, message) => {
    if (!selected || actionLoading) return;
    setActionLoading(action);
    const body = { action, handoffId: selected.id };
    if (message) body.message = message;
    const { data, error } = await supabase.functions.invoke("chatbot-handoff-admin", { body });
    if (error || !data?.ok) {
      toast.error("הפעולה לא הושלמה. ייתכן שהפנייה השתנתה אצל עובד אחר.");
    } else {
      if (action === "reply") setReply("");
      toast.success("הפעולה הושלמה");
      await loadHandoffs();
    }
    setActionLoading(null);
  };

  const counts = {
    waiting: handoffs.filter((item) => item.status === "waiting").length,
    active: handoffs.filter((item) => item.status === "active").length,
    high: handoffs.filter((item) => item.priority === "high" && ["waiting", "active"].includes(item.status)).length,
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><Bot className="w-6 h-6" /></div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">תור שפן</h1>
              <p className="text-sm text-muted-foreground mt-1">פניות שהועברו מהבוט לטיפול אנושי</p>
            </div>
          </div>
        </div>
        <Button variant="outline" className="gap-2" onClick={loadHandoffs} disabled={loading}>
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> רענון
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="shadow-sm"><CardContent className="p-4 flex items-center justify-between"><span className="text-sm text-muted-foreground">ממתינות</span><strong className="text-2xl text-amber-700">{counts.waiting}</strong></CardContent></Card>
        <Card className="shadow-sm"><CardContent className="p-4 flex items-center justify-between"><span className="text-sm text-muted-foreground">בטיפול</span><strong className="text-2xl text-blue-700">{counts.active}</strong></CardContent></Card>
        <Card className="shadow-sm"><CardContent className="p-4 flex items-center justify-between"><span className="text-sm text-muted-foreground">דחופות</span><strong className="text-2xl text-rose-700">{counts.high}</strong></CardContent></Card>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <select aria-label="סינון לפי סטטוס" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm">
            <option value="all">כל הסטטוסים</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="סינון לפי ערוץ" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm">
            <option value="all">כל הערוצים</option><option value="whatsapp">WhatsApp</option><option value="facebook_messenger">Messenger</option><option value="instagram_dm">Instagram</option><option value="email">Email</option>
          </select>
          <select aria-label="סינון לפי סיבה" value={reasonFilter} onChange={(event) => setReasonFilter(event.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm">
            <option value="all">כל הסיבות</option>{reasons.map((reason) => <option key={reason} value={reason}>{REASON_LABELS[reason] || reason}</option>)}
          </select>
          <select aria-label="סינון לפי שיוך" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm">
            <option value="all">כל השיוכים</option><option value="mine">שלי</option><option value="unassigned">ללא שיוך</option>
          </select>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.6fr)] gap-4 items-start">
        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="pb-3 border-b"><CardTitle className="text-base">פניות ({filtered.length})</CardTitle></CardHeader>
          <div className="max-h-[680px] overflow-y-auto divide-y">
            {loading && <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />טוען פניות…</div>}
            {!loading && filtered.length === 0 && <div className="p-8 text-center text-muted-foreground">אין פניות התואמות לסינון</div>}
            {filtered.map((handoff) => (
              <button
                key={handoff.id}
                type="button"
                aria-label={`פתיחת פנייה של ${contactName(handoff)}`}
                onClick={() => setSelectedId(handoff.id)}
                className={cn("w-full text-right p-4 hover:bg-muted/60 transition-colors", selectedId === handoff.id && "bg-primary/5 border-r-4 border-primary")}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="font-semibold truncate">{contactName(handoff)}</p><p className="text-xs text-muted-foreground mt-1 truncate">{handoff.summary}</p></div>
                  {handoff.priority === "high" && <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <Badge variant="outline" className={STATUS_STYLES[handoff.status]}>{STATUS_LABELS[handoff.status]}</Badge>
                  <span className="text-[11px] text-muted-foreground">{REASON_LABELS[handoff.reason] || handoff.reason}</span>
                  <span className="text-[11px] text-muted-foreground mr-auto">{formatTime(handoff.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="shadow-sm min-h-[540px]">
          {!selected ? <CardContent className="p-12 text-center text-muted-foreground">בחרו פנייה להצגת הפרטים</CardContent> : (
            <>
              <CardHeader className="border-b pb-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div><CardTitle>{contactName(selected)}</CardTitle><p className="text-sm text-muted-foreground mt-1">{selected.callback_phone || selected.callback_email || "אין פרטי חזרה נוספים"}</p></div>
                  <Badge variant="outline" className={STATUS_STYLES[selected.status]}>{STATUS_LABELS[selected.status]}</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-3 text-xs">
                  <div><span className="text-muted-foreground">ערוץ</span><p className="font-medium mt-1">{selected.conversation?.channel}</p></div>
                  <div><span className="text-muted-foreground">אתר/פעילות</span><p className="font-medium mt-1">{selected.requested_site || selected.requested_activity || "—"}</p></div>
                  <div><span className="text-muted-foreground">גודל קבוצה</span><p className="font-medium mt-1">{selected.group_size || "—"}</p></div>
                  <div><span className="text-muted-foreground">CRM</span><p className="font-medium mt-1">{selected.lead_id ? `ליד ${selected.lead_id}` : "—"}</p></div>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div className="rounded-xl bg-muted/40 border p-3"><p className="text-xs font-semibold text-muted-foreground mb-1">סיכום ההעברה</p><p className="text-sm">{selected.summary}</p></div>
                <div className="space-y-2 min-h-40 max-h-72 overflow-y-auto p-1">
                  {messagesLoading && <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />}
                  {!messagesLoading && messages.length === 0 && <p className="text-sm text-center text-muted-foreground py-8">אין הודעות להצגה</p>}
                  {messages.map((message) => {
                    const inbound = message.direction === "inbound";
                    return <div key={message.id} className={cn("flex gap-2", inbound ? "justify-start" : "justify-end")}>
                      <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", inbound ? "bg-muted" : "bg-primary text-primary-foreground")}>
                        <div className="flex items-center gap-1 text-[10px] opacity-70 mb-1">{inbound ? <UserRound className="w-3 h-3" /> : <MessageCircle className="w-3 h-3" />}{inbound ? "לקוח" : message.message_kind === "staff_reply" ? "צוות" : "שפן"}</div>
                        <p className="whitespace-pre-wrap">{message.body || "הודעה ללא טקסט"}</p>
                      </div>
                    </div>;
                  })}
                </div>

                {selected.status === "waiting" && <Button className="w-full gap-2" onClick={() => invokeAction("claim")} disabled={Boolean(actionLoading)}><UserRound className="w-4 h-4" />קבלת טיפול</Button>}
                {selected.status === "active" && selected.assigned_to === user?.id && (
                  <div className="space-y-3 border-t pt-4">
                    <Textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="כתיבת תשובה ללקוח…" rows={3} maxLength={4096} />
                    <Button className="w-full gap-2" onClick={() => invokeAction("reply", reply.trim())} disabled={!reply.trim() || Boolean(actionLoading)}><Send className="w-4 h-4" />שליחת תשובה</Button>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <Button variant="outline" className="gap-1" onClick={() => invokeAction("resume")} disabled={Boolean(actionLoading)}><Bot className="w-4 h-4" />החזרת הבוט לפעילות</Button>
                      <Button variant="outline" className="gap-1" onClick={() => invokeAction("resolve")} disabled={Boolean(actionLoading)}><CheckCircle2 className="w-4 h-4" />סימון כטופל</Button>
                      <Button variant="outline" className="gap-1" onClick={() => invokeAction("close")} disabled={Boolean(actionLoading)}><Clock3 className="w-4 h-4" />סגירת שיחה</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
