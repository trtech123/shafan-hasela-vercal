import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import OrderStatusBadge from "../orders/OrderStatusBadge";
import moment from "moment";

export default function RecentOrders({ orders, activities }) {
  const getActivityName = (activityId) => {
    const activity = activities.find(a => a.id === activityId);
    return activity?.name || "—";
  };

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm">
      <div className="flex items-center justify-between p-6 pb-4">
        <h3 className="font-bold text-lg">הזמנות אחרונות</h3>
        <Link to="/orders" className="text-sm text-primary hover:underline flex items-center gap-1">
          לכל ההזמנות
          <ArrowLeft className="w-4 h-4" />
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" dir="rtl">
          <thead>
            <tr className="border-t border-border text-muted-foreground">
              <th className="text-right font-medium px-6 py-3">לקוח</th>
              <th className="text-right font-medium px-6 py-3 hidden sm:table-cell">פעילות</th>
              <th className="text-right font-medium px-6 py-3">תאריך</th>
              <th className="text-right font-medium px-6 py-3">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-8 text-muted-foreground">
                  אין הזמנות עדיין
                </td>
              </tr>
            ) : (
              orders.slice(0, 5).map((order) => (
                <tr key={order.id} className="border-t border-border hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium">{order.client_name}</p>
                      <p className="text-xs text-muted-foreground">{order.organization || ""}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 hidden sm:table-cell">{getActivityName(order.activity_id)}</td>
                  <td className="px-6 py-4">{order.activity_date ? moment(order.activity_date).format("DD/MM/YY") : "—"}</td>
                  <td className="px-6 py-4"><OrderStatusBadge status={order.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}