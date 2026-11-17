#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, win32 } from 'node:path';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PROJECT_ID = 'prj_6rvjmBAfEUpym5E4JwVPut1HiXQC';
const ORG_ID = 'team_wBjKr13fvum5krxkUPPpeEuQ';
const ALIAS = 'shafan-hasela-vercal.vercel.app';

function requireValue(value, message) {
  if (!value) throw new Error(message);
  return value;
}

export function resolveCommand(command, args, {
  platform = process.platform,
  pathEnv = process.env.PATH ?? process.env.Path ?? '',
  exists = existsSync,
  nodeExecutable = process.execPath,
} = {}) {
  if (command !== 'vercel' || platform !== 'win32') return { file: command, args };

  for (const directory of pathEnv.split(';').filter(Boolean)) {
    const executable = win32.join(directory, 'vercel.exe');
    if (exists(executable)) return { file: executable, args };

    const shim = win32.join(directory, 'vercel.cmd');
    if (!exists(shim)) continue;
    const entries = [
      win32.join(directory, '..', 'vercel', 'dist', 'vc.js'),
      win32.join(directory, 'node_modules', 'vercel', 'dist', 'vc.js'),
    ];
    const entry = entries.find(exists);
    if (!entry) throw new Error(`Found ${shim} but could not locate its Vercel JavaScript entry`);
    return { file: nodeExecutable, args: [entry, ...args] };
  }
  throw new Error('Vercel CLI was not found in PATH');
}

export function preflight(io) {
  const config = JSON.parse(requireValue(io.read('app/vercel.json'), 'Missing app/vercel.json'));
  if (config.git?.deploymentEnabled !== false) {
    throw new Error('app/vercel.json must disable automatic Git deployments');
  }

  const link = JSON.parse(requireValue(io.read('.vercel/project.json'), 'Link the repository root to the existing Vercel project before deploying'));
  if (link.projectId !== PROJECT_ID || link.orgId !== ORG_ID) {
    throw new Error('Repository root is linked to the wrong Vercel project or team');
  }

  const branch = io.run('git', ['branch', '--show-current']).trim();
  if (!branch) throw new Error('Detached HEAD is not allowed for production deployment');
  const commitSha = io.run('git', ['rev-parse', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('Could not resolve an exact Git commit SHA');
  if (io.run('git', ['status', '--porcelain', '--untracked-files=all']).trim()) {
    throw new Error('Production deployment requires a clean checkout');
  }
  const remote = io.run('git', ['ls-remote', 'origin', `refs/heads/${branch}`]).trim().split(/\s+/)[0];
  if (remote !== commitSha) throw new Error('The remote branch must point to local HEAD before deployment');
  const project = JSON.parse(io.run('vercel', [
    'api', `/v9/projects/${PROJECT_ID}?teamId=${ORG_ID}`, '--cwd', '.',
  ]));
  if (project.id !== PROJECT_ID || project.rootDirectory !== 'app' || project.framework !== 'vite') {
    throw new Error('Vercel project must have Root Directory app and Vite framework');
  }

  return { branch, commitSha, projectId: PROJECT_ID, orgId: ORG_ID, alias: ALIAS };
}

export function deploy(io) {
  const source = preflight(io);
  const deploymentUrl = io.run('vercel', [
    'deploy', '--prod', '--cwd', '.',
    '--meta', `sourceBranch=${source.branch}`,
    '--meta', `sourceCommitSha=${source.commitSha}`,
  ]).trim();
  const host = new URL(deploymentUrl).hostname;
  if (!host.endsWith('.vercel.app')) throw new Error(`Unexpected deployment URL: ${deploymentUrl}`);

  io.run('vercel', ['inspect', deploymentUrl, '--wait', '--cwd', '.']);
  const deployment = JSON.parse(io.run('vercel', [
    'api', `/v13/deployments/${host}?teamId=${source.orgId}`, '--cwd', '.',
  ]));
  if (deployment.projectId !== source.projectId || deployment.target !== 'production' || deployment.readyState !== 'READY') {
    throw new Error(`Deployment ${deployment.id ?? deployment.uid ?? deploymentUrl} is not READY in the intended Production project`);
  }
  if (deployment.meta?.sourceBranch !== source.branch || deployment.meta?.sourceCommitSha !== source.commitSha) {
    throw new Error('Vercel did not retain the exact source branch and commit metadata');
  }

  const deploymentId = requireValue(deployment.id ?? deployment.uid, 'Vercel did not return a deployment ID');
  const alias = getProductionAlias(io);
  if (alias.deploymentId !== deploymentId) {
    throw new Error(`Deployment ${deploymentId} does not currently own production alias ${source.alias}`);
  }
  const record = {
    recordedAt: new Date().toISOString(),
    branch: source.branch,
    commitSha: source.commitSha,
    deploymentId,
    deploymentUrl,
    productionAlias: `https://${source.alias}`,
    projectId: source.projectId,
    status: 'READY',
  };
  io.write(`.vercel/production-deployments/${deploymentId}.json`, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function getProductionAlias(io) {
  const alias = JSON.parse(io.run('vercel', [
    'api', `/v4/aliases/${ALIAS}?projectId=${PROJECT_ID}&teamId=${ORG_ID}`, '--cwd', '.',
  ]));
  if (alias.alias !== ALIAS || alias.projectId !== PROJECT_ID || !alias.deploymentId) {
    throw new Error(`Could not verify production alias ${ALIAS}`);
  }
  return alias;
}

export function status(io) {
  const alias = getProductionAlias(io);
  const deployment = JSON.parse(io.run('vercel', [
    'api', `/v13/deployments/${alias.deploymentId}?teamId=${ORG_ID}`, '--cwd', '.',
  ]));
  if (deployment.projectId !== PROJECT_ID || (deployment.id ?? deployment.uid) !== alias.deploymentId) {
    throw new Error('Production alias resolves outside the expected Vercel project');
  }
  const githubMainSha = io.run('git', ['ls-remote', 'origin', 'refs/heads/main']).trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(githubMainSha)) throw new Error('Could not resolve GitHub main');
  const commitSha = deployment.meta?.sourceCommitSha ?? null;
  return {
    productionAlias: `https://${ALIAS}`,
    deploymentId: alias.deploymentId,
    deploymentUrl: `https://${deployment.url}`,
    status: deployment.readyState,
    branch: deployment.meta?.sourceBranch ?? null,
    commitSha,
    githubMainSha,
    matchesGithubMain: commitSha === null ? null : commitSha === githubMainSha,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 3 || !['--deploy', '--status'].includes(process.argv[2])) {
    console.error('Usage: node scripts/vercel/production-deploy.mjs --status|--deploy');
    process.exitCode = 2;
  } else {
    const io = {
      read: (path) => readFileSync(join(ROOT, path), 'utf8'),
      run: (command, args) => {
        const invocation = resolveCommand(command, args);
        return execFileSync(invocation.file, invocation.args, {
          cwd: ROOT, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], shell: false,
        });
      },
      write: (path, value) => {
        const fullPath = join(ROOT, path);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, value, { flag: 'wx' });
      },
    };
    try {
      console.log(JSON.stringify(process.argv[2] === '--deploy' ? deploy(io) : status(io), null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
