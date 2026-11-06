# Deploying GoodBuild

How production runs today, for anyone (person or agent) working on it. Decision: D27. Never put secrets in this file or in git.

## What runs where
- **Server:** VPS at `193.181.221.210` (iHostio; the owner has written permission for blockchain and testnet work, required by its terms). Ubuntu, with Docker and Coolify.
- **Code and config:** `/opt/goodbuild`. Secrets: `/opt/goodbuild/deploy/.env.production` (mode 600, server only). Template: `deploy/env.production.example`.
- **Containers** (`deploy/docker-compose.yml`, project `goodbuild`): `goodbuild-postgres` (no public port), `migrate` (runs once per deploy), `web` (`next start`) and `worker` (`pnpm worker`, `TURN_CONCURRENCY` builds at once).
- **Traffic:** visitor → Cloudflare → Coolify's Traefik (`coolify-proxy`, ports 80 and 443) → `web`, routed by the labels in the compose file. Published apps use the same route at `<slug>.goodbuildit.xyz`, and `src/proxy.ts` separates them by Host.
- **Coolify** is kept on the server for now by the owner's choice, but the app isn't managed through it. Only its proxy is used. Don't change settings in its dashboard expecting them to affect GoodBuild.

## Access
SSH as root with the deploy key, which is not in git:
```bash
ssh -i .data/goodbuild-deploy -o IdentitiesOnly=yes -o UserKnownHostsFile=.data/known_hosts root@193.181.221.210
```
`.data/` is in the `landing-publish` worktree. If that worktree is removed, move the key first, or have the owner add a new one.

## Reaching Coolify
Its ports aren't public. From a machine with the deploy key, open a tunnel, then browse to http://localhost:8000:
```bash
ssh -i .data/goodbuild-deploy -o IdentitiesOnly=yes -o UserKnownHostsFile=.data/known_hosts -L 8000:localhost:8000 -L 6001:localhost:6001 -L 6002:localhost:6002 root@193.181.221.210
```

## Deploy
**Automatic:** a push to `main`, which normally means a merged pull request, runs the Deploy workflow (`.github/workflows/deploy.yml`). It runs the checks on that exact commit, and deploys only if they pass. Check the result in the repo's Actions tab. Merging is still a production release, so the migration must be safe before you merge. To redeploy without a merge, run the Deploy workflow by hand on `main` from that tab. The checks run first then too, and on any other branch it runs the checks and doesn't deploy.

**The checks** (`.github/workflows/ci.yml`) are lint, typecheck, the full tests, the build and `deploy/test-release.sh`. They run on every pull request and again on `main` before a deploy. A pull request's failed check only blocks its merge if the branch rule below is on. Whether or not it is, a commit that fails on `main` doesn't deploy.

**What doesn't deploy:** a push that changes only `docs/`, since `.dockerignore` keeps that folder out of the image. Root files such as `README.md` do go into the image, so they still deploy. If a deploy failed and a docs-only merge followed, nothing retries it, so run Deploy by hand.

**If several merges land close together:** runs go one at a time, and a newer waiting run replaces an older waiting one, which shows as cancelled. That's normal, since the newer commit contains the older one.

**By hand:** from the repo root, with your changes committed:
```bash
deploy/deploy.sh
```
It copies HEAD, rebuilds the image on the server, runs migrations and restarts. The build takes several minutes. **This skips the checks,** so keep it for when GitHub Actions is down. Deploying a branch by hand leaves the server ahead of `main`, and the next deploy replaces it.

The workflow's GitHub secrets are `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (the server's pinned host key) and `DEPLOY_HOST`. If you change the key on the server, update them too.

### Branch rule (owner only, in GitHub)
This stops a pull request with failing checks from being merged. Settings → Branches → Add classic branch protection rule:
1. Branch name pattern: `main`.
2. Tick "Require a pull request before merging". Set required approvals to 0 unless someone else reviews.
3. Tick "Require status checks to pass before merging", then search for and choose `Lint, types, tests, build`. It's only listed once a pull request has run it.
4. Leave "Require branches to be up to date before merging" off. `main` is tested again before each deploy, so a stale pull request can't ship untested, and this avoids rerunning the checks after every merge.
5. Tick "Do not allow bypassing the above settings" so the rule also binds admins.

