# Manual Production deployment

The Vercel project uses `app/` as its Root Directory. Keep the GitHub integration connected; `app/vercel.json` disables automatic Git deployments. Production is deployed only by an operator running the Vercel CLI.

Prerequisites: Node.js, Vercel CLI 50.5.1 or newer (for `vercel api`), CLI authentication to the project team, and `app/.vercel/project.json` linked to the existing `shafan-hasela-vercal` project. If the local link is absent, run `vercel link --cwd app` and select the **existing** project. The script verifies its project and team IDs before deploying. The link and deployment records are ignored by Git.

From the repository root, after checkout of a clean branch whose HEAD is pushed to `origin`:

```sh
node scripts/vercel/production-deploy.mjs --deploy
```

The script deploys `app/` with `--prod`, attaches `sourceBranch` and `sourceCommitSha` metadata, waits for completion, confirms READY status and that `shafan-hasela-vercal.vercel.app` points to the resulting deployment. It prints a JSON record and saves it in `.vercel/production-deployments/<deployment-id>.json`. If verification fails after the CLI starts a deployment, the script exits with an error and does not write a success record; inspect the URL printed by Vercel before taking further action.

Read-only current version check:

```sh
node scripts/vercel/production-deploy.mjs --status
```

The status command resolves the live alias and compares its recorded commit with GitHub `main`. Older CLI deployments may not carry the new metadata, so their branch, commit, and comparison appear as `null` until a deployment is made with this script.
