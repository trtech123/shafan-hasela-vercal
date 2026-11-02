import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

// "Site opening" form prompt. Shows on EVERY login / system entry for אחמ"ש
// users only. Not for admin, not for מדריך, not on the login page (Layout renders
// only on authed routes). No persistence — "המשך למערכת" only closes it for the
// current mounted session (and SPA route changes keep the same instance, so it
// won't re-nag on navigation), but it re-appears on the next login / page entry.
// Opening a form opens a new tab and does NOT dismiss.

// Hebrew-mapped roles from AuthContext that must see the prompt.
const RELEVANT_ROLES = ['אחמ"ש'];

// Shared safety questionnaire for Acre and Tiberias; the form selects the site.
const SITE_OPENING_FORM = "https://devout-daily-shift-pulse.base44.app";

export default function SiteOpeningPrompt() {
  const { user } = useAuth();
  const isRelevant = RELEVANT_ROLES.includes(user?.role);
  const [open, setOpen] = useState(false);

  // Show whenever a relevant user is (or becomes) authenticated — i.e. on each
  // login / fresh system entry. No sessionStorage guard, so a previous dismiss
  // never suppresses a later login.
  useEffect(() => {
    if (isRelevant) setOpen(true);
  }, [isRelevant]);

  const openForm = (url) => window.open(url, "_blank", "noopener,noreferrer");

  // Session-only close: no persistence, so the next login / entry re-shows it.
  const dismiss = () => setOpen(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md bg-card rounded-2xl shadow-2xl border border-border p-6 space-y-5">
        <div className="space-y-2 text-center">
          <h2 className="text-xl font-bold">נוהל פתיחת אתר</h2>
          <p className="text-sm text-muted-foreground">
            לפני תחילת העבודה יש למלא את טופס פתיחת האתר המתאים. בשאלון הבטיחות יש לבחור את האתר.
          </p>
        </div>

        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full justify-center gap-2"
            onClick={() => openForm(SITE_OPENING_FORM)}
          >
            <ExternalLink className="w-4 h-4" /> שאלון בטיחות ופתיחת אתר — עכו וטבריה
          </Button>
        </div>

        <Button className="w-full" onClick={dismiss}>
          המשך למערכת
        </Button>
      </div>
    </div>
  );
}
