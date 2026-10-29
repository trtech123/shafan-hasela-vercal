export function validIsraeliIdentity(value) {
  if (typeof value !== 'string' || !/^\d{9}$/.test(value) || value === '000000000') return false;
  const total = [...value].reduce((sum, digit, index) => {
    const product = Number(digit) * (index % 2 === 0 ? 1 : 2);
    return sum + Math.floor(product / 10) + product % 10;
  }, 0);
  return total % 10 === 0;
}

export function billingReviewIssues(billing) {
  const issues = [];
  if (!['person', 'organization'].includes(billing?.kind) || !billing?.name?.trim()) issues.push('name');
  if (billing?.kind === 'person' ? !validIsraeliIdentity(billing.identity)
    : !/^\d{9}$/.test(billing?.identity || '') || billing.identity === '000000000') issues.push('identity');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing?.email || '')) issues.push('email');
  return issues;
}
