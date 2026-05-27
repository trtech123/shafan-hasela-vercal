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

const STORAGE_BUCKET = "activity-images";
// Must match the `file_size_limit` set on the bucket in supabase/migrations/004_storage.sql.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function sanitizeFileName(name) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot)   : "";
  const safeBase = base.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60) || "img";
  return safeBase + ext.toLowerCase();
}

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

const categories = ["הפעלת פארק", "יום גיבוש", "חוג טיפוס", "סדנת שטח"];

const emptyForm = {
  name: "", category: "", description: "", duration_hours: "",
  max_participants: "", price_per_person: "", image_url: "", images: [], status: "פעיל",
};

export default function ActivityFormDialog({ open, onClose, activity, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (activity) {
      setForm({
        name: activity.name || "",
        category: activity.category || "",
        description: activity.description || "",
        duration_hours: activity.duration_hours || "",
        max_participants: activity.max_participants || "",
        price_per_person: activity.price_per_person || "",
        image_url: activity.image_url || "",
        images: activity.images || [],
        status: activity.status || "פעיל",
      });
    } else {
      setForm(emptyForm);
    }
  }, [activity, open]);

  const handleFilesChange = async (e) => {
    const allFiles = Array.from(e.target.files || []);
    if (!allFiles.length) return;

    // Client-side validation BEFORE upload. Bucket limit is 5 MB
    // (supabase/migrations/004_storage.sql). Reject early with a Hebrew toast
    // per file so the user knows exactly which file failed and why.
    const accepted = [];
    for (const file of allFiles) {
      if (file.type && !ALLOWED_IMAGE_MIME.has(file.type)) {
        toast.error(`${file.name}: סוג קובץ לא נתמך (רק JPEG / PNG / WebP / GIF)`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`${file.name}: גודל ${formatMB(file.size)}MB חורג מהמותר (עד ${formatMB(MAX_IMAGE_BYTES)}MB)`);
        continue;
      }
      accepted.push(file);
    }

    if (!accepted.length) {
      e.target.value = "";
      return;
    }

    setUploading(true);
    const uploaded = [];
    for (const file of accepted) {
      const path = `${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
      const up = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
      if (up.error) {
        console.error("activity image upload error:", up.error);
        const msg = String(up.error.message || "");
        if (/maximum allowed size|exceeded/i.test(msg)) {
          toast.error(`${file.name}: השרת דחה את הקובץ (חרג מהגודל המותר)`);
        } else if (/mime|content-type/i.test(msg)) {
          toast.error(`${file.name}: סוג קובץ נדחה על ידי השרת`);
        } else {
          toast.error(`שגיאה בהעלאת ${file.name}`);
        }
        continue;
      }
      const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(up.data.path);
      uploaded.push(pub.publicUrl);
    }

    if (uploaded.length) {
      setForm(prev => {
        const newImages = [...(prev.images || []), ...uploaded];
        return {
          ...prev,
          images: newImages,
          image_url: prev.image_url || newImages[0], // first image becomes main
        };
      });
      toast.success(`${uploaded.length === 1 ? "תמונה הועלתה" : `${uploaded.length} תמונות הועלו`}`);
    }
    setUploading(false);
    e.target.value = "";
  };

  const removeImage = (url) => {
    setForm(prev => {
      const newImages = prev.images.filter(u => u !== url);
      return {
        ...prev,
        images: newImages,
        image_url: prev.image_url === url ? (newImages[0] || "") : prev.image_url,
      };
    });
  };

  const setMain = (url) => {
    setForm(prev => ({ ...prev, image_url: url }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const data = {
      ...form,
      duration_hours: Number(form.duration_hours),
      max_participants: Number(form.max_participants),
      price_per_person: Number(form.price_per_person),
    };
    try {
      let error;
      if (activity) {
        ({ error } = await supabase.from('activities').update(data).eq('id', activity.id));
      } else {
        ({ error } = await supabase.from('activities').insert(data));
      }
      if (error) {
        console.error('save activity error:', error);
        toast.error('שגיאה בשמירת הפעילות');
        return;
      }
      toast.success(activity ? 'הפעילות עודכנה' : 'הפעילות נוצרה');
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
          <DialogTitle>{activity ? "עריכת פעילות" : "פעילות חדשה"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <Label>שם הפעילות *</Label>
            <Input value={form.name} onChange={e => setForm(p => ({...p, name: e.target.value}))} required />
          </div>
          <div>
            <Label>קטגוריה *</Label>
            <Select value={form.category} onValueChange={v => setForm(p => ({...p, category: v}))}>
              <SelectTrigger><SelectValue placeholder="בחר קטגוריה" /></SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>תיאור</Label>
            <Textarea value={form.description} onChange={e => setForm(p => ({...p, description: e.target.value}))} rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>משך (שעות) *</Label>
              <Input type="number" min="0.5" step="0.5" value={form.duration_hours} onChange={e => setForm(p => ({...p, duration_hours: e.target.value}))} required />
            </div>
            <div>
              <Label>מקס׳ משתתפים *</Label>
              <Input type="number" min="1" value={form.max_participants} onChange={e => setForm(p => ({...p, max_participants: e.target.value}))} required />
            </div>
            <div>
              <Label>מחיר לאדם *</Label>
              <Input type="number" min="0" value={form.price_per_person} onChange={e => setForm(p => ({...p, price_per_person: e.target.value}))} required />
            </div>
          </div>

          {/* Image upload */}
          <div>
            <Label>תמונות</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={handleFilesChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="mt-1 w-full flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl p-4 text-sm text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> מעלה תמונות...</>
              ) : (
                <><ImagePlus className="w-4 h-4" /> לחצי להעלאת תמונות (ניתן לבחור מרובות)</>
              )}
            </button>

            {form.images?.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {form.images.map((url, i) => (
                  <div key={i} className="relative group">
                    <img src={url} alt={`img-${i}`} className="w-full h-24 object-cover rounded-lg" />
                    {/* Main badge */}
                    {form.image_url === url ? (
                      <span className="absolute bottom-1 right-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                        ראשית
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setMain(url)}
                        className="absolute bottom-1 right-1 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        הגדר ראשית
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImage(url)}
                      className="absolute top-1 left-1 bg-black/50 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>סטטוס</Label>
            <Select value={form.status} onValueChange={v => setForm(p => ({...p, status: v}))}>
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
              {saving ? "שומר..." : activity ? "עדכון" : "צור פעילות"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}