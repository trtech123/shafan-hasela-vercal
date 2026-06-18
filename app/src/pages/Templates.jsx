import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { MessageSquareText, Loader2, RotateCcw, Save, Mail, MessageCircle, FileText } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

const CHANNEL_META = {
  email:    { label: "אימייל",  icon: Mail,          cls: "bg-blue-100 text-blue-800" },
  whatsapp: { label: "וואטסאפ", icon: MessageCircle, cls: "bg-green-100 text-green-800" },
  general:  { label: "כללי",    icon: FileText,      cls: "bg-slate-100 text-slate-700" },
};

// Placeholder hints per template key — shown so admins know what's available.
const PLACEHOLDERS = {
  order_confirmation_email: ["{clientName}", "{activityName}", "{activityDate}"],
  order_whatsapp: ["{clientName}", "{activityName}", "{activityDate}", "{orderNumber}", "{participants}", "{total}"],
  quote_message: ["{clientName}", "{activityName}"],
  instructor_invitation: ["{instructorName}", "{activityName}", "{activityDate}", "{startTime}", "{site}", "{clientName}", "{participants}"],
};

export default function Templates() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  // Per-id local edit state: { [id]: { body, active } }
  const [edits, setEdits] = useState({});
  const [savingId, setSavingId] = useState(null);

  // Admin-only page.
  if (user && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("message_templates")
      .select("*")
      .order("channel", { ascending: true });
    if (error) {
      console.error("templates fetch error:", error);
      toast.error("שגיאה בטעינת התבניות");
    }
    setTemplates(data ?? []);
    setEdits({});
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const editOf = (t) => edits[t.id] ?? { body: t.body, active: t.active };
  const setEdit = (id, patch) => setEdits((e) => ({ ...e, [id]: { ...(e[id] ?? {}), ...patch } }));
  const dirty = (t) => {
    const e = edits[t.id];
    return e && (e.body !== t.body || e.active !== t.active);
  };

  const save = async (t) => {
    const e = editOf(t);
    setSavingId(t.id);
    const { error } = await supabase
      .from("message_templates")
      .update({ body: e.body, active: e.active })
      .eq("id", t.id);
    if (error) {
      console.error("save template error:", error);
      toast.error("שמירת התבנית נכשלה");
    } else {
      toast.success("התבנית נשמרה ✓");
      await load();
    }
    setSavingId(null);
  };

  const resetDefault = (t) => {
    if (t.default_body == null) return;
    setEdit(t.id, { body: t.default_body });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin ml-2" /> טוען…
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquareText className="w-6 h-6" /> תבניות הודעות
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          עריכת טקסט ההודעות במערכת. גישה למנהלים בלבד. שינויים נשמרים אך אינם מחליפים עדיין את שליחת ההודעות בפועל.
        </p>
      </div>

      <div className="space-y-4">
        {templates.map((t) => {
          const e = editOf(t);
          const meta = CHANNEL_META[t.channel] || CHANNEL_META.general;
          const Icon = meta.icon;
          return (
            <div key={t.id} className="bg-card border border-border rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">{t.title}</h2>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${meta.cls}`}>
                    <Icon className="w-3 h-3" /> {meta.label}
                  </span>
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  פעיל
                  <Switch checked={e.active} onCheckedChange={(v) => setEdit(t.id, { active: v })} />
                </label>
              </div>

              <Textarea
                dir="rtl"
                rows={7}
                value={e.body}
                onChange={(ev) => setEdit(t.id, { body: ev.target.value })}
                className="font-mono text-sm leading-relaxed"
              />

              {PLACEHOLDERS[t.key] && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[11px] text-muted-foreground">משתנים זמינים:</span>
                  {PLACEHOLDERS[t.key].map((p) => (
                    <code key={p} className="text-[11px] bg-muted px-1.5 py-0.5 rounded">{p}</code>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => resetDefault(t)} disabled={t.default_body == null}>
                  <RotateCcw className="w-3.5 h-3.5" /> שחזר ברירת מחדל
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => save(t)} disabled={!dirty(t) || savingId === t.id}>
                  {savingId === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  שמור
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
