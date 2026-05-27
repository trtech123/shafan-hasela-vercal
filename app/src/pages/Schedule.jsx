import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft, CalendarDays, Filter, CreditCard } from "lucide-react";
import moment from "moment";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import OrderStatusBadge from "../components/orders/OrderStatusBadge";

const SITES = ["עכו", "טבריה", "נוף הגליל", "שטח"];
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
  const [orders, setOrders] = useState([]);
  const [activities, setActivities] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [maintenanceTasks, setMaintenanceTasks] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(moment().startOf("month"));
  const [selectedDate, setSelectedDate] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");

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
              const hasItems = dayOrders.length > 0 || dayTasks.length > 0 || dayMaintenance.length > 0;
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
                    isToday && "ring-2 ring-primary/30",
                    isSelected && "bg-primary text-primary-foreground hover:bg-primary"
                  )}
                >
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
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-lg">
              {selectedDate ? moment(selectedDate).format("DD/MM/YYYY") : "בחרי תאריך"}
            </h3>
          </div>

          {!selectedDate ? (
            <p className="text-sm text-muted-foreground text-center py-8">לחצי על תאריך בלוח כדי לראות את הפעילויות</p>
          ) : (selectedOrders.length === 0 && selectedTasks.length === 0 && selectedMaintenance.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-8">אין פעילויות או משימות ביום זה</p>
          ) : (
            <div className="space-y-3">
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
                    {task.assigned_to && <span>👤 {getProfileName(task.assigned_to)}</span>}
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
                    {m.assigned_to && <span>👤 {getProfileName(m.assigned_to)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}