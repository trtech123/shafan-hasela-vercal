import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export default function LinkToLeadQuoteDialog({ open, onClose, onLink, currentLeadId, currentQuoteId }) {
  const [tab, setTab] = useState("lead");
  const [leads, setLeads] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('quotes').select('*').order('created_at', { ascending: false }).limit(100),
    ]).then(([{ data: l, error: eL }, { data: q, error: eQ }]) => {
      if (eL) console.error('leads fetch error:', eL);
      if (eQ) console.error('quotes fetch error:', eQ);
      setLeads(l ?? []);
      setQuotes(q ?? []);
      setLoading(false);
    });
  }, [open]);

  const filteredLeads = leads.filter(l =>
    (l.full_name || "").includes(search) || (l.company || "").includes(search) || (l.phone || "").includes(search)
  );

  const filteredQuotes = quotes.filter(q =>
    (q.client_name || "").includes(search) || (q.quote_number || "").includes(search)
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>קשר לליד / הצעת מחיר</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border pb-2">
          {["lead", "quote"].map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setSearch(""); }}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {t === "lead" ? "ליד" : "הצעת מחיר"}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute right-3 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש..."
            className="pr-9"
          />
        </div>

        <div className="max-h-72 overflow-y-auto space-y-1">
          {loading && <p className="text-center text-muted-foreground text-sm py-6">טוען...</p>}

          {tab === "lead" && filteredLeads.map(l => (
            <button
              key={l.id}
              onClick={() => onLink({ type: "lead", id: l.id, name: l.full_name, company: l.company })}
              className={`w-full text-right px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm ${currentLeadId === l.id ? "bg-primary/10 border border-primary/30" : ""}`}
            >
              <div className="font-medium">{l.full_name}</div>
              {l.company && <div className="text-xs text-muted-foreground">{l.company}</div>}
            </button>
          ))}

          {tab === "quote" && filteredQuotes.map(q => (
            <button
              key={q.id}
              onClick={() => onLink({ type: "quote", id: q.id, number: q.quote_number, name: q.client_name })}
              className={`w-full text-right px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm ${currentQuoteId === q.id ? "bg-primary/10 border border-primary/30" : ""}`}
            >
              <div className="font-medium">{q.client_name} {q.quote_number && `— ${q.quote_number}`}</div>
              {q.event_date && <div className="text-xs text-muted-foreground">{q.event_date}</div>}
            </button>
          ))}
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="outline" size="sm" onClick={() => onLink({ type: tab, id: null, name: null, number: null })}>
            נקה קישור
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>סגור</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}