An open pull request from before CI existed shows the check as "Expected" until its next push, or until it's closed and reopened.

## Rollback
Each deploy tags its image `goodbuild:sha-<first 12 of the commit>`, and the newest 5 stay. `goodbuild:previous` is the image that ran before the last deploy. `goodbuild:latest` is what's running.

On the server, or from a machine with the deploy key (the same `ssh` command as under Access, followed by the path):
```bash
/opt/goodbuild/deploy/rollback.sh previous      # go back one deploy
/opt/goodbuild/deploy/rollback.sh               # list the images, changing nothing
/opt/goodbuild/deploy/rollback.sh sha-abc123def456   # go back to a chosen commit
```
It restarts `web` and `worker` from an image already on the server, in seconds, with no rebuild and no checks. It leaves the database and `migrate` alone. A build in progress is interrupted, as in any deploy.

**Then revert the bad commit on `main`.** The rollback only lasts until the next deploy, which ships `main` again, bad commit included. The revert's own deploy keeps the rolled-back image as `previous`.

**A rollback can't undo a migration.** The database stays as the newer code left it, and old code runs against it.

| What the bad deploy's migration did | Is rollback safe? |
|---|---|
| Nothing | Yes |
| Added a table, or a column that's nullable or has a default | Yes. Old code ignores them. Check that the new code didn't write values the old code can't read, such as a new status. |
| Added a unique index, check or foreign key to an existing table | **Maybe not.** It still looks like an addition, but old code's writes fail if they break the new rule. Check that they can't. |
| Added a `NOT NULL` column with no default | **No.** Old code's inserts fail. |
| Dropped or renamed a table or column, or changed a type | **No.** Old code's queries fail. |

So migrations only add, and in ways old code can still write to. To remove or rename something, stop using it in one deploy and drop it in a later one, once rolling back past that point is no longer needed. Searching `0000` to `0009` found no drop, rename or type change, and no added `NOT NULL` column without a default. In `0005` to `0009`, the one constraint added to an existing table is the unique index `publications_client_idx` in `0006`. These were text searches of the SQL, not a test of old code against the new schema. Before rolling back, check what's new with `git diff --stat <good commit> <bad commit> -- drizzle`.

If the migration itself is the problem, a rollback won't fix it. The options are a new forward migration, which is the normal answer, or restoring a backup (below), which **loses everything written since that backup**. Once real money is in the database, don't restore without reconciling against Paystack and the chain.

A rollback also doesn't change `.env.production` or the files in `/opt/goodbuild`, including the compose file. `NEXT_PUBLIC_*` values go back with the image, since they're fixed at build time.

**How far this is tested:** `deploy/test-release.sh` runs both scripts against real Docker in CI, on a throwaway project. UNVERIFIED on the production server until the owner runs the test below. Disk use per image is also UNVERIFIED. The first production run (6 Nov) failed with "No such image" when it tagged the old image by its ID after the build, though CI had passed. Nothing restarted. `release.sh` now holds the old image by name (`outgoing`) before building. Why the server lost the ID is UNVERIFIED (a different Docker image store is likely).

### Test it once on production (owner, before step B of the launch plan)
Do this right after the first deploy that includes these scripts, at a quiet time. That deploy adds no migration, so going back is safe. Run these in `/opt/goodbuild/deploy`:
1. `df -h /` and `docker system df`. Note the free disk.
2. `./rollback.sh`, to see the list. `previous` should be there. Note the `sha-` tag that has the same image ID as `latest`.
3. `./rollback.sh previous`
4. `docker compose --env-file .env.production ps`, and open https://goodbuildit.xyz/. Both containers should be up and the site should load.
5. `./rollback.sh sha-<the tag from step 2>`, to return. Repeat step 4.
6. Record the date and how long the site was down in this file.

