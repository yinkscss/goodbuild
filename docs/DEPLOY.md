# Deploying GoodBuild

How production runs today, for anyone (person or agent) working on it. Decision: D27. Never put secrets in this file or in git.

## What runs where
- **Server:** VPS at `193.181.221.210` (iHostio; the owner has written permission for blockchain and testnet work, required by its terms). Ubuntu, with Docker and Coolify.
- **Code and config:** `/opt/goodbuild`. Secrets: `/opt/goodbuild/deploy/.env.production` (mode 600, server only). Template: `deploy/env.production.example`.
- **Containers** (`deploy/docker-compose.yml`, project `goodbuild`): `postgres` (no public port), `migrate` (runs once per deploy), `web` (`next start`) and `worker` (`pnpm worker`, `TURN_CONCURRENCY` builds at once).
- **Traffic:** visitor → Cloudflare → Coolify's Traefik (`coolify-proxy`, ports 80 and 443) → `web`, routed by the labels in the compose file. Published apps use the same route at `<slug>.goodbuildit.xyz`, and `src/proxy.ts` separates them by Host.
- **Coolify** is kept on the server for now by the owner's choice, but the app isn't managed through it. Only its proxy is used. Don't change settings in its dashboard expecting them to affect GoodBuild.

## Access
SSH as root with the deploy key, which is not in git:
```bash
ssh -i .data/goodbuild-deploy -o IdentitiesOnly=yes -o UserKnownHostsFile=.data/known_hosts root@193.181.221.210
```
`.data/` is in the `landing-publish` worktree. If that worktree is removed, move the key first, or have the owner add a new one.

## Deploy
From the repo root, with your changes committed:
```bash
deploy/deploy.sh
```
It copies HEAD, rebuilds the image on the server, runs migrations and restarts. The build takes several minutes.

## Everyday commands (on the server, in /opt/goodbuild/deploy)
```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f web worker
docker compose --env-file .env.production restart web worker
```
- Take a published app down: `docker compose --env-file .env.production exec web sh -c 'node scripts/takedown.mjs <slug>'`. Add `--restore` to bring it back.
- `NEXT_PUBLIC_*` values are fixed at build time, so changing one needs a deploy. Other values need a restart with `up -d`.

## Backups
`deploy/backup.sh` runs nightly from root's crontab and keeps 7 days in `/var/backups/goodbuild`. They're on the same server, so a lost server loses them too. Copy one off with `scp` before ending a term or changing anything risky.

Restore into an empty database:
```bash
docker compose --env-file .env.production exec -T postgres pg_restore -U goodbuild -d goodbuild --clean --if-exists < /var/backups/goodbuild/<file>.dump
```

## Requirements that are easy to break
- **Cloudflare must proxy `goodbuildit.xyz` and `*.goodbuildit.xyz`**, with SSL mode **Full**. The US and sanctions block reads `cf-ipcountry`. With no proxy there is no header, and the block lets everyone through.
- **Firewall:** Docker's published ports skip `ufw`, so the rules that restrict 80 and 443 to Cloudflare's IPs are in the `DOCKER-USER` chain. Without them, a visitor could reach the server directly, fake a country header and skip the block.
- Don't set `BACKEND_ORIGIN` or `EDGE_SECRET` here. They're for the Vercel setup (D26), and `EDGE_SECRET` alone makes the server refuse everything.
- Solidity compiling reads `node_modules` at runtime, so the image can't be pruned or made standalone.

## Status of this setup
See "Hosting" in `HANDOFF.md`. It has one server and no failover, which suits the one-month testnet beta. Before M6 takes real money, move the database off the box and copy backups elsewhere.
