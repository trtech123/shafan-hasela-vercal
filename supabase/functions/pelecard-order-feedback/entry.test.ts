import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {expect,test} from 'vitest';

test('the documented Orders server-side callback URL has a deployable Edge receiver',()=>{
  const dir=dirname(fileURLToPath(import.meta.url));
  const entry=resolve(dir,'index.ts');
  expect(existsSync(entry)).toBe(true);
  expect(readFileSync(entry,'utf8')).toContain('createCommercialFeedback');
  const config=readFileSync(resolve(dir,'../../config.toml'),'utf8');
  expect(config).toContain('[functions.pelecard-order-feedback]');
});