## Everyday commands (on the server, in /opt/goodbuild/deploy)
```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f web worker
docker compose --env-file .env.production restart web worker
```
- Real AI spend so far, against the free budget (D29; `FREE_AI_BUDGET_MICRO`, default 4000000 = $4): `docker compose --env-file .env.production exec -T goodbuild-postgres psql -U goodbuild -d goodbuild -c 'select sum(provider_cost_micro)/1000000.0 as usd from usage_events'`. A changed setting needs `up -d web worker`, because a restart doesn't reread the env file.
- Take a published app down: `docker compose --env-file .env.production exec web sh -c 'node scripts/takedown.mjs <slug>'`. Add `--restore` to bring it back.
- A takedown also stops the app's data API and keeps its data. Add `--purge-data` to delete what visitors saved in it (D31).
- App data on the whole server: `docker compose --env-file .env.production exec -T goodbuild-postgres psql -U goodbuild -d goodbuild -c "select count(*) as apps, sum(rows) as records, pg_size_pretty(sum(bytes)) as size from app_data_usage where wallet = '*'"`. The limit is `APP_DATA_MAX_TOTAL_BYTES` (default 1 GB). Set it to suit the free disk.
- `NEXT_PUBLIC_*` values are fixed at build time, so changing one needs a deploy. Other values need a restart with `up -d`.

## Backups
`deploy/backup.sh` runs nightly from root's crontab and keeps 7 days in `/var/backups/goodbuild`. They're on the same server, so a lost server loses them too. Since D31 these also hold what published apps' visitors saved, including records deleted in the last 7 days. Copy one off with `scp` before ending a term or changing anything risky.

Restore into an empty database:
```bash
docker compose --env-file .env.production exec -T goodbuild-postgres pg_restore -U goodbuild -d goodbuild --clean --if-exists < /var/backups/goodbuild/<file>.dump
```

## DNS (Cloudflare)
`goodbuildit.xyz` and `*` are `A` records to the server, `www` is a `CNAME` to the root, all Proxied. SSL/TLS is Full. The `MX` and SPF `TXT` records are Namecheap email forwarding and were left alone.

## Requirements that are easy to break
- **Cloudflare must proxy `goodbuildit.xyz` and `*.goodbuildit.xyz`**, with SSL mode **Full**. The US and sanctions block reads `cf-ipcountry`. With no proxy there is no header, and the block lets everyone through.
- **Firewall (`deploy/firewall.sh`, run at boot by `goodbuild-firewall.service`):** Docker's published ports skip `ufw`, so the rules are in the `DOCKER-USER` chain. Only Cloudflare reaches 80 and 443, and Coolify's ports (8000, 8080, 6001, 6002) are closed to the internet. Without this, a visitor could reach the server directly, fake a country header and skip the block. If Cloudflare publishes new IP ranges, restart the service.
- Don't set `BACKEND_ORIGIN` or `EDGE_SECRET` here. They're for the Vercel setup (D26), and `EDGE_SECRET` alone makes the server refuse everything.
- **Keep the database's service name unique.** `web` joins Coolify's network, where `postgres` is Coolify's own database. With that name, web connected to the wrong server and got a password error.
- **Magic's content security policy** (Magic dashboard, Settings) must list `https://forno.celo-sepolia.celo-testnet.org` and `https://forno.celo.org`. Without them, email wallets can sign in but deploys fail with `[-32603] Failed to fetch`. Changing the RPC URL or the Magic app means updating this too.
- Solidity compiling reads `node_modules` at runtime, so the image can't be pruned or made standalone.

## Known issues
- **Preview:** the live preview loads its bundler from CodeSandbox. It sometimes answers 503 and the preview shows "Couldn't connect to server" with `TIME_OUT`, and pressing Try again worked when this happened on 5 Nov 2026. The site isn't at fault. Self-hosting the bundler would remove this (Q36).
- **`backup.sh` reads stdin** through `docker compose exec`, so don't chain it before another command that needs the same input.

## Testing the live site
The throwaway wallet in `.data/throwaway-wallet.key` (Celo Sepolia only) can sign in and deploy from a script. A real build costs real AI money, about $0.35 for a one-contract app. Delete its test data afterwards. Its address is in `HANDOFF.md`.

## Status of this setup
See "Hosting" in `HANDOFF.md`. It has one server and no failover, which suits the one-month testnet beta. Before M6 takes real money, move the database off the box and copy backups elsewhere.
