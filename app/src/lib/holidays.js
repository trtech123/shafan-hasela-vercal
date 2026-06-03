// Israeli holidays / special dates from Hebcal's public JSON API.
//
// Pure helper — no React, no Supabase. Caller (Schedule.jsx) holds the
// in-memory year cache. On any network or parse error this module returns
// an empty list rather than throwing, so the calendar always renders.
//
// API docs: https://www.hebcal.com/home/195/jewish-calendar-rest-api

const HEBCAL_URL = 'https://www.hebcal.com/hebcal';

// Param choices follow the business rules locked in for this MVP:
//   maj=on   major holidays (ראש השנה, יום כיפור, סוכות, פסח, שבועות, חנוכה, פורים, …)
//   min=on   minor holidays (ט״ו בשבט, ל״ג בעומר, …)
//   mod=on   modern (יום העצמאות, יום הזיכרון, יום השואה, …)
//   mf=on    minor fasts (צום גדליה, עשרה בטבת, …)
//   ss=off   special Shabbatot — explicitly disabled to keep Saturdays clean
//   nx=off   Rosh Chodesh — too frequent, would clutter the monthly grid
//   c=off    candle-lighting — would mark every Friday
//   s=off    weekly parashat — would mark every Saturday
//   lg=he    Hebrew titles
//   i=on     Israeli observance (no 2nd-day yom tov)
const PARAMS = {
  v: '1',
  cfg: 'json',
  lg: 'he',
  i: 'on',
  maj: 'on',
  min: 'on',
  mod: 'on',
  mf: 'on',
  ss: 'off',
  nx: 'off',
  c: 'off',
  s: 'off',
};

/**
 * Fetch a full calendar year of Israeli holidays from Hebcal.
 * Returns [] on any error (network, non-2xx, JSON parse). Never throws.
 */
export async function fetchHebcalYear(year) {
  const url = new URL(HEBCAL_URL);
  Object.entries(PARAMS).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('year', String(year));

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error('Hebcal fetch failed:', res.status, res.statusText);
      return [];
    }
    const json = await res.json();
    const items = Array.isArray(json?.items) ? json.items : [];

    // Loose filter: keep anything with a date + a label. Hebcal returns
    // category='holiday' for major/minor/modern/fast under the params
    // above, but a permissive filter is more resilient if Hebcal ever
    // adds new subcats we want to surface.
    return items
      .filter(it => it.date && (it.title || it.hebrew))
      .map(it => ({
        // Postgres DATE format alignment ('YYYY-MM-DD'). Hebcal returns
        // ISO date strings; slice handles any time/zone suffix.
        date:   String(it.date).slice(0, 10),
        title:  it.title  || it.hebrew || '',
        hebrew: it.hebrew || it.title  || '',
        subcat: it.subcat || 'major',
        yomtov: !!it.yomtov,
      }));
  } catch (err) {
    console.error('Hebcal fetch error:', err);
    return [];
  }
}

/** Index a flat event list by 'YYYY-MM-DD'. Multiple events per date OK. */
export function groupByDate(events) {
  const map = {};
  events.forEach(e => {
    if (!e.date) return;
    if (!map[e.date]) map[e.date] = [];
    map[e.date].push(e);
  });
  return map;
}

/**
 * Return the Tailwind class set for a given holiday subcat. Class strings
 * are literal so Vite/Tailwind's content scan picks them up.
 *   - major / minor / default → amber
 *   - modern (national/memorial) → blue
 *   - fast → slate (gray)
 */
export function holidayStyle(subcat) {
  switch (subcat) {
    case 'modern':
      return {
        dot:         'bg-blue-500',
        cellTint:    'bg-blue-50/60 ring-1 ring-blue-200',
        cardBorder:  'border-blue-200 bg-blue-50',
        sectionText: 'text-blue-700',
        badge:       'bg-blue-100 text-blue-700 border-blue-300',
      };
    case 'fast':
      return {
        dot:         'bg-slate-500',
        cellTint:    'bg-slate-50/80 ring-1 ring-slate-200',
        cardBorder:  'border-slate-200 bg-slate-50',
        sectionText: 'text-slate-700',
        badge:       'bg-slate-100 text-slate-700 border-slate-300',
      };
    case 'major':
    case 'minor':
    default:
      return {
        dot:         'bg-amber-500',
        cellTint:    'bg-amber-50/60 ring-1 ring-amber-200',
        cardBorder:  'border-amber-200 bg-amber-50',
        sectionText: 'text-amber-700',
        badge:       'bg-amber-100 text-amber-700 border-amber-300',
      };
  }
}

/** Hebrew label for the subcat badge. */
export function subcatLabel(subcat) {
  switch (subcat) {
    case 'major':  return 'חג';
    case 'minor':  return 'מועד';
    case 'modern': return 'יום לאומי';
    case 'fast':   return 'יום צום';
    default:       return 'מועד';
  }
}
