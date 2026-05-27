import { cn } from "@/lib/utils";

export default function StatsCard({ icon: Icon, label, value, subtitle, color = "primary" }) {
  const colorMap = {
    primary: "bg-primary/10 text-primary",
    secondary: "bg-accent/10 text-accent",
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
  };

  return (
    <div className="bg-card rounded-2xl p-6 border border-border shadow-sm hover:shadow-md transition-shadow duration-300">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium">{label}</p>
          <p className="text-3xl font-bold mt-2 tracking-tight">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", colorMap[color])}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}