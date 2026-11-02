const NUMERIC_FIELDS = new Set(['num_participants', 'price_per_person', 'total_price']);
const TIME_FIELDS = new Set(['start_time', 'end_time']);

export function changedOrderFields(original, submitted) {
  return Object.fromEntries(Object.entries(submitted).filter(([key, value]) => {
    const previous = original[key];
    if (TIME_FIELDS.has(key)) return (previous?.slice(0, 5) || null) !== (value?.slice(0, 5) || null);
    if (NUMERIC_FIELDS.has(key)) return Number(previous || 0) !== Number(value || 0);
    return (previous ?? null) !== (value === '' ? null : value ?? null);
  }));
}
