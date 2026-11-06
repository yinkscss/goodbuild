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
Two kinds run side by side. Keep both.

**Nightly, on the server:** `deploy/backup.sh` runs from root's crontab and keeps 7 days in `/var/backups/goodbuild`. A lost server loses them too. Since D31 they also hold what published apps' visitors saved, including records deleted in the last 7 days. They're the quickest way back from a bad migration, with no key or download. On 6 Nov a read-only check found one cron entry and one systemd timer for backups. Whether both run `backup.sh` is UNVERIFIED (`crontab -l`, `systemctl list-timers`). If they do, remove one.

Restore a nightly copy into an empty database:
```bash
docker compose --env-file .env.production exec -T goodbuild-postgres pg_restore -U goodbuild -d goodbuild --clean --if-exists < /var/backups/goodbuild/<file>.dump
```

### Off-site backups (D47)
**Not running until the owner does the setup below.**

`deploy/offsite-backup.sh` runs every hour from `goodbuild-offsite-backup.timer`:
1. It takes a `pg_dump` (custom format) of `goodbuild-postgres`. In the same database snapshot it records the figures in `deploy/backup-checks.sql`: rows per table and the ledger totals (D46).
2. It encrypts the dump and figures with [age](https://age-encryption.org) to the owner's **public** key. The private key never goes on the server, so someone who takes over the server can't read old backups.
3. It uploads the file twice: as `hourly/goodbuild-<UTC time>.tar.age`, and over `daily/goodbuild-<date>.tar.age`, so each day keeps its last good copy. `curl` signs the upload, and the bucket key reaches it on stdin, never on the command line or in logs.
4. It pings a health check at start, on success and on failure.

| What | Kept for | Why |
|---|---|---|
| `hourly/` | 48 hours | Recent mistakes lose at most an hour. Two days covers a weekend's late discovery. |
| `daily/` | 30 days | Covers problems noticed late, such as a slow data bug. Longer keeps deleted user data longer than needed (D31). |
| Nightly on the server | 7 days | Fast local restore. Unchanged. |

The bucket's own lifecycle rules delete old copies, not the script. So the server's key only needs to write. A server that's taken over can't delete the off-site copies.

**Size and cost:** each copy is about the size of the nightly dump (about 760 KB on 6 Nov), so 78 copies come to well under 1 GB.

**Recommended destination: Backblaze B2** (the owner still has to choose, D47). B2 application keys can be made **write-only**, which suits the design above. Cloudflare R2 works with the same scripts, and the domain is already on Cloudflare. All prices below are UNVERIFIED, so check before signing up:
- **B2:** the first 10 GB is free, then about $6 to $7 per TB a month. It's UNVERIFIED whether signing up needs a card.
- **R2:** the first 10 GB a month is free, then about $0.015 per GB, with no download fees. Cloudflare asks for a payment method before turning R2 on (UNVERIFIED). D27 records a declined card at another vendor. Whether R2 tokens can be write-only is also UNVERIFIED.

At this size either should cost $0 a month.

#### Setup (owner)
These files reach `/opt/goodbuild/deploy` with the first deploy after this is merged.

**1. Make the encryption key on your own computer, not the server.**
```bash
brew install age            # or: apt install age
age-keygen -o ~/goodbuild-backup.agekey
```
It prints `Public key: age1...`. That public key goes on the server. The file holds the private key:
- Store it in your password manager.
- Keep a second copy offline, such as printed or on a USB stick kept elsewhere.
- **If the private key is lost, every backup is unreadable.** If it leaks, make a new key, put the new public key on the server, and treat old backups as readable by whoever has it.
- Optionally, add a second person's public key on another line of the recipients file. Either key can then restore.

**2. Make the bucket (B2):**
- Create a private bucket, such as `goodbuild-db-backups`, with default encryption on.
- Lifecycle rules (Lifecycle Settings, custom), all UNVERIFIED against B2's current screens:
  - `hourly/`: hide after 2 days, delete 1 day after hiding.
  - `daily/`: hide after 30 days, delete 1 day after hiding.
  - The day's copy is overwritten every hour. Hiding then deletion also removes those older versions.
- Create two application keys, both limited to this bucket:
  - **Write Only,** for the server.
  - **Read Only,** for restore drills, kept on your computer.
- Note the S3 endpoint shown on the bucket page, such as `s3.us-west-004.backblazeb2.com`. The region is the part after `s3.`.

**3. Make the alert:** a free [healthchecks.io](https://healthchecks.io) account (free plan UNVERIFIED). Add a check with period **1 hour** and grace **1 hour**, and email yourself. You'll then hear within about 2 hours of the last good backup. This also works when the server itself is down, which a check run on the server can't do. Copy its ping URL.
- A failed run pings `/fail`, which marks the check down straight away. So one bad hour emails you, not only 2 hours of silence.
- A blank `HEALTHCHECK_URL` turns the alert off without any warning.

**4. Install on the server, as root:**
```bash
apt-get install -y age
curl --version | head -1    # needs 7.75 or newer, for --aws-sigv4
install -d -m 755 /usr/local/lib/goodbuild-backup
install -m 755 /opt/goodbuild/deploy/offsite-backup.sh /usr/local/lib/goodbuild-backup/
install -m 644 /opt/goodbuild/deploy/backup-checks.sql /usr/local/lib/goodbuild-backup/
install -d -m 700 /etc/goodbuild
install -m 600 /opt/goodbuild/deploy/offsite-backup.env.example /etc/goodbuild/offsite-backup.env
nano /etc/goodbuild/offsite-backup.env   # endpoint, region, bucket, the WRITE-ONLY key, ping URL
echo 'age1...your public key...' > /etc/goodbuild/backup-recipients.txt
/usr/local/lib/goodbuild-backup/offsite-backup.sh   # by hand first: expect "ok: hourly/..."
install -m 644 /opt/goodbuild/deploy/goodbuild-offsite-backup.service /opt/goodbuild/deploy/goodbuild-offsite-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now goodbuild-offsite-backup.timer
systemctl list-timers goodbuild-offsite-backup.timer
```
- **Why not `.env.production`:** the keys live in `/etc/goodbuild`, because `.env.production` is passed to the web and worker containers.
- **Why `/usr/local/lib`:** the script runs from there, so a deploy can't replace it mid-run. After a change to `offsite-backup.sh` or `backup-checks.sql`, run the two `install -m` lines again.
- **Logs:** `journalctl -u goodbuild-offsite-backup -n 50`.
- **Exit codes:** 75 means the previous run still held the lock, and that run did nothing.

**5. Run the first restore drill** (below) within a day, and record it.

#### Restore drill (owner, monthly, and before step B of the launch plan)
`deploy/restore-drill.sh` downloads a backup and decrypts it with your private key. It restores the backup into a new, throwaway Postgres container, with no network and a random name, deleted afterwards. Then it checks that every figure taken at backup time comes out the same. It never connects to production or any other database.

Run it on your own computer, which needs Docker, `age` and `curl`. The private key then never touches the server. It has only been run on Ubuntu (in CI). Running it on a Mac is UNVERIFIED. macOS's built-in bash is 3.2, so if it fails there, run it with `/opt/homebrew/bin/bash` or `/usr/local/bin/bash` (`brew install bash`).
1. Copy `deploy/offsite-backup.env.example` to `~/.config/goodbuild/restore.env` and `chmod 600` it.
2. Fill in the endpoint, region, bucket and the **read-only** key. Leave the server-only lines.
3. Run:
```bash
deploy/restore-drill.sh --identity ~/goodbuild-backup.agekey --latest
```
- It ends with `PASS` or `FAIL` and prints a record line. Add the line to the table below.
- For a chosen copy, use `--key daily/goodbuild-2026-11-06.tar.age`.
- For a downloaded file, use `--file <path>`.

| Date | Backup restored | Contents | Restore time | Result | By |
|---|---|---|---|---|---|
| YYYY-MM-DD | (first drill not yet run) | | | | |

**Ledger totals:** the ledger (D46, migration 0010) is on `main`, so once it has been deployed the figures also include the ledger total, the balance total, the last entry number, and how many balances differ from their entries (must be 0). Before 0010 runs, those lines are simply absent.

#### Recovering production from an off-site copy (not yet drilled)
1. Decrypt on your computer:
```bash
age -d -i ~/goodbuild-backup.agekey -o payload.tar <file>.tar.age && tar -xf payload.tar goodbuild.dump
```
   - `--latest` only looks in `hourly/`, so after about 48 hours with no backups it finds nothing. Name a daily copy instead: `--key daily/goodbuild-<date>.tar.age`, or download it.
2. Copy `goodbuild.dump` to the server.
3. Stop `web` and `worker`, restore it with the nightly command above, and start them again.
4. This **loses everything written since that backup.** With real money in the database, reconcile against Paystack and the chain before reopening.

#### How far this is tested
`deploy/test-offsite-backup.sh` runs in CI on every pull request. It uses real Postgres 16, real `age`, MinIO standing in for the bucket, and keys made up for the run. It covers:
- The backup and restore cycle, with exact matching of the figures.
- Picking the newest copy.
- The wrong key, a corrupted file and a truncated file.
- A refused upload, a held lock and the database being down. Each of these fails cleanly, pings `/fail` where it should, and leaves no plain dump behind.
- A readable config, and a private key put where the public one belongs. Both are refused.

**The deploy gate depends on an archived image.** MinIO's own images have left Docker Hub, and quay.io refused the pull. So the test uses `bitnamilegacy/minio`, which gets no updates and may be removed. This test is part of the required check, so if that pull starts failing, deploys are blocked. The fix is to swap in a maintained stand-in, such as versitygw or rustfs.

UNVERIFIED until the owner's first run:
- B2's (or R2's) acceptance of these signed uploads.
- That B2's write-only key allows the upload.
- The lifecycle rules.
- The server's curl version.
- The timer on the server.
- The drill on a Mac.

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
See "Hosting" in `HANDOFF.md`. It has one server and no failover, which suits the one-month testnet beta. Before M6 takes real money, set up the off-site backups (D47) and record a restore drill. Moving the database off the box is challenged in MAINNET_PLAN.md section 10.
