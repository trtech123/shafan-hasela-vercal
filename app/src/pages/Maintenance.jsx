import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import moment from "moment";

const SITES = ["עכו", "טבריה", "נוף הגליל", "שטח"];
const CATEGORIES = ["בטיחות", "ציוד", "מתקנים", "ניקיון", "כללי"];
const PRIORITIES = ["גבוהה", "בינונית", "נמוכה"];
const STATUSES = ["פתוחה", "בטיפול", "הושלמה"];

const SITE_COLORS = {
  "עכו":        "bg-blue-100 text-blue-800 border-blue-200",
  "טבריה":      "bg-teal-100 text-teal-800 border-teal-200",
  "נוף הגליל":  "bg-purple-100 text-purple-800 border-purple-200",
  "שטח":        "bg-orange-100 text-orange-800 border-orange-200",
};

const PRIORITY_COLORS = {
  "גבוהה":  "bg-red-100 text-red-700 border-red-200",
  "בינונית": "bg-amber-100 text-amber-700 border-amber-200",
  "נמוכה":  "bg-green-100 text-green-700 border-green-200",
};

const STATUS_COLORS = {
  "פתוחה":   "bg-slate-100 text-slate-600 border-slate-200",
  "בטיפול":  "bg-blue-100 text-blue-700 border-blue-200",
  "הושלמה":  "bg-emerald-100 text-emerald-700 border-emerald-200",
};

// Radix <Select> reserves "" for the unselected state, and the assigned_to UUID FK
// rejects "" / non-UUID values — represent "no assignee" with this sentinel and
// coerce it back to null on save.
const NO_ASSIGNEE = "__none__";

const emptyForm = {
  title: "", site: "", category: "", priority: "בינונית",
  status: "פתוחה", description: "", due_date: "", assigned_to: NO_ASSIGNEE,
};

