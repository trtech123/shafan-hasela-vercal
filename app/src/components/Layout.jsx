import { Outlet, Link, useLocation, Navigate } from "react-router-dom";
import { LayoutDashboard, CalendarDays, ClipboardList, Mountain, Users, Menu, X, Wrench, ListTodo, FileText, LogOut, UserSearch, MonitorSmartphone, BarChart2, Calculator, UserCog, Package, MessageSquareText } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import SiteOpeningPrompt from "@/components/SiteOpeningPrompt";

const allNavItems = [
{ path: "/", label: "דשבורד", icon: LayoutDashboard, roles: ["admin"] },
{ path: "/orders", label: "הזמנות", icon: ClipboardList, roles: ["admin", "אחמ\"ש", "קופאי"] },
{ path: "/schedule", label: "לוח זמנים", icon: CalendarDays, roles: ["admin", "אחמ\"ש", "מדריך", "קופאי"] },
{ path: "/activities", label: "פעילויות", icon: Mountain, roles: ["admin"] },
{ path: "/instructors", label: "מדריכים", icon: Users, roles: ["admin"] },
{ path: "/quotes", label: "הצעות מחיר", icon: FileText, roles: ["admin"] },
{ path: "/leads", label: "לידים", icon: UserSearch, roles: ["admin"] },
{ path: "/cashregister", label: "קופה", icon: MonitorSmartphone, roles: ["admin", "אחמ\"ש", "קופאי"] },
{ path: "/sales-report", label: "דוח קופה", icon: BarChart2, roles: ["admin"] },
{ path: "/pricing", label: "תמחור", icon: Calculator, roles: ["admin"] },
{ path: "/tasks", label: "משימות", icon: ListTodo, roles: ["admin"] },
{ path: "/maintenance", label: "תחזוקה", icon: Wrench, roles: ["admin", "אחמ\"ש"] },
{ path: "/products", label: "ניהול מוצרים", icon: Package, roles: ["admin"] },
{ path: "/templates", label: "תבניות הודעות", icon: MessageSquareText, roles: ["admin"] },
{ path: "/users", label: "ניהול משתמשים", icon: UserCog, roles: ["admin"] }];


export default function Layout() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();

  const role = user?.role || "מדריך";
  const navItems = allNavItems.filter((item) => item.roles.includes(role));

  // Redirect if user tries to access a page they don't have access to
  const currentItem = allNavItems.find((item) => item.path === location.pathname);
  if (currentItem && !currentItem.roles.includes(role)) {
    return <Navigate to="/schedule" replace />;
  }

  return (
    <div className="min-h-screen flex" dir="rtl">
      {/* One-time site-opening form prompt (field roles only, once per session) */}
      <SiteOpeningPrompt />

      {/* Mobile overlay */}
      {mobileOpen &&
      <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      }

      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:static inset-y-0 right-0 z-50 w-64 bg-sidebar text-sidebar-foreground flex flex-col transition-transform duration-300",
        mobileOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
      )}>
        <div className="p-4 border-b border-sidebar-border">
          <img
            src="https://media.base44.com/images/public/69ca2dc3748aeb9c23109245/a0abe07c8_.jpg"
            alt="שפן הסלע"
            className="w-full object-contain"
            style={{ maxHeight: "72px" }}
          />
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                  isActive ?
                  "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-sidebar-primary/25" :
                  "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}>
                
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>);

          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border space-y-2">
          {user &&
          <div className="text-xs text-sidebar-foreground/60 text-center mb-1">
              {user.full_name} · {role}
            </div>
          }
          <button
            onClick={() => logout()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all">
            
            <LogOut className="w-4 h-4" />
            התנתקות
          </button>
          <p className="text-xs text-sidebar-foreground/40 text-center">© 2026 אדוונצ׳ר</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-h-screen">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <img
              src="https://media.base44.com/images/public/69ca2dc3748aeb9c23109245/a0abe07c8_.jpg"
              alt="שפן הסלע"
              className="h-8 object-contain"
            />
          </div>
          <button onClick={() => setMobileOpen(true)} className="p-2 hover:bg-muted rounded-lg">
            <Menu className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>);

}