import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

// One-time "site opening" form prompt. Shows ONCE per browser-tab session, after
// login / first app load, for field roles only (מדריך, אחמ"ש). Not for admin,
// not on the login page (Layout renders only on authed routes). Session-only —
// no backend, no DB. "המשך למערכת" dismisses it for the rest of the session;
// opening a form opens a new tab and does NOT dismiss.

const SESSION_KEY = "shafan_site_opening_dismissed";

// Hebrew-mapped roles from AuthContext that must see the prompt.
const RELEVANT_ROLES = ["מדריך", 'אחמ"ש'];

// Google Forms — kept as two separate constants on purpose: the customer treats
// these as distinct site-opening options. Both URLs are identical for now;
// replace FORM_BARKO_KINNERET in one line when the real URL is provided.
const FORM_PARK_EXTREME =
  "https://docs.google.com/forms/d/e/1FAIpQLSfHkXeDpD_tIpYnvajCESaByf2ReJDZt2wa9mLAxyERpBaGWg/viewform?usp=header";
const FORM_BARKO_KINNERET =
  "https://docs.google.com/forms/d/e/1FAIpQLSfHkXeDpD_tIpYnvajCESaByf2ReJDZt2wa9mLAxyERpBaGWg/viewform?usp=header";

export default function SiteOpeningPrompt() {
  const { user } = useAuth();
  const isRelevant = RELEVANT_ROLES.includes(user?.role);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isRelevant && sessionStorage.getItem(SESSION_KEY) !== "1") {
      setOpen(true);
    }
  }, [isRelevant]);

  const openForm = (url) => window.open(url, "_blank", "noopener,noreferrer");

  const dismiss = () => {
    sessionStorage.setItem(SESSION_KEY, "1");
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md bg-card rounded-2xl shadow-2xl border border-border p-6 space-y-5">
        <div className="space-y-2 text-center">
          <h2 className="text-xl font-bold">נוהל פתיחת אתר</h2>
          <p className="text-sm text-muted-foreground">
            לפני תחילת העבודה יש למלא את טופס פתיחת האתר המתאים.
          </p>
        </div>

        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full justify-center gap-2"
            onClick={() => openForm(FORM_PARK_EXTREME)}
          >
            <ExternalLink className="w-4 h-4" /> פארק אקסטרים
          </Button>
          <Button
            variant="outline"
            className="w-full justify-center gap-2"
            onClick={() => openForm(FORM_BARKO_KINNERET)}
          >
            <ExternalLink className="w-4 h-4" /> אקסטרים ברקו כינרת
          </Button>
        </div>

        <Button className="w-full" onClick={dismiss}>
          המשך למערכת
        </Button>
      </div>
    </div>
  );
}
