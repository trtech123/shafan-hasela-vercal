import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Wand2, Trash2, Pencil, Check, X, Plus, Copy, FileText, Download } from "lucide-react";
import QuoteFormDialog from "@/components/quotes/QuoteFormDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_STYLES = {
  "פתוח":         "bg-blue-100 text-blue-800 border-blue-200",
  "נשלח":         "bg-yellow-100 text-yellow-800 border-yellow-200",
  "נסגר":         "bg-green-100 text-green-800 border-green-200",
  "לא רלוונטי":  "bg-slate-100 text-slate-500 border-slate-200",
};

const STATUS_OPTIONS = ["פתוח", "נשלח", "נסגר", "לא רלוונטי"];
const SITE_OPTIONS = ["עכו", "טבריה", "נוף הגליל", "שטח", "ויה פרטה", "פודטראק", "קפה אקסטרים"];
const CUSTOMER_TYPE_OPTIONS = ["סוכן", "מפיק", "חינוכית", "חברה"];
const DATE_OPTIONS = ["הכל", "היום", "השבוע", "החודש", "טווח תאריכים"];

// Local date → "YYYY-MM-DD" (matches the format event_date is stored/returned as).
function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CUSTOMER_TYPE_STYLES = {
  "סוכן":    "bg-purple-100 text-purple-800 border-purple-200",
  "מפיק":    "bg-orange-100 text-orange-800 border-orange-200",
  "חינוכית": "bg-teal-100 text-teal-800 border-teal-200",
  "חברה":    "bg-indigo-100 text-indigo-800 border-indigo-200",
};

const CURRENT_YEAR = new Date().getFullYear();

