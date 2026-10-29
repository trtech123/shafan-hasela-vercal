// Pelecard support, relayed by the merchant on 2026-09-29: 15-minute hosted sessions.
// The database anchors this deadline to the one-time dispatch start, never a refresh.
export function hostedLifetime(expiresAt: string | null | undefined, now: number) {
 const deadline = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
 return { known: Number.isFinite(deadline), expired: Number.isFinite(deadline) && deadline <= now,
  expiresAt: Number.isFinite(deadline) ? new Date(deadline).toISOString() : null };
}
