import { readFileSync } from 'node:fs';
import { reconcileSnapshot } from './reconcile-readonly.mjs';

// An approved operator can pipe a minimal local JSON projection through stdin.
// No raw input, IDs, or document URLs are written to stdout or disk.
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const report = reconcileSnapshot(input, { salt: process.env.RIVHIT_RECONCILIATION_SALT });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch {
  process.stderr.write('Invalid reconciliation input or private salt. No report produced.\n');
  process.exitCode = 1;
}