// Parses free-text date like "14/6", "14.6", "14 ביוני", "14/6/2025" → "YYYY-MM-DD"
function parseFreeDate(text) {
  if (!text || !text.trim()) return "";
  const months = {
    "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4,
    "מאי": 5, "יוני": 6, "יולי": 7, "אוגוסט": 8,
    "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
  };
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  let m = t.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  m = t.match(/^(\d{1,2})[\/\.](\d{1,2})$/);
  if (m) return `${CURRENT_YEAR}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\s+(?:ב)?([א-ת]+)(?:\s+(\d{4}))?$/);
  if (m) {
    const monthNum = months[m[2].toLowerCase()];
    if (monthNum) {
      const y = m[3] ? Number(m[3]) : CURRENT_YEAR;
      return `${y}-${String(monthNum).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Client-side lead parser — replaces the old hosted LLM text-extraction call.
//
// TODO: upgrade to Supabase Edge Function calling Claude API for better accuracy.
//       Edge Function path: supabase/functions/parse-lead/index.ts
//       The function should accept { text } and return { full_name, phone, email, company }.
// ---------------------------------------------------------------------------
function parseLeadFromText(text) {
  const result = { full_name: "", phone: "", email: "", company: "" };

  // Email — standard pattern
  const emailMatch = text.match(/[\w.\-+]+@[\w.\-]+\.[a-z]{2,}/i);
  if (emailMatch) result.email = emailMatch[0];

  // Israeli phone — 05X-XXXXXXX, 05XXXXXXXXX, +972-5X-XXXXXXX
  const phoneMatch = text.match(/(?:\+972[-\s]?)?0?5\d[-\s]?\d{3}[-\s]?\d{4}/);
  if (phoneMatch) result.phone = phoneMatch[0].replace(/\s/g, "");

  // Company — "מחברת X" / "חברת X" / "ארגון X" / "עמותת X"
  const companyMatch = text.match(/(?:מחברת|חברת|ארגון|עמותת|מ-?)\s+([א-ת\w\-"'.]+(?:\s+[א-ת\w\-"'.]+){0,3})/);
  if (companyMatch) result.company = companyMatch[1].trim();

  // Name — "אני X Y" / "שמי X" / first Hebrew words on first line
  const namePatterns = [
    text.match(/(?:אני|שמי|קוראים לי)\s+([א-ת]+(?:\s+[א-ת]+)?)/),
    text.match(/^([א-ת]+(?:\s+[א-ת]+){1,2})/m),
  ];
  for (const m of namePatterns) {
    if (m) { result.full_name = m[1].trim(); break; }
  }

  return result;
}

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [filterStatus, setFilterStatus] = useState("הכל");
  const [filterSite, setFilterSite] = useState("הכל");
  const [filterCustomerType, setFilterCustomerType] = useState("הכל");
  const [searchText, setSearchText] = useState("");
  const [filterDate, setFilterDate] = useState("הכל");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [quoteLeadData, setQuoteLeadData] = useState(null);

  useEffect(() => { loadLeads(); }, []);

  const loadLeads = async () => {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) console.error('leads fetch error:', error);
      setLeads(data ?? []);
    } catch (err) {
      console.error('loadLeads error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleParse = async () => {
    if (!pasteText.trim()) return;
    setParsing(true);
    try {
      const parsed = parseLeadFromText(pasteText);
      const { data, error } = await supabase
        .from('leads')
        .insert({ ...parsed, status: "פתוח", source_text: pasteText })
        .select()
        .single();
      if (error) { console.error('create lead error:', error); toast.error('שגיאה ביצירת הליד'); return; }
      setLeads(prev => [data, ...prev]);
      setPasteText("");
      toast.success('ליד נוצר מהטקסט');
    } catch (err) {
      console.error('handleParse error:', err);
      toast.error('שגיאה בניתוח הטקסט');
    } finally {
      setParsing(false);
    }
  };

  const handleDelete = async (id) => {
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) { console.error('delete lead error:', error); return; }
    setLeads(prev => prev.filter(l => l.id !== id));
  };

  const startEdit = (lead) => {
    setEditingId(lead.id);
    setEditData({
      full_name: lead.full_name, phone: lead.phone, email: lead.email,
      company: lead.company, notes: lead.notes, status: lead.status,
      site: lead.site || "", event_date: lead.event_date || "",
      customer_type: lead.customer_type || "",
    });
  };

  const updateSite = async (id, site) => {
    // "" from the "—" option violates leads_site_check (TEXT CHECK list).
    // Column is nullable; null passes the check.
    const value = site || null;
    const { error } = await supabase.from('leads').update({ site: value }).eq('id', id);
    if (error) { console.error('updateSite error:', error); return; }
    setLeads(prev => prev.map(l => l.id === id ? { ...l, site: value } : l));
  };

  const updateCustomerType = async (id, customer_type) => {
    // "" from the "ללא סיווג" option violates leads_customer_type_check.
    // Column is nullable; null passes the check.
    const value = customer_type || null;
    const { error } = await supabase.from('leads').update({ customer_type: value }).eq('id', id);
    if (error) { console.error('updateCustomerType error:', error); return; }
    setLeads(prev => prev.map(l => l.id === id ? { ...l, customer_type: value } : l));
  };

  const updateDate = async (id, event_date) => {
    // "" from a cleared date input is rejected by Postgres DATE type.
    const value = event_date || null;
    const { error } = await supabase.from('leads').update({ event_date: value }).eq('id', id);
    if (error) { console.error('updateDate error:', error); return; }
    setLeads(prev => prev.map(l => l.id === id ? { ...l, event_date: value } : l));
  };

  const updateStatus = async (id, status) => {
    const { error } = await supabase.from('leads').update({ status }).eq('id', id);
    if (error) { console.error('updateStatus error:', error); return; }
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l));
  };

  const saveEdit = async (id) => {
    // Normalize empty strings on typed / CHECK-constrained columns. Postgres
    // rejects "" for DATE, TIME, UUID and any TEXT column whose CHECK list
    // doesn't include "". `site` (leads_site_check) and `event_date` (DATE)
    // can both be cleared from the inline editor.
    const payload = {
      ...editData,
      site: editData.site || null,
      event_date: editData.event_date || null,
      customer_type: editData.customer_type || null,
    };
    const { error } = await supabase.from('leads').update(payload).eq('id', id);
    if (error) { console.error('saveEdit error:', error); toast.error('שגיאה בשמירה'); return; }
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...payload } : l));
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  const handleAddManual = async () => {
    const { data, error } = await supabase
      .from('leads')
      .insert({ full_name: "ליד חדש", status: "פתוח" })
      .select()
      .single();
    if (error) { console.error('create lead error:', error); return; }
    setLeads(prev => [data, ...prev]);
    startEdit(data);
  };

  const openQuoteFromLead = (lead) => {
    setQuoteLeadData({
      client_name: lead.full_name || "",
      client_phone: lead.phone || "",
      client_email: lead.email || "",
      organization: lead.company || "",
      event_date: lead.event_date || "",
      site: lead.site || "",
    });
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success("הועתק!");
  };

  const handleExportCsv = () => {
    if (filtered.length === 0) return;
    const headers = ["מספר", "שם מלא", "טלפון", "אימייל", "חברה", "סוג לקוח", "אתר", "סטטוס", "תאריך אירוע", "מקור", "הערות"];
    // Quote every field; double embedded quotes. Handles commas/newlines (e.g. source_text).
    const esc = (v) => `"${(v == null ? "" : String(v)).replace(/"/g, '""')}"`;
    const rows = filtered.map((l, i) =>
      [i + 1, l.full_name, l.phone, l.email, l.company, l.customer_type, l.site, l.status, l.event_date, l.source_text, l.notes]
        .map(esc).join(",")
    );
    // ﻿ BOM so Excel reads UTF-8 Hebrew correctly. CRLF line endings.
    const csv = "﻿" + [headers.map(esc).join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads_${toYMD(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const q = searchText.trim().toLowerCase();
  const matchesSearch = (l) => {
    if (!q) return true;
    return [l.full_name, l.phone, l.email, l.company, l.notes, l.source_text]
      .some(v => (v || "").toLowerCase().includes(q));
  };
  const matchesCustomerType = (l) =>
    filterCustomerType === "הכל" ||
    (filterCustomerType === "ללא סיווג" ? !l.customer_type : l.customer_type === filterCustomerType);

  // Date boundaries (local). event_date is "YYYY-MM-DD" so lexical compare is safe.
  const _now = new Date();
  const todayStr = toYMD(_now);
  const monthStr = todayStr.slice(0, 7); // "YYYY-MM"
  const _weekStart = new Date(_now); _weekStart.setDate(_now.getDate() - _now.getDay()); // Sunday
  const _weekEnd = new Date(_weekStart); _weekEnd.setDate(_weekStart.getDate() + 6);     // Saturday
  const weekStartStr = toYMD(_weekStart);
  const weekEndStr = toYMD(_weekEnd);
  const matchesDate = (l) => {
    if (filterDate === "הכל") return true;
    if (!l.event_date) return false; // null event_date appears only under "הכל"
    const d = l.event_date;
    if (filterDate === "היום") return d === todayStr;
    if (filterDate === "השבוע") return d >= weekStartStr && d <= weekEndStr;
    if (filterDate === "החודש") return d.startsWith(monthStr);
    if (filterDate === "טווח תאריכים") {
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    }
    return true;
  };

  const filtered = leads.filter(l =>
    (filterStatus === "הכל" || l.status === filterStatus) &&
    (filterSite === "הכל" || l.site === filterSite) &&
    matchesCustomerType(l) &&
    matchesDate(l) &&
    matchesSearch(l)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">לידים</h1>
        <p className="text-muted-foreground mt-1">ניהול לקוחות פוטנציאליים</p>
      </div>

      {/* Paste & Parse */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
        <p className="font-semibold text-sm">הדבק טקסט מוואטסאפ / מייל / רשתות חברתיות</p>
        <Textarea
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          placeholder="למשל: היי, אני דנה כהן מחברת אלפא, מספרי 052-1234567, דנה@אלפא.com, מעוניינת ביום גיבוש ל-30 איש..."
          className="min-h-[90px] text-sm"
        />
        <div className="flex gap-2">
          <Button onClick={handleParse} disabled={parsing || !pasteText.trim()} className="gap-2">
            {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {parsing ? "מנתח..." : "נתח וסדר אוטומטית"}
          </Button>
          <Button variant="outline" onClick={handleAddManual} className="gap-2">
            <Plus className="w-4 h-4" /> הוסף ידנית
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex gap-2 flex-wrap items-center">
          <Input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="חיפוש לפי שם, טלפון, אימייל, חברה, הערות..."
            className="h-9 text-sm max-w-sm"
          />
          {searchText && (
            <Button variant="ghost" size="sm" className="h-9 gap-1" onClick={() => setSearchText("")}>
              <X className="w-3.5 h-3.5" /> נקה
            </Button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs font-semibold text-muted-foreground">סוג לקוח:</span>
          {["הכל", ...CUSTOMER_TYPE_OPTIONS, "ללא סיווג"].map(s => (
            <button
              key={s}
              onClick={() => setFilterCustomerType(s)}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
                filterCustomerType === s
                  ? s === "הכל"
                    ? "bg-slate-800 text-white border-slate-800"
                    : s === "ללא סיווג"
                      ? "bg-slate-200 text-slate-700 border-slate-300 shadow-sm"
                      : cn(CUSTOMER_TYPE_STYLES[s], "shadow-sm")
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {s} ({s === "הכל"
                ? leads.length
                : s === "ללא סיווג"
                  ? leads.filter(l => !l.customer_type).length
                  : leads.filter(l => l.customer_type === s).length})
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs font-semibold text-muted-foreground">סטטוס:</span>
          {["הכל", ...STATUS_OPTIONS].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
                filterStatus === s
                  ? s === "הכל" ? "bg-slate-800 text-white border-slate-800" : cn(STATUS_STYLES[s], "shadow-sm")
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {s} {s !== "הכל" && `(${leads.filter(l => l.status === s).length})`}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs font-semibold text-muted-foreground">אתר:</span>
          {["הכל", ...SITE_OPTIONS].map(s => (
            <button
              key={s}
              onClick={() => setFilterSite(s)}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
                filterSite === s
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs font-semibold text-muted-foreground">תאריך אירוע:</span>
          {DATE_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => setFilterDate(s)}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
                filterDate === s
                  ? s === "הכל"
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {s}
            </button>
          ))}
          {filterDate === "טווח תאריכים" && (
            <div className="flex gap-2 items-center">
              <span className="text-xs text-muted-foreground">מ־</span>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 text-sm w-auto" />
              <span className="text-xs text-muted-foreground">עד</span>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 text-sm w-auto" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">{filtered.length} לידים</span>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
          >
            <Download className="w-4 h-4" /> ייצוא ל-CSV
          </Button>
        </div>
      </div>

      {/* Table (desktop / md+) */}
      <div className="hidden md:block bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">שם מלא</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">טלפון</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">אימייל</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">חברה</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">סוג לקוח</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">אתר</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">תאריך</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">סטטוס</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">הערות</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-muted-foreground">אין לידים להצגה</td>
                </tr>
              )}
              {filtered.map(lead => (
                <tr key={lead.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  {editingId === lead.id ? (
                    <>
                      <td className="px-4 py-2"><Input value={editData.full_name || ""} onChange={e => setEditData(p => ({ ...p, full_name: e.target.value }))} className="h-8 text-sm" /></td>
                      <td className="px-4 py-2"><Input value={editData.phone || ""} onChange={e => setEditData(p => ({ ...p, phone: e.target.value }))} className="h-8 text-sm" /></td>
                      <td className="px-4 py-2"><Input value={editData.email || ""} onChange={e => setEditData(p => ({ ...p, email: e.target.value }))} className="h-8 text-sm" /></td>
                      <td className="px-4 py-2"><Input value={editData.company || ""} onChange={e => setEditData(p => ({ ...p, company: e.target.value }))} className="h-8 text-sm" /></td>
                      <td className="px-4 py-2">
                        <select
                          value={editData.customer_type || ""}
                          onChange={e => setEditData(p => ({ ...p, customer_type: e.target.value }))}
                          className="h-8 text-sm rounded-md border border-input bg-background px-2"
                        >
                          <option value="">ללא סיווג</option>
                          {CUSTOMER_TYPE_OPTIONS.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={editData.site || ""}
                          onChange={e => setEditData(p => ({ ...p, site: e.target.value }))}
                          className="h-8 text-sm rounded-md border border-input bg-background px-2"
                        >
                          <option value="">—</option>
                          {SITE_OPTIONS.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2"><Input type="date" value={editData.event_date || ""} onChange={e => setEditData(p => ({ ...p, event_date: e.target.value }))} className="h-8 text-sm" /></td>
                      <td className="px-4 py-2">
                        <select
                          value={editData.status}
                          onChange={e => setEditData(p => ({ ...p, status: e.target.value }))}
                          className="h-8 text-sm rounded-md border border-input bg-background px-2"
                        >
                          {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2"><Input value={editData.notes || ""} onChange={e => setEditData(p => ({ ...p, notes: e.target.value }))} className="h-8 text-sm" /></td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <Button size="icon" className="h-7 w-7" onClick={() => saveEdit(lead.id)}><Check className="w-3.5 h-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit}><X className="w-3.5 h-3.5" /></Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 font-medium">
                        <div className="flex items-center gap-1 group">
                          {lead.full_name || "—"}
                          {lead.full_name && <button onClick={() => copyToClipboard(lead.full_name)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"><Copy className="w-3 h-3" /></button>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div className="flex items-center gap-1 group">
                          {lead.phone || "—"}
                          {lead.phone && <button onClick={() => copyToClipboard(lead.phone)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"><Copy className="w-3 h-3" /></button>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div className="flex items-center gap-1 group">
                          {lead.email || "—"}
                          {lead.email && <button onClick={() => copyToClipboard(lead.email)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"><Copy className="w-3 h-3" /></button>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div className="flex items-center gap-1 group">
                          {lead.company || "—"}
                          {lead.company && <button onClick={() => copyToClipboard(lead.company)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"><Copy className="w-3 h-3" /></button>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={lead.customer_type || ""}
                          onChange={e => updateCustomerType(lead.id, e.target.value)}
                          className={cn(
                            "text-xs font-medium rounded-full px-2 py-1 border cursor-pointer",
                            lead.customer_type
                              ? CUSTOMER_TYPE_STYLES[lead.customer_type]
                              : "bg-slate-100 text-slate-500 border-slate-200"
                          )}
                        >
                          <option value="">ללא סיווג</option>
                          {CUSTOMER_TYPE_OPTIONS.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={lead.site || ""}
                          onChange={e => updateSite(lead.id, e.target.value)}
                          className="text-xs rounded-md border border-input bg-background px-2 py-1 cursor-pointer text-muted-foreground"
                        >
                          <option value="">—</option>
                          {SITE_OPTIONS.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="date"
                          value={lead.event_date || ""}
                          onChange={e => updateDate(lead.id, e.target.value)}
                          className="text-xs rounded-md border border-input bg-background px-2 py-1 cursor-pointer text-muted-foreground"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={lead.status}
                          onChange={e => updateStatus(lead.id, e.target.value)}
                          className={cn(
                            "text-xs font-medium rounded-full px-2 py-1 border cursor-pointer",
                            STATUS_STYLES[lead.status] || "bg-slate-100 text-slate-600 border-slate-200"
                          )}
                        >
                          {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs max-w-[180px] truncate">{lead.notes || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-600 hover:text-blue-700" title="צור הצעת מחיר" onClick={() => openQuoteFromLead(lead)}><FileText className="w-3.5 h-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(lead)}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(lead.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cards (mobile / below md) */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 && (
          <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground">
            אין לידים להצגה
          </div>
        )}
        {filtered.map(lead => (
          <div key={lead.id} className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3">
            {editingId === lead.id ? (
              <div className="space-y-2">
                <Input value={editData.full_name || ""} onChange={e => setEditData(p => ({ ...p, full_name: e.target.value }))} placeholder="שם מלא" className="text-sm" />
                <Input value={editData.phone || ""} onChange={e => setEditData(p => ({ ...p, phone: e.target.value }))} placeholder="טלפון" className="text-sm" />
                <Input value={editData.email || ""} onChange={e => setEditData(p => ({ ...p, email: e.target.value }))} placeholder="אימייל" className="text-sm" />
                <Input value={editData.company || ""} onChange={e => setEditData(p => ({ ...p, company: e.target.value }))} placeholder="חברה" className="text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={editData.customer_type || ""}
                    onChange={e => setEditData(p => ({ ...p, customer_type: e.target.value }))}
                    className="h-9 text-sm rounded-md border border-input bg-background px-2"
                  >
                    <option value="">ללא סיווג</option>
                    {CUSTOMER_TYPE_OPTIONS.map(s => <option key={s}>{s}</option>)}
                  </select>
                  <select
                    value={editData.site || ""}
                    onChange={e => setEditData(p => ({ ...p, site: e.target.value }))}
                    className="h-9 text-sm rounded-md border border-input bg-background px-2"
                  >
                    <option value="">— אתר —</option>
                    {SITE_OPTIONS.map(s => <option key={s}>{s}</option>)}
                  </select>
                  <Input type="date" value={editData.event_date || ""} onChange={e => setEditData(p => ({ ...p, event_date: e.target.value }))} className="text-sm" />
                  <select
                    value={editData.status}
                    onChange={e => setEditData(p => ({ ...p, status: e.target.value }))}
                    className="h-9 text-sm rounded-md border border-input bg-background px-2"
                  >
                    {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <Input value={editData.notes || ""} onChange={e => setEditData(p => ({ ...p, notes: e.target.value }))} placeholder="הערות" className="text-sm" />
                <div className="flex gap-2">
                  <Button className="flex-1 gap-2" onClick={() => saveEdit(lead.id)}><Check className="w-4 h-4" /> שמור</Button>
                  <Button variant="outline" className="flex-1 gap-2" onClick={cancelEdit}><X className="w-4 h-4" /> ביטול</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-base">{lead.full_name || "—"}</div>
                  <div className="flex flex-wrap gap-1 justify-end shrink-0">
                    <span className={cn(
                      "text-xs font-medium rounded-full px-2 py-0.5 border",
                      lead.customer_type ? CUSTOMER_TYPE_STYLES[lead.customer_type] : "bg-slate-100 text-slate-500 border-slate-200"
                    )}>
                      {lead.customer_type || "ללא סיווג"}
                    </span>
                    <span className={cn(
                      "text-xs font-medium rounded-full px-2 py-0.5 border",
                      STATUS_STYLES[lead.status] || "bg-slate-100 text-slate-600 border-slate-200"
                    )}>
                      {lead.status}
                    </span>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground space-y-1">
                  {lead.phone && <div className="flex justify-between gap-2"><span>טלפון</span><a href={`tel:${lead.phone}`} className="text-foreground">{lead.phone}</a></div>}
                  {lead.email && <div className="flex justify-between gap-2"><span>אימייל</span><span className="text-foreground truncate max-w-[60%]">{lead.email}</span></div>}
                  {lead.company && <div className="flex justify-between gap-2"><span>חברה</span><span className="text-foreground">{lead.company}</span></div>}
                  {lead.site && <div className="flex justify-between gap-2"><span>אתר</span><span className="text-foreground">{lead.site}</span></div>}
                  {lead.event_date && <div className="flex justify-between gap-2"><span>תאריך אירוע</span><span className="text-foreground">{lead.event_date}</span></div>}
                </div>
                {(lead.notes || lead.source_text) && (
                  <div className="text-xs text-muted-foreground border-t border-border/50 pt-2 line-clamp-3">
                    {lead.notes || lead.source_text}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" className="flex-1 gap-2 h-10 text-blue-600" onClick={() => openQuoteFromLead(lead)}><FileText className="w-4 h-4" /> הצעה</Button>
                  <Button variant="outline" className="flex-1 gap-2 h-10" onClick={() => startEdit(lead)}><Pencil className="w-4 h-4" /> ערוך</Button>
                  <Button variant="outline" className="gap-2 h-10 text-destructive" onClick={() => handleDelete(lead.id)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {quoteLeadData && (
        <QuoteFormDialog
          open={!!quoteLeadData}
          onClose={() => setQuoteLeadData(null)}
          quote={null}
          prefill={quoteLeadData}
          onSaved={() => setQuoteLeadData(null)}
        />
      )}
    </div>
  );
}
