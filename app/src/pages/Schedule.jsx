import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft, CalendarDays, Filter, CreditCard, Pencil, Trash2, Lock } from "lucide-react";
import moment from "moment";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { fetchHebcalYear, groupByDate, holidayStyle, subcatLabel } from "@/lib/holidays";
import OrderStatusBadge from "../components/orders/OrderStatusBadge";
import BlockSlotDialog from "../components/schedule/BlockSlotDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const SITES = ["עכו", "טבריה", "נוף הגליל", "שטח", "פודטראק", "קפה אקסטרים"];
const FILTER_BUTTONS = [
  { key: "all",         label: "הכל",       color: "bg-slate-100 text-slate-700 border-slate-300" },
  { key: "orders",      label: "📅 הזמנות", color: "bg-blue-100 text-blue-800 border-blue-300" },
  { key: "tasks",       label: "📋 משימות", color: "bg-pink-100 text-pink-800 border-pink-300" },
  { key: "maintenance", label: "🔧 תחזוקה", color: "bg-yellow-100 text-yellow-800 border-yellow-300" },
];

const DAYS_HE = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

const SITE_COLORS = {
  "עכו":        { dot: "bg-blue-400",   card: "border-blue-300 bg-blue-50",   badge: "bg-blue-100 text-blue-800" },
  "טבריה":      { dot: "bg-teal-400",   card: "border-teal-300 bg-teal-50",   badge: "bg-teal-100 text-teal-800" },
  "נוף הגליל":  { dot: "bg-purple-400", card: "border-purple-300 bg-purple-50", badge: "bg-purple-100 text-purple-800" },
  "שטח":        { dot: "bg-orange-400", card: "border-orange-300 bg-orange-50", badge: "bg-orange-100 text-orange-800" },
};

const TASK_STYLE = { dot: "bg-pink-400", card: "border-pink-300 bg-pink-50", badge: "bg-pink-100 text-pink-800" };

