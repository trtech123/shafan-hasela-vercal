import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, Phone, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import InstructorFormDialog from "../components/instructors/InstructorFormDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const specialtyColors = {
  "הפעלת פארק": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "יום גיבוש": "bg-blue-50 text-blue-700 border-blue-200",
  "חוג טיפוס": "bg-amber-50 text-amber-700 border-amber-200",
  "סדנת שטח": "bg-purple-50 text-purple-700 border-purple-200",
};

export default function Instructors() {
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInstructor, setEditingInstructor] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const loadData = async () => {
    const { data, error } = await supabase
      .from('instructors')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('instructors fetch error:', error);
      toast.error('שגיאה בטעינת המדריכים');
      setInstructors([]);
    } else {
      setInstructors(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleDelete = async () => {
    const { error } = await supabase.from('instructors').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) {
      console.error('instructor delete error:', error);
      toast.error('שגיאה במחיקת המדריך');
      return;
    }
    toast.success('המדריך נמחק');
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
          <h1 className="text-3xl font-bold tracking-tight">מדריכים</h1>
          <p className="text-muted-foreground mt-1">{instructors.length} מדריכים במערכת</p>
        </div>
        <Button onClick={() => { setEditingInstructor(null); setDialogOpen(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> מדריך חדש
        </Button>
      </div>

      {instructors.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border shadow-sm p-12 text-center">
          <p className="text-muted-foreground mb-4">עדיין לא הוספת מדריכים</p>
          <Button onClick={() => { setEditingInstructor(null); setDialogOpen(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> הוסיפי מדריך ראשון
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {instructors.map(instructor => (
            <div key={instructor.id} className={cn(
              "bg-card rounded-2xl border border-border shadow-sm p-6 hover:shadow-md transition-all duration-300",
              instructor.status === "לא פעיל" && "opacity-60"
            )}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                    {instructor.full_name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold">{instructor.full_name}</h3>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full",
                      instructor.status === "פעיל" ? "text-emerald-600 bg-emerald-50" : "text-slate-500 bg-slate-100"
                    )}>
                      {instructor.status}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setEditingInstructor(instructor); setDialogOpen(true); }} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
                    <Pencil className="w-4 h-4 text-muted-foreground" />
                  </button>
                  <button onClick={() => setDeleteId(instructor.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 mb-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  <span dir="ltr">{instructor.phone}</span>
                </div>
                {instructor.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    <span className="truncate">{instructor.email}</span>
                  </div>
                )}
              </div>

              {instructor.specialties?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {instructor.specialties.map(spec => (
                    <span key={spec} className={cn(
                      "px-2 py-0.5 rounded-full text-xs font-medium border",
                      specialtyColors[spec] || "bg-muted text-muted-foreground border-border"
                    )}>
                      {spec}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <InstructorFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        instructor={editingInstructor}
        onSaved={loadData}
      />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת מדריך</AlertDialogTitle>
            <AlertDialogDescription>האם את בטוחה שברצונך למחוק את המדריך?</AlertDialogDescription>
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