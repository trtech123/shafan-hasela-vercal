import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const require = createRequire(new URL('../../app/package.json', import.meta.url));
const esbuild = require('esbuild');
const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'app/.tmp/rivhit-journal-edge');
await mkdir(output, { recursive: true });
for (const name of ['rivhit-journal-readonly', 'rivhit-journal-worker']) {
  await esbuild.build({
    entryPoints: [resolve(root, `supabase/functions/${name}/index.ts`)],
    outfile: resolve(output, `${name}.js`),
    bundle: true,
    platform: 'neutral',
    format: 'esm',
    target: 'es2022',
    external: ['npm:*'],
    banner: { js: '// @ts-nocheck' },
    legalComments: 'none',
    logLevel: 'silent',
  });
}
console.log('Prepared two local Edge bundles without credentials.');
