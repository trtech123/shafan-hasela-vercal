import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Trash2, CheckCircle2, Circle, Clock, AlertCircle } from "lucide-react";
import TaskFormDialog from "../components/tasks/TaskFormDialog";
import moment from "moment";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PRIORITY_STYLES = {
  "נמוכה":  "bg-slate-100 text-slate-600 border-slate-200",
  "בינונית": "bg-blue-50 text-blue-700 border-blue-200",
  "גבוהה":  "bg-amber-50 text-amber-700 border-amber-200",
  "דחופה":  "bg-red-50 text-red-700 border-red-200",
};

const STATUS_ICON = {
  "פתוחה":   <Circle className="w-4 h-4 text-slate-400" />,
  "בביצוע":  <Clock className="w-4 h-4 text-blue-500" />,
  "הושלמה": <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  "בוטלה":  <AlertCircle className="w-4 h-4 text-red-400" />,
};

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const loadData = async () => {
    const [{ data: t, error: eT }, { data: p, error: eP }] = await Promise.all([
      supabase.from('tasks').select('*').order('due_date', { ascending: false }).limit(200),
      supabase.from('profiles').select('id, full_name, email').order('full_name'),
    ]);
    if (eT) {
      console.error('tasks fetch error:', eT);
      toast.error('שגיאה בטעינת המשימות');
    }
    if (eP) console.error('profiles fetch error:', eP);
    setTasks(t ?? []);
    setProfiles(p ?? []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const profileById = useMemo(
    () => Object.fromEntries(profiles.map(p => [p.id, p])),
    [profiles]
  );
  const getProfileName = (id) => profileById[id]?.full_name || profileById[id]?.email || "—";

  const filtered = tasks.filter(t => {
    const assignedName = (profileById[t.assigned_to]?.full_name || t.legacy_assigned_to || "").toLowerCase();
    const matchSearch = !search || t.title?.toLowerCase().includes(search.toLowerCase()) || assignedName.includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleDelete = async () => {
    const { error } = await supabase.from('tasks').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) {
      console.error('task delete error:', error);
      toast.error('שגיאה במחיקת המשימה');
      return;
    }
    toast.success('המשימה נמחקה');
    loadData();
  };

  const toggleDone = async (task) => {
    const newStatus = task.status === "הושלמה" ? "פתוחה" : "הושלמה";
    const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', task.id);
    if (error) {
      console.error('task status update error:', error);
      toast.error('שגיאה בעדכון הסטטוס');
      return;
    }
    loadData();
  };

  const isOverdue = (t) => t.status !== "הושלמה" && t.status !== "בוטלה" && t.due_date && moment(t.due_date).isBefore(moment(), "day");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const openCount = tasks.filter(t => t.status === "פתוחה" || t.status === "בביצוע").length;

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">משימות</h1>
          <p className="text-muted-foreground mt-1">{openCount} משימות פתוחות</p>
        </div>
        <Button onClick={() => { setEditingTask(null); setDialogOpen(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> משימה חדשה
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="חיפוש לפי כותרת, אחראי..." value={search} onChange={e => setSearch(e.target.value)} className="pr-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסטטוסים</SelectItem>
            {["פתוחה","בביצוע","הושלמה","בוטלה"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="bg-card rounded-2xl border border-border shadow-sm p-12 text-center text-muted-foreground">
            לא נמצאו משימות
          </div>
        ) : (
          filtered.map(task => (
            <div
              key={task.id}
              className={cn(
                "bg-card rounded-xl border border-border shadow-sm p-4 flex items-center gap-4 transition-all hover:shadow-md",
                task.status === "הושלמה" && "opacity-60",
                isOverdue(task) && "border-red-200 bg-red-50/30"
              )}
            >
              <button onClick={() => toggleDone(task)} className="flex-shrink-0">
                {STATUS_ICON[task.status] || <Circle className="w-4 h-4 text-slate-400" />}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 flex-wrap">
                  <p className={cn("font-medium text-sm", task.status === "הושלמה" && "line-through text-muted-foreground")}>
                    {task.title}
                  </p>
                  {isOverdue(task) && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">באיחור</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                  {task.due_date && <span>📅 {moment(task.due_date).format("DD/MM/YY")}{task.due_time ? ` ${task.due_time}` : ""}</span>}
                  {task.assigned_to ? <span>👤 {getProfileName(task.assigned_to)}</span> : task.legacy_assigned_to ? <span>👤 {task.legacy_assigned_to} <span className="opacity-60">(לא משויך)</span></span> : null}
                  {task.category && <span>🏷️ {task.category}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {task.priority && (
                  <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", PRIORITY_STYLES[task.priority])}>
                    {task.priority}
                  </span>
                )}
                <button onClick={() => { setEditingTask(task); setDialogOpen(true); }} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
                  <Pencil className="w-4 h-4 text-muted-foreground" />
                </button>
                <button onClick={() => setDeleteId(task.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <TaskFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} task={editingTask} onSaved={loadData} profiles={profiles} />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת משימה</AlertDialogTitle>
            <AlertDialogDescription>האם את בטוחה שברצונך למחוק את המשימה? פעולה זו בלתי הפיכה.</AlertDialogDescription>
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