export default function Schedule() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Hebrew-mapped role strings from AuthContext: 'admin' / 'אחמ"ש' / 'מדריך'.
  // Only the first two get block CRUD; instructors are read-only per Stage 1+2 spec.
  const isAdminOrOps = user?.role === "admin" || user?.role === 'אחמ"ש';

  const [orders, setOrders] = useState([]);
  const [activities, setActivities] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [maintenanceTasks, setMaintenanceTasks] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [blockedSlots, setBlockedSlots] = useState([]);
  // Hebcal events indexed by year. In-memory only; refetched if the user
  // navigates to a year we haven't seen this session.
  const [holidaysByYear, setHolidaysByYear] = useState({});
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(moment().startOf("month"));
  const [selectedDate, setSelectedDate] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");

  // Block CRUD dialog state.
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState(null);
  const [deletingBlock, setDeletingBlock] = useState(null);
  // Prefilled reason when "block this day" is launched from a holiday card.
  // Cleared on every dialog open so plain "חסום זמן" doesn't inherit stale text.
  const [blockPrefillReason, setBlockPrefillReason] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const [
          { data: o, error: eO },
          { data: a, error: eA },
          { data: t, error: eT },
          { data: m, error: eM },
          { data: p, error: eP },
        ] = await Promise.all([
          supabase.from('orders').select('*').order('activity_date', { ascending: false }).limit(200),
          supabase.from('activities').select('*'),
          supabase.from('tasks').select('*').order('due_date', { ascending: false }).limit(200),
          supabase.from('maintenance_tasks').select('*').order('due_date', { ascending: false }).limit(200),
          supabase.from('profiles').select('id, full_name, email').order('full_name'),
        ]);

        if (eO) console.error('orders fetch error:', eO);
        if (eA) console.error('activities fetch error:', eA);
        if (eT) console.error('tasks fetch error:', eT);
        if (eM) console.error('maintenance_tasks fetch error:', eM);
        if (eP) console.error('profiles fetch error:', eP);

        setOrders(o ?? []);
        setActivities(a ?? []);
        setTasks(t ?? []);
        setMaintenanceTasks(m ?? []);
        setProfiles(p ?? []);
      } catch (err) {
        console.error('Schedule load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Month-scoped fetch for blocked_slots — keeps payload small as the table grows.
  // Refetch whenever the calendar month changes OR after a block CRUD action.
  const loadBlocks = useCallback(async () => {
    const monthStart = currentMonth.clone().startOf("month").format("YYYY-MM-DD");
    const monthEnd   = currentMonth.clone().endOf("month").format("YYYY-MM-DD");
    const { data, error } = await supabase
      .from('blocked_slots')
      .select('*')
      .gte('block_date', monthStart)
      .lte('block_date', monthEnd);
    if (error) {
      console.error('blocked_slots fetch error:', error);
      return;
    }
    setBlockedSlots(data ?? []);
  }, [currentMonth]);

  useEffect(() => { loadBlocks(); }, [loadBlocks]);

  // Lazy-fetch the current calendar year from Hebcal. Cached in memory.
  // Silent failure: helper returns [] on any error so the calendar still renders.
  const currentYear = currentMonth.year();
  useEffect(() => {
    if (holidaysByYear[currentYear] !== undefined) return;
    let cancelled = false;
    fetchHebcalYear(currentYear).then(events => {
      if (cancelled) return;
      setHolidaysByYear(prev => ({ ...prev, [currentYear]: events }));
    });
    return () => { cancelled = true; };
    // holidaysByYear intentionally omitted: the inline guard prevents the
    // re-entry that the lint rule worries about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentYear]);

  const openCreateBlock = () => {
    setEditingBlock(null);
    setBlockPrefillReason("");
    setBlockDialogOpen(true);
  };

  const openCreateBlockFromHoliday = (holiday) => {
    setEditingBlock(null);
    setBlockPrefillReason(holiday.title || "");
    setBlockDialogOpen(true);
  };

  const openEditBlock = (block) => {
    setEditingBlock(block);
    setBlockPrefillReason("");
    setBlockDialogOpen(true);
  };

  const confirmDeleteBlock = async () => {
    if (!deletingBlock) return;
    const { error } = await supabase
      .from('blocked_slots')
      .delete()
      .eq('id', deletingBlock.id);
    if (error) {
      console.error('delete block error:', error);
      toast.error('שגיאה במחיקת החסימה');
    } else {
      toast.success('החסימה נמחקה');
      loadBlocks();
    }
    setDeletingBlock(null);
  };

  const getActivityName = (activityId) => {
    return activities.find(a => a.id === activityId)?.name || "—";
  };

  const getProfileName = (id) => {
    const p = profiles.find(p => p.id === id);
    return p?.full_name || p?.email || "—";
  };

  const ordersByDate = useMemo(() => {
    const map = {};
    const showOrders = typeFilter === "all" || typeFilter === "orders";
    if (!showOrders) return map;
    orders.forEach(o => {
      if (o.activity_date && o.status !== "בוטל") {
        if (siteFilter !== "all" && o.site !== siteFilter) return;
        const key = moment(o.activity_date).format("YYYY-MM-DD");
        if (!map[key]) map[key] = [];
        map[key].push(o);
      }
    });
    return map;
  }, [orders, typeFilter, siteFilter]);

  const tasksByDate = useMemo(() => {
    const map = {};
    const showTasks = typeFilter === "all" || typeFilter === "tasks";
    if (!showTasks) return map;
    tasks.forEach(t => {
      if (t.due_date && t.status !== "בוטלה") {
        const key = moment(t.due_date).format("YYYY-MM-DD");
        if (!map[key]) map[key] = [];
        map[key].push(t);
      }
    });
    return map;
  }, [tasks, typeFilter]);

  const maintenanceByDate = useMemo(() => {
    const map = {};
    const showMaintenance = typeFilter === "all" || typeFilter === "maintenance";
    if (!showMaintenance) return map;
    maintenanceTasks.forEach(m => {
      if (m.due_date && m.status !== "הושלמה") {
        if (siteFilter !== "all" && m.site !== siteFilter) return;
        const key = moment(m.due_date).format("YYYY-MM-DD");
        if (!map[key]) map[key] = [];
        map[key].push(m);
      }
    });
    return map;
  }, [maintenanceTasks, typeFilter, siteFilter]);

  // Site filter rule for blocks:
  // - site = null (company-wide) always shows
  // - site = X shows only when filter is 'all' or matches X
  // Block visibility is independent of typeFilter — blocks are calendar
  // metadata, not bookings, so we always surface them.
  const blocksByDate = useMemo(() => {
    const map = {};
    blockedSlots.forEach(b => {
      if (b.site != null && siteFilter !== "all" && b.site !== siteFilter) return;
      const key = b.block_date; // already 'YYYY-MM-DD' from Postgres DATE
      if (!map[key]) map[key] = [];
      map[key].push(b);
    });
    return map;
  }, [blockedSlots, siteFilter]);

  // Holidays for the visible year, indexed by date. Independent of any
  // filter — they're calendar annotations, not bookings.
  const holidaysByDate = useMemo(() => {
    const events = holidaysByYear[currentYear] || [];
    return groupByDate(events);
  }, [holidaysByYear, currentYear]);

  const calendarDays = useMemo(() => {
    const start = currentMonth.clone().startOf("month");
    const end = currentMonth.clone().endOf("month");
    const startDay = start.day();
    const days = [];

    // Fill previous month days
    for (let i = 0; i < startDay; i++) {
      days.push({ date: start.clone().subtract(startDay - i, "days"), isCurrentMonth: false });
    }
    // Fill current month
    for (let d = start.clone(); d.isSameOrBefore(end); d.add(1, "day")) {
      days.push({ date: d.clone(), isCurrentMonth: true });
    }
    // Fill remaining
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        days.push({ date: end.clone().add(i, "days"), isCurrentMonth: false });
      }
    }
    return days;
  }, [currentMonth]);

  const selectedOrders = selectedDate ? (ordersByDate[selectedDate] || []) : [];
  const selectedTasks = selectedDate ? (tasksByDate[selectedDate] || []) : [];
  const selectedMaintenance = selectedDate ? (maintenanceByDate[selectedDate] || []) : [];
  const selectedBlocks = selectedDate ? (blocksByDate[selectedDate] || []) : [];
  const selectedHolidays = selectedDate ? (holidaysByDate[selectedDate] || []) : [];

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
        <h1 className="text-3xl font-bold tracking-tight">לוח זמנים</h1>
        <p className="text-muted-foreground mt-1">תצוגה חודשית של הפעילויות</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">סוג:</span>
          <div className="flex gap-1 flex-wrap">
            {FILTER_BUTTONS.map(f => (
              <button
                key={f.key}
                onClick={() => setTypeFilter(f.key)}
                className={cn(
                  "px-3 py-1 rounded-full text-sm font-medium border transition-all",
                  typeFilter === f.key ? f.color + " shadow-sm" : "bg-background text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {(typeFilter === "all" || typeFilter === "orders" || typeFilter === "maintenance") && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">אתר:</span>
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setSiteFilter("all")}
                className={cn(
                  "px-3 py-1 rounded-full text-sm font-medium border transition-all",
                  siteFilter === "all" ? "bg-slate-100 text-slate-700 border-slate-300 shadow-sm" : "bg-background text-muted-foreground border-border hover:bg-muted"
                )}
              >
                כל האתרים
              </button>
              {SITES.map(site => (
                <button
                  key={site}
                  onClick={() => setSiteFilter(site)}
                  className={cn(
                    "px-3 py-1 rounded-full text-sm font-medium border transition-all",
                    siteFilter === site
                      ? cn(
                          site === "עכו" && "bg-blue-100 text-blue-800 border-blue-300 shadow-sm",
                          site === "טבריה" && "bg-teal-100 text-teal-800 border-teal-300 shadow-sm",
                          site === "נוף הגליל" && "bg-purple-100 text-purple-800 border-purple-300 shadow-sm",
                          site === "שטח" && "bg-orange-100 text-orange-800 border-orange-300 shadow-sm"
                        )
                      : "bg-background text-muted-foreground border-border hover:bg-muted"
                  )}
                >
                  {site}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(m => m.clone().add(1, "month"))}>
              <ChevronRight className="w-5 h-5" />
            </Button>
            <h2 className="text-xl font-bold">{currentMonth.format("MMMM YYYY")}</h2>
            <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(m => m.clone().subtract(1, "month"))}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {DAYS_HE.map(d => (
              <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
            ))}
            {calendarDays.map((day, i) => {
              const key = day.date.format("YYYY-MM-DD");
              const dayOrders = ordersByDate[key] || [];
              const dayTasks = tasksByDate[key] || [];
              const dayMaintenance = maintenanceByDate[key] || [];
              const dayBlocks = blocksByDate[key] || [];
              const dayHolidays = holidaysByDate[key] || [];
              const hasItems = dayOrders.length > 0 || dayTasks.length > 0 || dayMaintenance.length > 0;
              const isBlocked = dayBlocks.length > 0;
              const isHoliday = dayHolidays.length > 0;
              // Pick the first event's style for the cell tint (rare to have mixed-category days).
              const holidayCellStyle = isHoliday ? holidayStyle(dayHolidays[0].subcat) : null;
              const isToday = day.date.isSame(moment(), "day");
              const isSelected = selectedDate === key;

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(key)}
                  className={cn(
                    "relative aspect-square p-1 rounded-xl text-sm transition-all duration-200 flex flex-col items-center justify-start",
                    !day.isCurrentMonth && "text-muted-foreground/30",
                    day.isCurrentMonth && "hover:bg-muted",
                    // Block tint outranks holiday tint — actionable state wins.
                    isHoliday && !isBlocked && !isSelected && holidayCellStyle.cellTint,
                    isBlocked && !isSelected && "bg-red-50 ring-1 ring-red-200",
                    isToday && "ring-2 ring-primary/30",
                    isSelected && "bg-primary text-primary-foreground hover:bg-primary"
                  )}
                >
                  {isBlocked && (
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 text-[10px] leading-none",
                        isSelected ? "text-primary-foreground/80" : "text-red-600"
                      )}
                      title={dayBlocks.map(b => b.reason).join(' · ')}
                    >🔒</span>
                  )}
                  {isHoliday && (
                    <span
                      className={cn(
                        "absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full",
                        isSelected ? "bg-primary-foreground/80" : holidayCellStyle.dot
                      )}
                      title={dayHolidays.map(h => h.title).join(' · ')}
                    />
                  )}
                  <span className={cn("text-xs font-medium mt-1", isToday && !isSelected && "text-primary font-bold")}>
                    {day.date.format("D")}
                  </span>
                  {hasItems && (
                    <div className="flex flex-col items-center mt-0.5 gap-0.5">
                      <div className="flex gap-0.5 flex-wrap justify-center">
                        {dayOrders.slice(0, 3).map((o, j) => {
                          const dotColor = SITE_COLORS[o.site]?.dot;
                          return (
                            <div key={`o${j}`} className={cn("w-1.5 h-1.5 rounded-full", isSelected ? "bg-primary-foreground" : dotColor || "bg-accent")} />
                          );
                        })}
                        {dayTasks.slice(0, 2).map((t, j) => (
                          <div key={`t${j}`} className={cn("w-1.5 h-1.5 rounded-full", isSelected ? "bg-primary-foreground" : "bg-pink-400")} />
                        ))}
                        {dayMaintenance.slice(0, 2).map((m, j) => (
                          <div key={`m${j}`} className={cn("w-1.5 h-1.5 rounded-full", isSelected ? "bg-primary-foreground" : "bg-yellow-400")} />
                        ))}
                      </div>
                      {dayOrders.length > 0 && (
                        <span className={cn("text-[10px] font-semibold leading-none", isSelected ? "text-primary-foreground" : "text-accent")}>
                          {dayOrders.reduce((sum, o) => sum + (o.num_participants || 0), 0)}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Day details */}
        <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-primary" />
              <h3 className="font-bold text-lg">
                {selectedDate ? moment(selectedDate).format("DD/MM/YYYY") : "בחרי תאריך"}
              </h3>
            </div>
            {selectedDate && isAdminOrOps && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-red-700 border-red-200 hover:bg-red-50"
                onClick={openCreateBlock}
              >
                <Lock className="w-3.5 h-3.5" /> חסום זמן
              </Button>
            )}
          </div>

          {!selectedDate ? (
            <p className="text-sm text-muted-foreground text-center py-8">לחצי על תאריך בלוח כדי לראות את הפעילויות</p>
          ) : (selectedOrders.length === 0 && selectedTasks.length === 0 && selectedMaintenance.length === 0 && selectedBlocks.length === 0 && selectedHolidays.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-8">אין פעילויות או משימות ביום זה</p>
          ) : (
            <div className="space-y-3">
              {selectedHolidays.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-amber-700 flex items-center gap-1">✡ חגים ותאריכים מיוחדים</p>
                  {selectedHolidays.map((h, idx) => {
                    const s = holidayStyle(h.subcat);
                    return (
                      <div key={`${h.date}-${idx}`} className={cn("p-3 rounded-xl border space-y-1", s.cardBorder)}>
                        <div className="flex items-start justify-between gap-2">
                          <p className={cn("text-sm font-semibold", s.sectionText)}>{h.title}</p>
                          {isAdminOrOps && (
                            <button
                              type="button"
                              onClick={() => openCreateBlockFromHoliday(h)}
                              className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                              title="חסום את היום הזה"
                            >
                              <Lock className="w-3 h-3" /> חסום יום
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          <span className={cn("inline-flex px-2 py-0.5 rounded-full border text-[11px] font-medium", s.badge)}>
                            {subcatLabel(h.subcat)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedBlocks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-red-700 flex items-center gap-1">🔒 חסימות</p>
                  {selectedBlocks.map(b => (
                    <div key={b.id} className="p-3 rounded-xl border border-red-200 bg-red-50 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-red-800">{b.reason}</p>
                        {isAdminOrOps && (
                          <div className="flex gap-0.5 shrink-0">
                            {/* order_lock blocks: hide pencil to avoid silent desync from the source order */}
                            {b.source !== 'order_lock' && (
                              <button
                                onClick={() => openEditBlock(b)}
                                className="p-1 hover:bg-red-100 rounded-md transition-colors"
                                title="ערוך חסימה"
                              >
                                <Pencil className="w-3.5 h-3.5 text-red-700" />
                              </button>
                            )}
                            <button
                              onClick={() => setDeletingBlock(b)}
                              className="p-1 hover:bg-red-100 rounded-md transition-colors"
                              title="מחק חסימה"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-700" />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-red-700">
                        <span>
                          {b.start_time && b.end_time
                            ? `🕐 ${b.start_time.slice(0,5)}–${b.end_time.slice(0,5)}`
                            : "כל היום"}
                        </span>
                        <span>📍 {b.site || "כל האתרים"}</span>
                        {b.source === 'order_lock' && (
                          <span className="text-red-600/70">(נעילת הזמנה)</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedOrders.map(order => {
                const siteStyle = SITE_COLORS[order.site];
                const activityName = getActivityName(order.activity_id);
                const handleCollect = () => {
                  const params = new URLSearchParams({
                    prefill: JSON.stringify({
                      id: order.id,
                      name: `${activityName} — ${order.client_name}`,
                      qty: order.num_participants || 1,
                      customPrice: order.price_per_person || 0,
                    })
                  });
                  navigate(`/cashregister?${params.toString()}`);
                };
                return (
                  <div key={order.id} className={cn("p-4 rounded-xl border space-y-2", siteStyle ? siteStyle.card : "bg-muted/50 border-border")}>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-sm">{order.client_name}</p>
                        <p className="text-xs text-muted-foreground">{order.organization || ""}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <OrderStatusBadge status={order.status} />
                        {order.site && (
                          <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", siteStyle ? siteStyle.badge : "bg-muted text-muted-foreground")}>
                            {order.site}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>🏔️ {activityName}</span>
                      {order.start_time && <span>🕐 {order.start_time}{order.end_time ? `–${order.end_time}` : ""}</span>}
                      <span>👥 {order.num_participants} משתתפים</span>
                    </div>
                    {order.internal_notes && (
                      <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 text-amber-800">
                        🔒 הערה פנימית: {order.internal_notes}
                      </div>
                    )}
                    <button
                      onClick={handleCollect}
                      className="w-full flex items-center justify-center gap-1.5 mt-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
                    >
                      <CreditCard className="w-3.5 h-3.5" /> גבייה בקופה
                    </button>
                  </div>
                );
              })}

              {selectedTasks.length > 0 && selectedOrders.length > 0 && (
                <div className="border-t border-border pt-2 mt-2">
                  <p className="text-xs font-semibold text-pink-700 mb-2">📋 משימות</p>
                </div>
              )}

              {selectedTasks.map(task => (
                <div key={task.id} className={cn("p-4 rounded-xl border space-y-2", TASK_STYLE.card)}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-sm">{task.title}</p>
                      {task.description && <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium", TASK_STYLE.badge)}>
                        {task.status}
                      </span>
                      {task.priority && (
                        <span className="text-[11px] text-muted-foreground">{task.priority}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {task.due_time && <span>🕐 {task.due_time}</span>}
                    {task.assigned_to ? <span>👤 {getProfileName(task.assigned_to)}</span> : task.legacy_assigned_to ? <span>👤 {task.legacy_assigned_to} <span className="opacity-60">(לא משויך)</span></span> : null}
                    {task.category && <span>🏷️ {task.category}</span>}
                  </div>
                </div>
              ))}

              {selectedMaintenance.length > 0 && (selectedOrders.length > 0 || selectedTasks.length > 0) && (
                <div className="border-t border-border pt-2 mt-2">
                  <p className="text-xs font-semibold text-yellow-700 mb-2">🔧 תחזוקה</p>
                </div>
              )}

              {selectedMaintenance.map(m => (
                <div key={m.id} className="p-4 rounded-xl border space-y-2 border-yellow-300 bg-yellow-50">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-sm">{m.title}</p>
                      {m.description && <p className="text-xs text-muted-foreground line-clamp-2">{m.description}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-yellow-100 text-yellow-800">
                        {m.status}
                      </span>
                      {m.priority && <span className="text-[11px] text-muted-foreground">{m.priority}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {m.site && <span>📍 {m.site}</span>}
                    {m.category && <span>🏷️ {m.category}</span>}
                    {m.assigned_to ? <span>👤 {getProfileName(m.assigned_to)}</span> : m.legacy_assigned_to ? <span>👤 {m.legacy_assigned_to} <span className="opacity-60">(לא משויך)</span></span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <BlockSlotDialog
        open={blockDialogOpen}
        onClose={() => setBlockDialogOpen(false)}
        block={editingBlock}
        defaultDate={selectedDate || moment().format("YYYY-MM-DD")}
        defaultReason={blockPrefillReason}
        onSaved={loadBlocks}
      />

      <AlertDialog open={!!deletingBlock} onOpenChange={() => setDeletingBlock(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת חסימה</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingBlock
                ? `למחוק את החסימה "${deletingBlock.reason}" בתאריך ${moment(deletingBlock.block_date).format("DD/MM/YYYY")}? פעולה זו בלתי הפיכה.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteBlock}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >מחק</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}