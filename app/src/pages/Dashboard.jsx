import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { ClipboardList, Users, CalendarDays, Banknote, ShieldCheck, Mail, Link } from "lucide-react";
import StatsCard from "../components/dashboard/StatsCard";
import RecentOrders from "../components/dashboard/RecentOrders";
import moment from "moment";

export default function Dashboard() {
  const [orders, setOrders] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [
          { data: ordersData, error: eO },
          { data: activitiesData, error: eA },
        ] = await Promise.all([
          supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(50),
          supabase.from('activities').select('*'),
        ]);

        if (eO) console.error('orders fetch error:', eO);
        if (eA) console.error('activities fetch error:', eA);

        setOrders(ordersData ?? []);
        setActivities(activitiesData ?? []);
      } catch (err) {
        console.error('Dashboard load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const thisMonth = orders.filter(o => moment(o.activity_date).isSame(moment(), "month") && o.status !== "בוטל");
  const totalRevenue = orders.filter(o => o.status === "שולם").reduce((sum, o) => sum + (o.total_price || 0), 0);
  const totalParticipants = thisMonth.reduce((sum, o) => sum + (o.num_participants || 0), 0);
  const pendingOrders = orders.filter(o => o.status === "ממתין לאישור");

  return (
    <div className="space-y-8" dir="rtl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">שלום! 👋</h1>
        <p className="text-muted-foreground mt-1">הנה סקירה של הפעילות העדכנית</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard icon={ClipboardList} label="הזמנות החודש" value={thisMonth.length} subtitle="פעילויות מתוכננות" color="primary" />
        <StatsCard icon={Users} label="משתתפים החודש" value={totalParticipants} subtitle="סה״כ נרשמו" color="secondary" />
        <StatsCard icon={CalendarDays} label="ממתינות לאישור" value={pendingOrders.length} subtitle="דרוש טיפול" color="blue" />
        <StatsCard icon={Banknote} label="הכנסות (שולם)" value={`₪${totalRevenue.toLocaleString()}`} subtitle="סה״כ שולם" color="green" />
      </div>

      <RecentOrders orders={orders} activities={activities} />

      {/* Login instructions */}
      <div className="bg-card border border-border rounded-2xl p-6" dir="rtl">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold">איך עובדים נכנסים למערכת?</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">1</div>
            <div>
              <p className="font-medium text-sm">הזמנה למערכת</p>
              <p className="text-xs text-muted-foreground mt-0.5">מנהל מזמין את העובד עם האימייל שלו דרך הגדרות המערכת</p>
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">2</div>
            <div>
              <p className="font-medium text-sm">קישור כניסה במייל</p>
              <p className="text-xs text-muted-foreground mt-0.5">העובד מכניס את האימייל שלו ומקבל קישור אישי וחד-פעמי (תקף 10 דקות)</p>
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">3</div>
            <div>
              <p className="font-medium text-sm">גישה לפי תפקיד</p>
              <p className="text-xs text-muted-foreground mt-0.5">כל עובד רואה רק את הדפים הרלוונטיים לתפקידו (אדמין / אחמ"ש / מדריך)</p>
            </div>
          </div>
        </div>
        <div className="mt-4 p-3 bg-muted/50 rounded-xl text-xs text-muted-foreground flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <span>הכניסה מאובטחת — רק עובדים שהוזמנו מראש יכולים להיכנס. הקישור פג תוקף אוטומטית ואינו ניתן לשימוש חוזר.</span>
        </div>
      </div>
    </div>
  );
}