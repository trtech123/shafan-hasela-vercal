import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { UserPlus, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";

// DB enum → Hebrew label. instructor shown for visibility only (legacy users).
const ROLE_LABELS = {
  admin: "מנהל",
  operations: 'אחמ"ש',
  cashier: "קופאי",
  instructor: "מדריך",
};

// Roles the admin may CREATE or ASSIGN. instructor intentionally excluded.
const ASSIGNABLE_ROLES = ["admin", "operations", "cashier"];

const emptyForm = { email: "", password: "", full_name: "", role: "operations" };

export default function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Page-level guard — non-admins never reach the data.
  if (user && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  const loadUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, created_at")
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("שגיאה בטעינת המשתמשים");
    } else {
      setUsers(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password || !form.full_name) {
      toast.error("נא למלא את כל השדות");
      return;
    }
    if (form.password.length < 6) {
      toast.error("סיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-user", {
        body: {
          email: form.email.trim(),
          password: form.password,
          full_name: form.full_name.trim(),
          role: form.role,
        },
      });
      // invoke() resolves with an error for non-2xx; the function body is in error.context
      if (error) {
        let msg = "יצירת המשתמש נכשלה";
        try {
          const body = await error.context?.json?.();
          if (body?.error) msg = body.error;
        } catch { /* keep generic */ }
        toast.error(msg);
        return;
      }
      if (!data?.ok) {
        toast.error(data?.error || "יצירת המשתמש נכשלה");
        return;
      }
      toast.success("המשתמש נוצר ✓");
      setForm(emptyForm);
      await loadUsers();
    } catch (err) {
      toast.error("יצירת המשתמש נכשלה");
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (row, newRole) => {
    if (newRole === row.role) return;
    setSavingId(row.id);
    const { error } = await supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("id", row.id);
    if (error) {
      toast.error("עדכון התפקיד נכשל");
    } else {
      toast.success("התפקיד עודכן ✓");
      setUsers((prev) =>
        prev.map((u) => (u.id === row.id ? { ...u, role: newRole } : u)),
      );
    }
    setSavingId(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    // Defense-in-depth: never delete self (also blocked in the function).
    if (deleteTarget.id === user?.id) {
      setDeleteTarget(null);
      return;
    }
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-user", {
        body: { userId: deleteTarget.id },
      });
      if (error) {
        let msg = "מחיקת המשתמש נכשלה";
        try {
          const body = await error.context?.json?.();
          if (body?.error) msg = body.error;
        } catch { /* keep generic */ }
        toast.error(msg);
        return;
      }
      if (!data?.ok) {
        toast.error(data?.error || "מחיקת המשתמש נכשלה");
        return;
      }
      toast.success("המשתמש נמחק ✓");
      setDeleteTarget(null);
      await loadUsers();
    } catch (err) {
      toast.error("מחיקת המשתמש נכשלה");
    } finally {
      setDeleting(false);
    }
  };

  const fmtDate = (d) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("he-IL");
    } catch {
      return "—";
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">ניהול משתמשים</h1>
        <p className="text-sm text-muted-foreground mt-1">
          יצירת משתמשים חדשים וניהול תפקידים. גישה למנהלים בלבד.
        </p>
      </div>

      {/* Create form */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <UserPlus className="w-5 h-5" /> משתמש חדש
        </h2>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>שם מלא</Label>
            <Input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="ישראל ישראלי"
            />
          </div>
          <div className="space-y-1.5">
            <Label>אימייל</Label>
            <Input
              type="email"
              dir="ltr"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="user@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>סיסמה</Label>
            <Input
              type="password"
              dir="ltr"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="לפחות 6 תווים"
            />
          </div>
          <div className="space-y-1.5">
            <Label>תפקיד</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={creating} className="gap-2">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              צור משתמש
            </Button>
          </div>
        </form>
      </div>

      {/* Users list */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="text-lg font-semibold mb-4">משתמשים קיימים</h2>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin ml-2" /> טוען…
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">אין משתמשים.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-muted-foreground border-b border-border">
                  <th className="py-2 px-2 font-medium">שם מלא</th>
                  <th className="py-2 px-2 font-medium">אימייל</th>
                  <th className="py-2 px-2 font-medium">תפקיד</th>
                  <th className="py-2 px-2 font-medium">נוצר</th>
                  <th className="py-2 px-2 font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => {
                  const isSelf = row.id === user?.id;
                  return (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="py-2.5 px-2">{row.full_name || "—"}</td>
                      <td className="py-2.5 px-2" dir="ltr">{row.email || "—"}</td>
                      <td className="py-2.5 px-2">
                        {isSelf ? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            {ROLE_LABELS[row.role] || row.role} (אתה)
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Select
                              value={ASSIGNABLE_ROLES.includes(row.role) ? row.role : undefined}
                              onValueChange={(v) => handleRoleChange(row, v)}
                              disabled={savingId === row.id}
                            >
                              <SelectTrigger className="w-32 h-8">
                                <SelectValue
                                  placeholder={ROLE_LABELS[row.role] || row.role}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {ASSIGNABLE_ROLES.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {ROLE_LABELS[r]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {savingId === row.id && (
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-muted-foreground">{fmtDate(row.created_at)}</td>
                      <td className="py-2.5 px-2">
                        {isSelf ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteTarget(row)}
                            title="מחק משתמש"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת משתמש</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-right">
                <p>
                  למחוק את <strong>{deleteTarget?.full_name || deleteTarget?.email}</strong>
                  {deleteTarget?.email ? <span dir="ltr"> ({deleteTarget.email})</span> : null}?
                </p>
                <ul className="list-disc pr-5 space-y-1 text-sm">
                  <li>המשתמש לא יוכל להתחבר יותר.</li>
                  <li>רשומות עבר כמו הזמנות/קופה לא יימחקו.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 gap-2"
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
              מחק
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
