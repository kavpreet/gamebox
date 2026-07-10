# GameBox

Self-hosted family board & card games: the **TV** (a Raspberry Pi in kiosk mode)
shows the public board, everyone plays from their **phone/tablet** over the LAN
or the internet. One shared engine, every game is a plugin.

**Games (17):** Snakes & Ladders · Ludo · UNO · UNO Flip · Chess · Chinese
Checkers · Rummy · Checkers · Risk · Pandemic · Monopoly · Catan · Codenames ·
Azul · Scattergories · Scrabble · Pictionary

Full design rationale lives in [`dream/gamebox-plan.md`](dream/gamebox-plan.md).

---

## Quick start (development)

Requirements: Node.js ≥ 20. No database or Docker needed — dev uses SQLite.

```sh
npm install
npm run migrate -w apps/backend       # creates gamebox.dev.sqlite + auth tables
npm run seed -w apps/backend          # dummy users: alice/bob/carol/dave@dev.local
npm run dev:backend                   # API + websockets on :3001
npm run dev:frontend                  # in a second terminal — app on :5173
```

Open http://localhost:5173 and sign in as `alice@dev.local` / `gamebox-dev-1`
(bob → `gamebox-dev-2`, carol → `-3`, dave → `-4`). To simulate game night:

- one browser tab at `http://localhost:5173/tv?room=DEVTV` = the TV
- 2+ tabs (use private windows for different accounts) = the phones
- create a game, **Cast here** to the TV, others join with the PIN, start, play.

Tests: `npm test -w apps/backend` (126 tests over the engine + all 17 games).

---

## Configuration

Copy `.env.example` to `.env` and adjust. **Everything defaults to a working
dev setup** — you only need to touch it for production. Key settings:

| Variable | Meaning |
|---|---|
| `BASE_URL` | public origin users open (`https://gamebox.yourdomain.com`) |
| `BACKEND_URL` | backend origin — same as `BASE_URL` in production |
| `DATABASE_URL` | Postgres URL; empty = dev SQLite file |
| `AUTH_SECRET` | session signing secret (`openssl rand -base64 32`) |
| `AUTH_EMAIL_PASSWORD_ENABLED` | `true` during development, `false` once Google is live |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | enables "Continue with Google" |
| `ALLOWED_EMAILS` | comma-separated family allowlist — **the** authorization boundary |

## Google login — one-time setup

1. Go to https://console.cloud.google.com/ → create a project ("GameBox").
2. **APIs & Services → OAuth consent screen**: External, app name GameBox,
   add your family's Gmail addresses as test users (or publish the app).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: your public origin(s), e.g.
     `https://gamebox.yourdomain.com` and `https://lan.gamebox.yourdomain.com`
   - Authorized redirect URIs — one per deployment, exactly:
     - `https://gamebox.yourdomain.com/api/auth/callback/google`
     - `https://lan.gamebox.yourdomain.com/api/auth/callback/google`
     - (for local testing: `http://localhost:3001/api/auth/callback/google`)
4. Copy the client ID + secret into `.env`.
5. Set `ALLOWED_EMAILS` to your family's Gmail addresses.
6. **Flip `AUTH_EMAIL_PASSWORD_ENABLED=false`** and restart — email/password
   disappears from the login page and Google becomes the only way in.

> The LAN and VPS deployments are independent (separate databases and users),
> but one Google OAuth client can serve both — just register both redirect URIs.

---

## Deployment

Same image everywhere: `docker build -f infra/Dockerfile -t gamebox .`
The backend serves the built frontend itself — one container + Postgres.

### Profile A — VPS via Dokploy (remote play)

1. In Dokploy, create a Compose service from `infra/docker-compose.yml`
   (or point it at this repo).
2. Set env vars in Dokploy: `BASE_URL`, `AUTH_SECRET`, `DB_PASSWORD`,
   `ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID/SECRET`, `AUTH_EMAIL_PASSWORD_ENABLED=false`.
3. Domains tab: route `gamebox.yourdomain.com` → `app` service port 3001
   (Dokploy handles Traefik + Let's Encrypt; WebSockets work out of the box).

### Profile B — LAN via Podman on the Pi (primary use case)

HTTPS is **required** even on the LAN (Google login, secure cookies, PWA), so:

1. DNS: add an A record `lan.gamebox.yourdomain.com` → the Pi's LAN IP
   (a public record pointing at a private IP is fine and exposes nothing).
   Give the Pi a DHCP reservation in your router.
2. On the Pi (rootless Podman):

   ```sh
   git clone <this repo> && cd gamebox
   podman build -f infra/Dockerfile -t localhost/gamebox:latest .
   printf 'yourpassword' | podman secret create gamebox_db_password -
   mkdir -p ~/.config/containers/systemd ~/.config/gamebox
   cp infra/quadlets/* ~/.config/containers/systemd/
   cp infra/Caddyfile ~/.config/gamebox/Caddyfile     # edit domain + DNS token
   # create ~/.config/gamebox/gamebox.env from .env.example (BASE_URL=https://lan.gamebox.yourdomain.com etc.)
   # edit the DATABASE_URL password inside gamebox.container to match the secret
   systemctl --user daemon-reload
   systemctl --user start gamebox-postgres gamebox gamebox-caddy
   loginctl enable-linger $USER
   ```

3. Caddy gets its certificate via DNS-01 (see `infra/Caddyfile`) — no port
   forwarding, nothing reachable from the internet. Only cert renewal and
   Google login itself need the internet up; gameplay doesn't.

### The TV

See [`infra/pi-kiosk/README.md`](infra/pi-kiosk/README.md) — the Pi boots
Chromium straight to `/tv?room=LIVING_ROOM`, shows an idle screen, and any
phone can cast a game to it from the lobby. Multiple TVs = multiple room codes.

---

## How it fits together

```
apps/backend      Express + Socket.IO + better-auth + Kysely (SQLite dev / Postgres prod)
apps/frontend     React SPA — /tv (kiosk), /play via /game/:id (phones), lobby, login
packages/core-engine    GameModule contract, seeded RNG, per-viewer projection, votes
packages/shared-types   wire types shared by everything
packages/games/*        one package per game: pure rules module + tests
infra/            Dockerfile, compose (VPS), quadlets (LAN), Caddyfile, kiosk
```

Key mechanics (see the plan for the full reasoning):

- **One authoritative state, projected per viewer** — a game's `view(state, seat)`
  is called once per connected client; the TV gets the `SPECTATOR` projection
  (hand *counts*, never contents).
- **Server-side seeded RNG** — dice/shuffles are unpredictable to clients and
  fully replayable from the move log.
- **Postgres/SQLite is the source of truth** — full snapshot persisted after
  every move (optimistic-concurrency checked); reconnects get a full resync.
- **Disconnects are a vote** — after a 60s grace, remaining players choose
  Skip / Pause / Kick (options come from the game module; chess has no Skip).
- **Rules upgrades discontinue in-flight games** of that type only (bump a
  module's `rulesVersion` and the server handles it at boot).
