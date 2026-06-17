import { useState, useEffect } from "react";
import { Search, X, Link2 } from "lucide-react";
import { supabase } from "@/api/supabaseClient";

// Search existing orders by name / phone / order number / organization and
// link the current POS sale to one. Selecting stores a snapshot in the parent.
export default function LinkOrderSearch({ linkedOrder, onSelect, onClear }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const run = async () => {
      const like = `%${term}%`;
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, client_name, client_phone, organization, activity_date")
        .or(
          `client_name.ilike.${like},client_phone.ilike.${like},order_number.ilike.${like},organization.ilike.${like}`,
        )
        .order("activity_date", { ascending: false })
        .limit(8);
      if (cancelled) return;
      if (error) console.error("order search error:", error);
      setResults(data || []);
      setSearching(false);
    };
    const t = setTimeout(run, 250); // light debounce
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const pick = (o) => {
    onSelect({
      id: o.id,
      order_number: o.order_number,
      client_name: o.client_name,
      client_phone: o.client_phone,
      organization: o.organization || "",
    });
    setOpen(false);
    setQ("");
    setResults([]);
  };

  if (linkedOrder) {
    return (
      <div className="bg-indigo-500/15 border border-indigo-500/40 rounded-xl p-2.5 flex items-start gap-2">
        <Link2 className="w-4 h-4 text-indigo-300 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0 text-xs">
          <p className="font-semibold text-indigo-100">{linkedOrder.client_name}</p>
          <p className="text-indigo-300/80">
            {linkedOrder.order_number}
            {linkedOrder.client_phone ? ` · ${linkedOrder.client_phone}` : ""}
            {linkedOrder.organization ? ` · ${linkedOrder.organization}` : ""}
          </p>
        </div>
        <button onClick={onClear} className="text-indigo-300 hover:text-white" title="נתק קישור">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 text-xs text-slate-300 border border-dashed border-slate-600 rounded-xl py-2 hover:bg-slate-700"
      >
        <Link2 className="w-4 h-4" /> קשר להזמנה / לקוח קיים
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="שם / טלפון / מספר הזמנה / ארגון"
            className="w-full h-9 bg-slate-700 rounded-lg pr-8 pl-3 text-sm border border-slate-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <button onClick={() => { setOpen(false); setQ(""); }} className="text-slate-400 hover:text-white p-1.5">
          <X className="w-4 h-4" />
        </button>
      </div>

      {q.trim().length >= 2 && (
        <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-700 divide-y divide-slate-700">
          {searching && <p className="text-xs text-slate-400 p-2 text-center">מחפש…</p>}
          {!searching && results.length === 0 && (
            <p className="text-xs text-slate-500 p-2 text-center">לא נמצאו הזמנות</p>
          )}
          {results.map((o) => (
            <button
              key={o.id}
              onClick={() => pick(o)}
              className="w-full text-right p-2 hover:bg-slate-700 text-xs"
            >
              <p className="font-medium text-white">{o.client_name}</p>
              <p className="text-slate-400">
                {o.order_number}
                {o.client_phone ? ` · ${o.client_phone}` : ""}
                {o.organization ? ` · ${o.organization}` : ""}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
