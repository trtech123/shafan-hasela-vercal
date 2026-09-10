import { Link } from "react-router-dom";
import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";

const CONTACT_EMAIL = "Info.shafan@gmail.com";

export function PolicySection({ number, title, children }) {
  return (
    <section className="grid gap-4 border-t border-emerald-950/10 py-8 first:border-t-0 first:pt-0 sm:grid-cols-[3rem_1fr]">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-sm font-bold text-amber-700"
      >
        {number}
      </span>
      <div className="min-w-0">
        <h2 className="text-xl font-bold tracking-tight text-emerald-950 sm:text-2xl">{title}</h2>
        <div className="mt-3 space-y-4 text-[1.02rem] leading-8 text-emerald-950/75">{children}</div>
      </div>
    </section>
  );
}

export default function PublicPolicyLayout({ eyebrow, title, intro, children }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f3f0e6] text-emerald-950" dir="rtl">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-emerald-900/10 blur-3xl" />
        <div className="absolute -bottom-48 -left-28 h-[30rem] w-[30rem] rounded-full bg-amber-400/15 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.045] [background-image:linear-gradient(110deg,transparent_0%,transparent_48%,#153d32_48%,#153d32_49%,transparent_49%,transparent_100%)] [background-size:42px_42px]" />
      </div>

      <header className="relative border-b border-white/10 bg-emerald-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link to="/" className="flex w-fit items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-4 focus:ring-offset-emerald-950">
            <span className="flex h-14 w-20 items-center justify-center overflow-hidden rounded-lg bg-white p-1 shadow-sm">
              <img src="/shafan-logo.jpg" alt="שפן הסלע" className="h-full w-full object-contain" />
            </span>
            <span>
              <span className="block text-lg font-extrabold tracking-tight">שפן הסלע</span>
              <span className="block text-xs text-emerald-100/70">פעילויות, טבע וחוויה</span>
            </span>
          </Link>

          <nav aria-label="עמודי פרטיות" className="flex flex-wrap gap-2 text-sm font-semibold">
            <Link to="/privacy-policy" className="rounded-full border border-white/15 px-4 py-2 text-emerald-50 transition hover:border-amber-300 hover:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400">
              מדיניות פרטיות
            </Link>
            <Link to="/data-deletion" className="rounded-full border border-white/15 px-4 py-2 text-emerald-50 transition hover:border-amber-300 hover:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400">
              מחיקת מידע
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:px-8 sm:py-16 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        <aside className="rounded-[1.75rem] bg-emerald-950 p-7 text-white shadow-[0_24px_70px_rgba(15,55,43,0.18)] lg:sticky lg:top-8">
          <ShieldCheck aria-hidden="true" className="h-9 w-9 text-amber-400" strokeWidth={1.7} />
          <p className="mt-8 text-xs font-bold uppercase tracking-[0.2em] text-amber-300">{eyebrow}</p>
          <p className="mt-3 text-lg font-semibold leading-8 text-emerald-50">פרטיות מתחילה בהסבר פשוט ובהחלטות ברורות.</p>
          <div className="mt-8 border-t border-white/10 pt-6">
            <p className="text-xs text-emerald-100/60">עודכן לאחרונה</p>
            <p className="mt-1 font-semibold">10 בספטמבר 2026</p>
          </div>
        </aside>

        <article className="rounded-[1.75rem] border border-white/80 bg-white/85 p-6 shadow-[0_24px_80px_rgba(30,63,50,0.10)] backdrop-blur sm:p-10 lg:p-12">
          <div className="border-b border-emerald-950/10 pb-9">
            <p className="text-sm font-bold text-amber-700">שפן הסלע</p>
            <h1 className="mt-3 text-4xl font-black tracking-[-0.04em] text-emerald-950 sm:text-5xl">{title}</h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-emerald-950/70">{intro}</p>
          </div>

          <div className="py-9">{children}</div>

          <section className="rounded-2xl bg-amber-50 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-7" aria-labelledby="policy-contact-title">
            <div>
              <h2 id="policy-contact-title" className="text-lg font-bold text-emerald-950">יצירת קשר בנושא פרטיות</h2>
              <p className="mt-1 leading-7 text-emerald-950/70">אפשר לשלוח בקשה או שאלה לכתובת:</p>
            </div>
            <a href={`mailto:${CONTACT_EMAIL}`} className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-950 px-5 py-3 font-bold text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 sm:mt-0" dir="ltr">
              <Mail aria-hidden="true" className="h-4 w-4" />
              {CONTACT_EMAIL}
            </a>
          </section>
        </article>
      </main>

      <footer className="relative border-t border-emerald-950/10 px-5 py-7 text-center text-sm text-emerald-950/60">
        <Link to="/" className="inline-flex items-center gap-2 font-semibold text-emerald-900 hover:text-amber-700">
          חזרה לאתר שפן הסלע
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        </Link>
      </footer>
    </div>
  );
}
