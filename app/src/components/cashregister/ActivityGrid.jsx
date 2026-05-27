import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS = {
  "הפעלת פארק":  "from-emerald-600 to-emerald-800",
  "יום גיבוש":   "from-blue-600 to-blue-800",
  "חוג טיפוס":   "from-orange-600 to-orange-800",
  "סדנת שטח":    "from-purple-600 to-purple-800",
};

export default function ActivityGrid({ activities, onAdd }) {
  const categories = [...new Set(activities.map(a => a.category).filter(Boolean))];

  return (
    <div className="space-y-6">
      {categories.map(cat => (
        <div key={cat}>
          <h2 className="text-sm font-semibold text-slate-400 uppercase mb-3">{cat}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {activities.filter(a => a.category === cat).map(activity => (
              <ActivityCard key={activity.id} activity={activity} onAdd={onAdd} />
            ))}
          </div>
        </div>
      ))}
      {categories.length === 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {activities.map(activity => (
            <ActivityCard key={activity.id} activity={activity} onAdd={onAdd} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityCard({ activity, onAdd }) {
  const gradient = CATEGORY_COLORS[activity.category] || "from-slate-600 to-slate-800";

  return (
    <button
      onClick={() => onAdd(activity)}
      className="relative rounded-2xl overflow-hidden aspect-[4/3] text-right group transition-transform hover:scale-[1.03] active:scale-95"
    >
      {activity.image_url ? (
        <img src={activity.image_url} alt={activity.name} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className={cn("absolute inset-0 bg-gradient-to-br", gradient)} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      <div className="absolute bottom-0 right-0 left-0 p-3">
        <p className="font-bold text-sm leading-tight text-white">{activity.name}</p>
        <p className="text-emerald-300 font-semibold text-sm mt-0.5">
          {activity.price_per_person ? `${activity.price_per_person.toLocaleString()}₪` : "ללא מחיר"}
          <span className="text-white/50 text-xs"> / אדם</span>
        </p>
      </div>
      <div className="absolute top-2 left-2 w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <Plus className="w-4 h-4 text-white" />
      </div>
    </button>
  );
}