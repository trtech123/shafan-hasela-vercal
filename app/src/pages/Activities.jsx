import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, Clock, Users, Banknote, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import ActivityFormDialog from "../components/activities/ActivityFormDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const categoryColors = {
  "הפעלת פארק": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "יום גיבוש": "bg-blue-50 text-blue-700 border-blue-200",
  "חוג טיפוס": "bg-amber-50 text-amber-700 border-amber-200",
  "סדנת שטח": "bg-purple-50 text-purple-700 border-purple-200",
  "מזון": "bg-rose-50 text-rose-700 border-rose-200",
};

const CATEGORIES = Object.keys(categoryColors);

export default function Activities() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadData = async () => {
    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('activities fetch error:', error);
      toast.error('שגיאה בטעינת הפעילויות');
      setActivities([]);
    } else {
      setActivities(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return activities.filter(a => {
      const matchSearch = !search ||
        a.name?.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q);
      const matchCategory = categoryFilter === "all" || a.category === categoryFilter;
      const matchStatus = statusFilter === "all" || a.status === statusFilter;
      return matchSearch && matchCategory && matchStatus;
    });
  }, [activities, search, categoryFilter, statusFilter]);

  const handleDelete = async () => {
    const { error } = await supabase.from('activities').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) {
      console.error('activity delete error:', error);
      toast.error('שגיאה במחיקת הפעילות');
      return;
    }
    toast.success('הפעילות נמחקה');
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">פעילויות</h1>
          <p className="text-muted-foreground mt-1">ניהול סוגי הפעילויות שלך</p>
        </div>
        <Button onClick={() => { setEditingActivity(null); setDialogOpen(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> פעילות חדשה
        </Button>
      </div>

      {activities.length > 0 && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="חיפוש לפי שם או תיאור..." value={search} onChange={e => setSearch(e.target.value)} className="pr-10" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">קטגוריה:</span>
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                categoryFilter === "all"
                  ? "bg-slate-100 text-slate-700 border-slate-300 shadow-sm"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              )}
            >הכל</button>
            {CATEGORIES.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoryFilter(c)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                  categoryFilter === c
                    ? "bg-primary/10 text-primary border-primary/30 shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:bg-muted"
                )}
              >{c}</button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">סטטוס:</span>
            {[
              { key: "all", label: "הכל" },
              { key: "פעיל", label: "פעיל" },
              { key: "לא פעיל", label: "לא פעיל" },
            ].map(s => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStatusFilter(s.key)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                  statusFilter === s.key
                    ? "bg-primary/10 text-primary border-primary/30 shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:bg-muted"
                )}
              >{s.label}</button>
            ))}
          </div>
        </div>
      )}

      {activities.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border shadow-sm p-12 text-center">
          <p className="text-muted-foreground mb-4">עדיין לא הוספת פעילויות</p>
          <Button onClick={() => { setEditingActivity(null); setDialogOpen(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> הוסיפי פעילות ראשונה
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border shadow-sm p-12 text-center text-muted-foreground">
          לא נמצאו פעילויות התואמות לסינון
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(activity => (
            <div key={activity.id} className={cn(
              "bg-card rounded-2xl border border-border shadow-sm p-6 hover:shadow-md transition-all duration-300",
              activity.status === "לא פעיל" && "opacity-60"
            )}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-bold text-lg">{activity.name}</h3>
                  <span className={cn(
                    "inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border mt-1",
                    categoryColors[activity.category] || "bg-muted text-muted-foreground border-border"
                  )}>
                    {activity.category}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setEditingActivity(activity); setDialogOpen(true); }} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
                    <Pencil className="w-4 h-4 text-muted-foreground" />
                  </button>
                  <button onClick={() => setDeleteId(activity.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>

              {activity.description && (
                <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{activity.description}</p>
              )}

              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" />{activity.duration_hours} שעות</span>
                <span className="flex items-center gap-1.5"><Users className="w-4 h-4" />עד {activity.max_participants}</span>
                <span className="flex items-center gap-1.5"><Banknote className="w-4 h-4" />₪{activity.price_per_person}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <ActivityFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} activity={editingActivity} onSaved={loadData} />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת פעילות</AlertDialogTitle>
            <AlertDialogDescription>האם את בטוחה שברצונך למחוק את הפעילות? פעולה זו בלתי הפיכה.</AlertDialogDescription>
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