/** Both timestamps are persisted PostgreSQL timestamptz values, never callback-supplied dates. */
export function isPostActivationPayment(
  createdAt: string | null | undefined,
  verifiedAt: string | null | undefined,
  activationCutoffUtc: string | null | undefined,
): boolean {
  const instant = (value: string | null | undefined): bigint | null => {
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
    const fractional = /\.(\d{1,6})(Z|[+-]\d\d:\d\d)$/.exec(value);
    const millisecondText = fractional
      ? value.replace(/\.\d{1,6}(Z|[+-]\d\d:\d\d)$/, `.${fractional[1].padEnd(3, "0").slice(0, 3)}${fractional[2]}`)
      : value;
    const parsed = Date.parse(millisecondText);
    if (!Number.isFinite(parsed)) return null;
    const subMillisecond = fractional ? Number(fractional[1].padEnd(6, "0").slice(3)) : 0;
    return BigInt(parsed) * 1000n + BigInt(subMillisecond);
  };
  const created = instant(createdAt), verified = instant(verifiedAt), cutoff = instant(activationCutoffUtc);
  return created !== null && verified !== null && cutoff !== null
    && created >= cutoff && verified >= cutoff && verified >= created;
}
