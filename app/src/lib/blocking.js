// Pure utilities for detecting conflicts between an order's slot and the
// `blocked_slots` table. No Supabase imports — easy to unit-test later.
//
// Time-format note: Postgres TIME columns come back as 'HH:MM:SS', while
// the OrderFormDialog time picker uses 'HH:MM' strings. Comparison is
// lexicographic — works for both formats as long as both sides are
// normalized to the same length. `tnorm` slices to 'HH:MM' to make
// comparisons safe regardless of caller.

const tnorm = (t) => (t == null ? null : String(t).slice(0, 5));

/**
 * Half-open interval overlap. NULL endpoints mean "no constraint".
 *
 * - Both sides all-null (all-day on both sides)         → overlap.
 * - Either side has only `start` set (no `end`)         → treat as a
 *   zero-width point at `start` and check the other side contains it.
 * - Otherwise compare [aS, aE) ∩ [bS, bE).
 */
export function timeOverlaps(aStart, aEnd, bStart, bEnd) {
  const aS = tnorm(aStart);
  const aE = tnorm(aEnd);
  const bS = tnorm(bStart);
  const bE = tnorm(bEnd);

  const aIsAllDay = aS == null && aE == null;
  const bIsAllDay = bS == null && bE == null;
  if (aIsAllDay || bIsAllDay) return true;

  // Side with only start set → point at start.
  const aStartPt = aS != null && aE == null;
  const bStartPt = bS != null && bE == null;
  if (aStartPt && bStartPt) return aS === bS;
  if (aStartPt) return aS >= bS && aS < (bE ?? bS);
  if (bStartPt) return bS >= aS && bS < (aE ?? aS);

  // Side with only end set is treated as "open from -∞ to end" — unlikely
  // in practice but kept defensive.
  const aStartEff = aS ?? "00:00";
  const aEndEff   = aE ?? "23:59";
  const bStartEff = bS ?? "00:00";
  const bEndEff   = bE ?? "23:59";

  return aStartEff < bEndEff && bStartEff < aEndEff;
}

/**
 * Block.site rule:
 *   - block.site = NULL → applies to all sites.
 *   - block.site = X    → applies only when order.site = X.
 *
 * An order with `site = null` (no site picked) is treated as "no match
 * unless the block is global". This avoids over-warning when the user
 * just hasn't picked a site yet.
 */
export function siteMatches(blockSite, orderSite) {
  if (blockSite == null) return true;
  return blockSite === orderSite;
}

/**
 * Given a list of blocked_slots (already scoped to relevant dates by the
 * caller) and the proposed order's slot fields, return the subset that
 * conflicts. Empty array = no conflict.
 */
export function findConflictingBlocks(blocks, { site, date, start_time, end_time }) {
  if (!date) return [];
  return blocks.filter(b => {
    if (b.block_date !== date) return false;
    if (!siteMatches(b.site, site)) return false;
    return timeOverlaps(start_time, end_time, b.start_time, b.end_time);
  });
}
