import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { X, ImagePlus, Loader2 } from "lucide-react";

// Reuse the existing public bucket from 004_storage.sql — no new storage migration.
const STORAGE_BUCKET = "activity-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB (bucket limit)
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const SITES = ["טבריה", "עכו", "שטח", "ויה פרטה", "פודטראק", "קפה אקסטרים"];

function sanitizeFileName(name) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const safeBase = base.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60) || "img";
  return safeBase + ext.toLowerCase();
}

const emptyForm = { name: "", description: "", price: "", image_url: "", site: "", status: "פעיל" };

export default function ProductFormDialog({ open, onClose, product, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name || "",
        description: product.description || "",
        price: product.price ?? "",
        image_url: product.image_url || "",
        site: product.site || "",
        status: product.status || "פעיל",
      });
    } else {
      setForm(emptyForm);
    }
  }, [product, open]);

  const handleFileChange = async (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    if (file.type && !ALLOWED_IMAGE_MIME.has(file.type)) {
      toast.error("סוג קובץ לא נתמך (רק JPEG / PNG / WebP / GIF)");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("הקובץ גדול מדי (עד 5MB)");
      e.target.value = "";
      return;
    }
    setUploading(true);
    const path = `products/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
    const up = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
    if (up.error) {
      console.error("product image upload error:", up.error);
      toast.error("שגיאה בהעלאת התמונה");
    } else {
      const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(up.data.path);
      setForm((p) => ({ ...p, image_url: pub.publicUrl }));
      toast.success("תמונה הועלתה");
    }
    setUploading(false);
    e.target.value = "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const data = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: form.price === "" ? null : Number(form.price),
      image_url: form.image_url || null,
      site: form.site || null,
      status: form.status,
    };
    try {
      let error;
      if (product) {
        ({ error } = await supabase.from("products").update(data).eq("id", product.id));
      } else {
        ({ error } = await supabase.from("products").insert(data));
      }
      if (error) {
        console.error("save product error:", error);
        toast.error("שגיאה בשמירת המוצר");
        return;
      }
      toast.success(product ? "המוצר עודכן" : "המוצר נוצר");
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{product ? "עריכת מוצר" : "מוצר חדש"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <Label>שם המוצר *</Label>
            <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </div>
          <div>
            <Label>תיאור</Label>
            <Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>מחיר (₪)</Label>
              <Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} />
            </div>
            <div>
              <Label>אתר</Label>
              <Select value={form.site} onValueChange={(v) => setForm((p) => ({ ...p, site: v }))}>
                <SelectTrigger><SelectValue placeholder="בחר אתר" /></SelectTrigger>
                <SelectContent>
                  {SITES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Image upload (single) */}
          <div>
            <Label>תמונה</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleFileChange}
            />
            {form.image_url ? (
              <div className="relative mt-1 w-32">
                <img src={form.image_url} alt="product" className="w-32 h-32 object-cover rounded-lg" />
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, image_url: "" }))}
                  className="absolute top-1 left-1 bg-black/50 text-white rounded-full p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="mt-1 w-full flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl p-4 text-sm text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> מעלה...</> : <><ImagePlus className="w-4 h-4" /> העלאת תמונה</>}
              </button>
            )}
          </div>

          <div>
            <Label>סטטוס</Label>
            <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="פעיל">פעיל</SelectItem>
                <SelectItem value="לא פעיל">לא פעיל</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={saving || uploading}>
              {saving ? "שומר..." : product ? "עדכון" : "צור מוצר"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