export default function Maintenance() {
  const [tasks, setTasks] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [siteFilter, setSiteFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const load = async () => {
    const [{ data, error: eM }, { data: p, error: eP }] = await Promise.all([
      supabase.from('maintenance_tasks').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('profiles').select('id, full_name, email').order('full_name'),
    ]);
    if (eM) {
      console.error('maintenance fetch error:', eM);
      toast.error('שגיאה בטעינת משימות התחזוקה');
    }
    if (eP) console.error('profiles fetch error:', eP);
    setTasks(data ?? []);
    setProfiles(p ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const profileById = useMemo(
    () => Object.fromEntries(profiles.map(p => [p.id, p])),
    [profiles]
  );
  const getProfileName = (id) => profileById[id]?.full_name || profileById[id]?.email || "—";

  const openNew = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (t) => {
    setEditing(t);
    setForm({
      title: t.title || "",
      site: t.site || "",
      category: t.category || "",
      priority: t.priority || "בינונית",
      status: t.status || "פתוחה",
      description: t.description || "",
      due_date: t.due_date || "",
      assigned_to: t.assigned_to ?? NO_ASSIGNEE,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // site is NOT NULL CHECK and the Select has no `required` — gate client-side
    // so we surface a Hebrew message instead of a raw Supabase 400.
    if (!form.site) { toast.error('יש לבחור אתר'); return; }
    setSaving(true);
    try {
      // Explicit payload — coerce empties to null (Postgres rejects "" for DATE and
      // for the nullable category CHECK); map the assignee sentinel back to null.
      const payload = {
        title: form.title,
        site: form.site,
        category: form.category || null,
        priority: form.priority,
        status: form.status,
        description: form.description || null,
        due_date: form.due_date || null,
        assigned_to: (form.assigned_to && form.assigned_to !== NO_ASSIGNEE) ? form.assigned_to : null,
      };
      let error;
      if (editing) {
        ({ error } = await supabase.from('maintenance_tasks').update(payload).eq('id', editing.id));
      } else {
        ({ error } = await supabase.from('maintenance_tasks').insert(payload));
      }
      if (error) {
        console.error('save maintenance error:', error);
        toast.error('שגיאה בשמירת המשימה');
        return;
      }
      toast.success(editing ? 'המשימה עודכנה' : 'המשימה נוצרה');
      setDialogOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const { error } = await supabase.from('maintenance_tasks').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) {
      console.error('maintenance delete error:', error);
      toast.error('שגיאה במחיקת המשימה');
      return;
    }
    toast.success('המשימה נמחקה');
    load();
  };

  const toggleStatus = async (task) => {
    const next = task.status === "פתוחה" ? "בטיפול" : task.status === "בטיפול" ? "הושלמה" : "פתוחה";
    const { error } = await supabase.from('maintenance_tasks').update({ status: next }).eq('id', task.id);
    if (error) {
      console.error('maintenance status update error:', error);
      toast.error('שגיאה בעדכון הסטטוס');
      return;
    }
    load();
  };

  const filtered = tasks.filter(t => {
    const matchSite = siteFilter === "all" || t.site === siteFilter;
    const matchStatus = statusFilter === "all" || t.status === statusFilter;
    return matchSite && matchStatus;
  });

  const openCount = tasks.filter(t => t.status !== "הושלמה").length;

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">משימות תחזוקה</h1>
          <p className="text-muted-foreground mt-1">{openCount} משימות פתוחות</p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="w-4 h-4" /> משימה חדשה
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={siteFilter} onValueChange={setSiteFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="כל האתרים" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל האתרים</SelectItem>
            {SITES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="כל הסטטוסים" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסטטוסים</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Tasks list grouped by site */}
      {SITES.filter(site => siteFilter === "all" || siteFilter === site).map(site => {
        const siteTasks = filtered.filter(t => t.site === site);
        if (siteTasks.length === 0) return null;
        return (
          <div key={site}>
            <div className={cn("inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-semibold border mb-3", SITE_COLORS[site])}>
              {site} · {siteTasks.length}
            </div>
            <div className="grid gap-2">
              {siteTasks.map(task => (
                <div key={task.id} className={cn("flex items-center gap-3 p-4 rounded-xl border bg-card hover:bg-muted/30 transition-colors", task.status === "הושלמה" && "opacity-60")}>
                  <button onClick={() => toggleStatus(task)} title="שנה סטטוס" className="flex-shrink-0">
                    <CheckCircle2 className={cn("w-5 h-5 transition-colors", task.status === "הושלמה" ? "text-emerald-500" : task.status === "בטיפול" ? "text-blue-400" : "text-muted-foreground/40")} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-medium text-sm", task.status === "הושלמה" && "line-through text-muted-foreground")}>{task.title}</p>
                    {task.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.description}</p>}
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {task.category && <span className="text-[11px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{task.category}</span>}
                      {task.assigned_to && <span className="text-[11px] text-muted-foreground">👤 {getProfileName(task.assigned_to)}</span>}
                      {task.due_date && <span className="text-[11px] text-muted-foreground">📅 {moment(task.due_date).format("DD/MM/YY")}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", PRIORITY_COLORS[task.priority])}>{task.priority}</span>
                    <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", STATUS_COLORS[task.status])}>{task.status}</span>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(task)} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
                      <Pencil className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <button onClick={() => setDeleteId(task.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <p className="text-center text-muted-foreground py-16">אין משימות תחזוקה. לחצי על "משימה חדשה" כדי להוסיף.</p>
      )}

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? "עריכת משימה" : "משימה חדשה"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div>
              <Label>כותרת *</Label>
              <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>אתר *</Label>
                <Select value={form.site} onValueChange={v => setForm(p => ({ ...p, site: v }))}>
                  <SelectTrigger><SelectValue placeholder="בחר אתר" /></SelectTrigger>
                  <SelectContent>{SITES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>קטגוריה</Label>
                <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="בחר" /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>עדיפות</Label>
                <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>סטטוס</Label>
                <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>תיאור</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>תאריך יעד</Label>
                <Input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} />
              </div>
              <div>
                <Label>אחראי</Label>
                <Select value={form.assigned_to} onValueChange={v => setForm(p => ({ ...p, assigned_to: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ASSIGNEE}>ללא אחראי</SelectItem>
                    {profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email || p.id}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>ביטול</Button>
              <Button type="submit" disabled={saving}>{saving ? "שומר..." : editing ? "עדכון" : "צור משימה"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת משימה</AlertDialogTitle>
            <AlertDialogDescription>האם למחוק את המשימה? פעולה זו בלתי הפיכה.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">מחק</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}