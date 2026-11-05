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
**Automatic:** merging a pull request to `main` deploys it (`.github/workflows/deploy.yml`). Check the result in the repo's Actions tab. Merging is therefore a production release, so CI must pass and the migration must be safe before you merge. To redeploy without a merge, run the Deploy workflow by hand from that tab.

**By hand:** from the repo root, with your changes committed:
```bash
deploy/deploy.sh
```
It copies HEAD, rebuilds the image on the server, runs migrations and restarts. The build takes several minutes. Deploying a branch by hand leaves the server ahead of `main`, and the next merge replaces it.

The workflow's GitHub secrets are `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (the server's pinned host key) and `DEPLOY_HOST`. If you change the key on the server, update them too.

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
docker compose --env-file .env.production exec -T goodbuild-postgres pg_restore -U goodbuild -d goodbuild --clean --if-exists < /var/backups/goodbuild/<file>.dump
```

## DNS (Cloudflare)
`goodbuildit.xyz` and `*` are `A` records to the server, `www` is a `CNAME` to the root, all Proxied. SSL/TLS is Full. The `MX` and SPF `TXT` records are Namecheap email forwarding and were left alone.

## Requirements that are easy to break
- **Cloudflare must proxy `goodbuildit.xyz` and `*.goodbuildit.xyz`**, with SSL mode **Full**. The US and sanctions block reads `cf-ipcountry`. With no proxy there is no header, and the block lets everyone through.
- **Firewall (`deploy/firewall.sh`, run at boot by `goodbuild-firewall.service`):** Docker's published ports skip `ufw`, so the rules are in the `DOCKER-USER` chain. Only Cloudflare reaches 80 and 443, and Coolify's ports (8000, 8080, 6001, 6002) are closed to the internet. Without this, a visitor could reach the server directly, fake a country header and skip the block. If Cloudflare publishes new IP ranges, restart the service.
- Don't set `BACKEND_ORIGIN` or `EDGE_SECRET` here. They're for the Vercel setup (D26), and `EDGE_SECRET` alone makes the server refuse everything.
- **Keep the database's service name unique.** `web` joins Coolify's network, where `postgres` is Coolify's own database. With that name, web connected to the wrong server and got a password error.
- Solidity compiling reads `node_modules` at runtime, so the image can't be pruned or made standalone.

## Known issues
- **Preview:** the live preview loads its bundler from CodeSandbox. It sometimes answers 503 and the preview shows "Couldn't connect to server" with `TIME_OUT`, and pressing Try again worked when this happened on 5 Nov 2026. The site isn't at fault. Self-hosting the bundler would remove this (Q36).
- **`backup.sh` reads stdin** through `docker compose exec`, so don't chain it before another command that needs the same input.

## Testing the live site
The throwaway wallet in `.data/throwaway-wallet.key` (Celo Sepolia only) can sign in and deploy from a script. A real build costs real AI money, about $0.35 for a one-contract app. Delete its test data afterwards. Its address is in `HANDOFF.md`.

## Status of this setup
See "Hosting" in `HANDOFF.md`. It has one server and no failover, which suits the one-month testnet beta. Before M6 takes real money, move the database off the box and copy backups elsewhere.
