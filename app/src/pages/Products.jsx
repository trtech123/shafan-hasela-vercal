import { useState, useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Loader2, Pencil, Trash2, Package, Search } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import ProductFormDialog from "@/components/products/ProductFormDialog";
import { CAFETERIA_CATEGORIES, filterProducts } from "@/lib/productCatalog";
import { Input } from "@/components/ui/input";

export default function Products({ cafeteria = false }) {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [searchByTab, setSearchByTab] = useState({ general: "", cafeteria: "" });
  const [category, setCategory] = useState("all");
  const tab = cafeteria ? 'cafeteria' : 'general';
  const search = searchByTab[tab];
  const visibleProducts = filterProducts(products, { cafeteria, search, category });
  const canAccess = user?.role === 'admin' || (cafeteria && user?.role === 'קופאי');

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("products fetch error:", error);
      toast.error("שגיאה בטעינת המוצרים");
    }
    setProducts(data ?? []);
    setLoading(false);
  };

  useEffect(() => { if (canAccess) load(); }, [canAccess]);

  if (user && !canAccess) return <Navigate to="/" replace />;

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (p) => { setEditing(p); setDialogOpen(true); };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { data, error } = await supabase.from("products").delete().eq("id", deleteTarget.id).select('id').single();
    if (error || !data?.id) {
      console.error("delete product error:", error);
      toast.error("מחיקת המוצר נכשלה");
    } else {
      toast.success("המוצר נמחק ✓");
      setDeleteTarget(null);
      await load();
    }
    setDeleting(false);
  };

  return (
    <div className="space-y-6" dir="rtl">
      {user?.role === "admin" && (
        <nav className="flex flex-wrap gap-2" aria-label="טאבי ניהול מוצרים">
          <Link to="/products" className={`rounded-lg px-4 py-2 text-sm font-medium ${!cafeteria ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>ניהול מוצרים</Link>
          <Link to="/cafeteria-products" className={`rounded-lg px-4 py-2 text-sm font-medium ${cafeteria ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>ניהול מוצרי קפיטריה</Link>
        </nav>
      )}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="w-6 h-6" /> {cafeteria ? 'ניהול מוצרי קפיטריה' : 'ניהול מוצרים'}</h1>
          <p className="text-sm text-muted-foreground mt-1">{cafeteria ? 'מוצרי קפיטריה לפי קטגוריה' : 'מוצרים כלליים שאינם משויכים לקפיטריה'}</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4" /> מוצר חדש</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input aria-label="חיפוש מוצר לפי שם" placeholder="חיפוש מוצר לפי שם" value={search} onChange={(e) => setSearchByTab((previous) => ({ ...previous, [tab]: e.target.value }))} className="pr-10" />
        </div>
        {cafeteria && <select aria-label="סינון קטגוריה" value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 w-full sm:w-48 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">כל הקטגוריות</option>
          {CAFETERIA_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin ml-2" /> טוען…
        </div>
      ) : visibleProducts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">{search || (cafeteria && category !== 'all') ? 'לא נמצאו מוצרים התואמים לחיפוש.' : 'אין מוצרים להצגה. ניתן ליצור מוצר חדש.'}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleProducts.map((p) => (
            <div key={p.id} className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
              {p.image_url ? (
                <img src={p.image_url} alt={p.name} className="w-full h-36 object-cover" />
              ) : (
                <div className="w-full h-36 bg-muted flex items-center justify-center text-muted-foreground">
                  <Package className="w-8 h-8 opacity-40" />
                </div>
              )}
              <div className="p-4 flex-1 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold">{p.name}</h3>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${p.status === "פעיל" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{p.status}</span>
                </div>
                {p.description && <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>}
                {p.cafeteria_category && <span className="text-xs text-muted-foreground">{p.cafeteria_category}</span>}
                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm font-semibold">{p.price != null ? `${Number(p.price).toLocaleString()}₪` : "—"}</span>
                  {p.site && <span className="text-[11px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full">{p.site}</span>}
                </div>
                <div className="flex gap-2 mt-3">
                  <Button variant="outline" size="sm" className="gap-1 flex-1" onClick={() => openEdit(p)}>
                    <Pencil className="w-3.5 h-3.5" /> עריכה
                  </Button>
                  <Button variant="ghost" size="icon" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setDeleteTarget(p)} title="מחק">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ProductFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        product={editing}
        cafeteriaMode={cafeteria}
        onSaved={load}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת מוצר</AlertDialogTitle>
            <AlertDialogDescription>
              למחוק את <strong>{deleteTarget?.name}</strong>? לחלופין ניתן להגדיר אותו כ"לא פעיל" בעריכה.
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
