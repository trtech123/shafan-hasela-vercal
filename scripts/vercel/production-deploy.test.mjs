import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preflight, deploy, status } from './production-deploy.mjs';

const SHA = 'a'.repeat(40);
const TEAM = 'team_wBjKr13fvum5krxkUPPpeEuQ';
const PROJECT = 'prj_6rvjmBAfEUpym5E4JwVPut1HiXQC';
const ALIAS = 'shafan-hasela-vercal.vercel.app';

function fixture(overrides = {}) {
  const calls = [];
  const writes = [];
  const files = {
    'app/vercel.json': JSON.stringify({ git: { deploymentEnabled: false }, rewrites: [{ source: '/x', destination: '/y' }] }),
    'app/.vercel/project.json': JSON.stringify({ orgId: TEAM, projectId: PROJECT }),
    ...overrides.files,
  };
  const outputs = {
    'git branch --show-current': 'main\n',
    'git rev-parse HEAD': `${SHA}\n`,
    'git status --porcelain --untracked-files=all': '',
    'git ls-remote origin refs/heads/main': `${SHA}\trefs/heads/main\n`,
    [`vercel deploy --prod --cwd app --meta sourceBranch=main --meta sourceCommitSha=${SHA}`]: `https://shafan-hasela-abc.vercel.app\n`,
    'vercel inspect https://shafan-hasela-abc.vercel.app --wait --cwd app': 'Ready',
    [`vercel api /v13/deployments/shafan-hasela-abc.vercel.app?teamId=${TEAM} --cwd app`]: JSON.stringify({ id: 'dpl_123', projectId: PROJECT, readyState: 'READY', target: 'production', url: 'shafan-hasela-abc.vercel.app', alias: [ALIAS], meta: { sourceBranch: 'main', sourceCommitSha: SHA } }),
    [`vercel api /v4/aliases/${ALIAS}?projectId=${PROJECT}&teamId=${TEAM} --cwd app`]: JSON.stringify({ alias: ALIAS, projectId: PROJECT, deploymentId: 'dpl_123' }),
    [`vercel api /v13/deployments/dpl_123?teamId=${TEAM} --cwd app`]: JSON.stringify({ id: 'dpl_123', projectId: PROJECT, readyState: 'READY', target: 'production', url: 'shafan-hasela-abc.vercel.app', meta: { sourceBranch: 'main', sourceCommitSha: SHA } }),
    ...overrides.outputs,
  };
  return {
    calls, writes,
    io: {
      read: (path) => files[path],
      run: (command, args) => {
        const key = [command, ...args].join(' ');
        calls.push(key);
        if (!(key in outputs)) throw new Error(`Unexpected command: ${key}`);
        return outputs[key];
      },
      write: (path, value) => writes.push({ path, value }),
    },
  };
}

test('preflight accepts only a clean, remotely published commit and the linked app project', () => {
  const { io } = fixture();
  assert.deepEqual(preflight(io), { branch: 'main', commitSha: SHA, projectId: PROJECT, orgId: TEAM, alias: ALIAS });
});

test('preflight refuses a dirty checkout before any Vercel call', () => {
  const { io, calls } = fixture({ outputs: { 'git status --porcelain --untracked-files=all': ' M app/src/App.jsx\n' } });
  assert.throws(() => preflight(io), /clean checkout/);
  assert.equal(calls.some((call) => call.startsWith('vercel')), false);
});

test('preflight refuses an unpublished or moved branch', () => {
  const { io } = fixture({ outputs: { 'git ls-remote origin refs/heads/main': `${'b'.repeat(40)}\trefs/heads/main\n` } });
  assert.throws(() => preflight(io), /remote branch.*HEAD/);
});

test('deploy records exact source and verified READY production alias', () => {
  const { io, calls, writes } = fixture();
  const record = deploy(io);
  assert.equal(record.commitSha, SHA);
  assert.equal(record.branch, 'main');
  assert.equal(record.deploymentId, 'dpl_123');
  assert.equal(record.deploymentUrl, 'https://shafan-hasela-abc.vercel.app');
  assert.equal(record.productionAlias, `https://${ALIAS}`);
  assert.ok(calls.some((call) => call.includes('vercel deploy --prod --cwd app --meta sourceBranch=main')));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '.vercel/production-deployments/dpl_123.json');
  assert.deepEqual(JSON.parse(writes[0].value), record);
});

test('deploy refuses to record an unaliased deployment', () => {
  const key = `vercel api /v4/aliases/${ALIAS}?projectId=${PROJECT}&teamId=${TEAM} --cwd app`;
  const { io, writes } = fixture({ outputs: { [key]: JSON.stringify({ alias: ALIAS, projectId: PROJECT, deploymentId: 'dpl_other' }) } });
  assert.throws(() => deploy(io), /production alias/);
  assert.equal(writes.length, 0);
});

test('status resolves the current alias and compares its source commit with GitHub main', () => {
  const { io } = fixture();
  assert.deepEqual(status(io), {
    productionAlias: `https://${ALIAS}`,
    deploymentId: 'dpl_123',
    deploymentUrl: 'https://shafan-hasela-abc.vercel.app',
    status: 'READY',
    branch: 'main',
    commitSha: SHA,
    githubMainSha: SHA,
    matchesGithubMain: true,
  });
});

test('status marks older deployments without source metadata as unknown', () => {
  const key = `vercel api /v13/deployments/dpl_123?teamId=${TEAM} --cwd app`;
  const { io } = fixture({ outputs: { [key]: JSON.stringify({ id: 'dpl_123', projectId: PROJECT, readyState: 'READY', url: 'shafan-hasela-abc.vercel.app', meta: {} }) } });
  const current = status(io);
  assert.equal(current.branch, null);
  assert.equal(current.commitSha, null);
  assert.equal(current.matchesGithubMain, null);
});

test('command line requires an explicit deploy flag', () => {
  const script = fileURLToPath(new URL('./production-deploy.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--deploy/);
});
