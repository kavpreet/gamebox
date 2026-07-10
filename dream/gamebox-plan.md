# GameBox — Feature & Tech Plan

A self-hosted platform for playing your family's board/card games together — some of you on the couch with a TV, some of you remote — over a browser, with a shared "core engine" and each game built as a plugin on top of it.

Status: planning draft, based on your answers to the clarifying questions below plus targeted research (2026) into the trickiest architectural questions. Every recommendation below is a starting point, not a locked-in decision — flag anything that doesn't feel right.

---

## 1. Confirmed decisions

| Question | Decision |
|---|---|
| Language/stack | **TypeScript everywhere** (Node.js backend, TS frontend, shared types) |
| Realtime transport & engine | **Socket.IO + a custom `GameModule` core** (confirmed — see [§5.1](#51-realtime-transport--game-engine)) |
| Build order | **Progressive, easiest → hardest** (see [§8](#8-recommended-build-order)) — the earlier UNO→Catan→Monopoly mandate was replaced on your go-ahead |
| AI/bot opponents | **Out of scope for v1** — humans only, but the plugin interface must not preclude adding bots later |
| Voice/video chat | **Out of scope for v1** — negotiation and general chat happen live/on a call outside the app |
| Deployment topology | **Two independent profiles**: VPS via Dockploy for multi-home/remote games; local LAN via Podman for local-only games. Same codebase, no data sync between them |
| Joining a game | Each game gets a **numeric PIN** to join (a QR code is a convenience shortcut that encodes the same PIN, not a separate mechanism) |
| Disconnect handling | **Player vote**, not a fixed policy — connected players choose Skip / Pause / Kick when someone drops |
| Session cookie lifetime | **Long-lived** — not worth optimizing for short sessions |
| Trade/negotiation modeling | **Kept simple** — propose an exact swap, other player accepts/rejects; no in-app counter-offer protocol (assumes live negotiation happens outside the app) |
| Backups | **Local only, no offsite copy** — incomplete/abandoned games purged after 30 days; completed games' results kept forever |
| Team/partner variants | **Allowed in v1** — the engine supports team-based win conditions from the start |
| TV device auth | **The join PIN is sufficient** — no separate device-level lock on the TV/kiosk |
| Switching devices mid-game | **Allowed at any time**, as long as the new device logs in as the same Google account — blocked only if that seat has been removed by a Kick vote (§5.3) |
| VPS sizing | **Assumed adequate** — not treated as an open concern |
| Disconnect-vote resolution | **Resolves the instant an option secures a strict majority of currently-connected voters** — no need to wait for stragglers |
| LAN HTTPS | **A subdomain of your existing domain, DNS'd to your home's LAN IP** (e.g. `lan.gamebox.<yourdomain>`) — reuses infrastructure you already run on Dokploy, no separate mDNS/`.local` scheme (see [§5.5](#55-deployment)) |
| Game host powers | **The creator** (`games.created_by`) configures teams, starts, and can abandon the game — no separate host-transfer mechanism in v1 |
| Rules upgrades mid-game | **In-flight games are marked `discontinued`** when a deploy changes the rules of a game type they're using; adding a brand-new game type never touches existing games (see [§5.3](#53-persistence)) |
| VPS/LAN independence | **Confirmed, including the operational cost** — you'll maintain the family allowlist in both places yourself; no sync job planned |

---

## 2. The two client roles

Every game session has exactly these two kinds of connected clients, and the entire system is designed around this split:

- **TV client** — a browser (Chromium kiosk mode on a Raspberry Pi, or any browser) showing *public* game state only: the board, discard pile, whose turn it is, reserve/draw pile size, per-player hand *counts* (not contents). Nobody is "logged in" as this client — it's a passive shared display.
- **Player client** — a phone/tablet browser, authenticated as a specific Google account, showing that player's *private* state (their hand, their dice-roll button, their move controls) plus the same public state.

One core mechanism — a **per-viewer state projection function** — produces both views from one authoritative game state. A game plugin author writes this once per game; the core engine calls it once per connected viewer (using the player's ID, or a `SPECTATOR`/TV sentinel). This is the same pattern used by `boardgame.io`'s `playerView` and Board Game Arena's per-client notifications — it's what makes "UNO: I see my hand, the TV sees only my hand count" and "Catan: everyone's dev cards are hidden, the board isn't" fall out of one mechanism instead of a bespoke one per game.

---

## 3. High-level architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌──────────────────────────┐
│ Raspberry Pi     │      │ Phone / Tablet    │      │ Phone / Tablet (sister,  │
│ + TV, Chromium   │      │ (same house)      │      │ remote, over internet)   │
│ kiosk browser    │      │ browser           │      │ browser                  │
└────────┬─────────┘      └─────────┬─────────┘      └────────────┬─────────────┘
         │  wss://                  │  wss://                     │  wss://
         └──────────────┬───────────┴──────────────┬──────────────┘
                         ▼                          ▼
                  ┌─────────────────────────────────────┐
                  │  Caddy (reverse proxy + auto HTTPS)  │
                  └───────────────┬─────────────────────┘
                                  ▼
                  ┌─────────────────────────────────────┐
                  │  Backend (Node.js + TS)              │
                  │  - Express/Fastify HTTP + Socket.IO   │
                  │  - Google OAuth verification           │
                  │  - Core engine: rooms, turn state,     │
                  │    projection, RNG, persistence         │
                  │  - Game plugins (UNO, Catan, Chess...) │
                  └───────────────┬─────────────────────┘
                                  ▼
                  ┌─────────────────────────────────────┐
                  │  PostgreSQL  (source of truth)        │
                  │  users, games, game_players, moves,   │
                  │  game_types, rooms                     │
                  └─────────────────────────────────────┘
```

**This whole box is deployed twice, independently** (see [§5.5](#55-deployment)):

- **VPS profile** — the backend/frontend/Postgres stack runs on a small VPS via Dockploy, reachable over the internet. Used whenever anyone (e.g. your sister) is joining from outside the house.
- **LAN profile** — the *same* stack runs locally via Podman on a device on your home network (the TV Pi itself, or a separate always-on box — not yet decided, see [§7](#7-open-questions-worth-deciding-before-while-building)). Used for local-only game nights, with lower latency and no dependency on the VPS being reachable.

These two profiles are **entirely independent** — separate Postgres, separate `users` tables, no data sync. A game started on the LAN instance doesn't show up on the VPS instance or vice versa. This is the simplest possible mental model and matches the "if we lose it, we lose it, it's just a game" attitude toward this project. Google OAuth login still needs your home internet to reach Google's servers even in LAN mode — LAN mode means "skip the VPS," not "work fully offline."

The Raspberry Pi driving the TV is just a browser pointed at a URL — no custom software beyond kiosk config — regardless of which profile it's pointed at. Hosting multiple TVs (e.g. a chess tournament across several screens) is multiple browsers pointed at `/tv/<gameId>` for different game IDs, all served by the same backend process.

---

## 4. Core concepts (the "shared engine")

### 4.1 Plugin contract

Each game (UNO, Catan, Chess, ...) is a package that implements one interface. The core engine never contains game-specific rules — only the generic machinery: connections, rooms, turn bookkeeping, persistence, and view redaction.

```ts
type Seat = number;   // stable seat index within one game. The DB maps user ⇄ seat,
                       // and the module only ever sees seats — so a future bot is just
                       // a seat with no user attached, with zero interface changes.

type GameState<TPublic, TPrivate> = {
  public: TPublic;
  private: Record<Seat, TPrivate>;
};

interface GameModule<TPublic, TPrivate, TMove> {
  slug: string;                          // 'uno', 'catan', 'chess', ...
  minPlayers: number;
  maxPlayers: number;
  teams?: 'none' | 'optional' | 'required';

  setup(seats: { seat: Seat; team?: number }[], rng: SeededRandom):
    GameState<TPublic, TPrivate>;

  // Who may act RIGHT NOW — derived from state on every call, never a static flag.
  // Length 1 = classic single active player (Chess, UNO, Ludo). Length >1 = Catan
  // trade responses, Monopoly auctions, simultaneous discards. Games with multi-phase
  // turns (Risk's reinforce → attack → fortify) keep their phase marker inside TPublic;
  // the engine has no phase concept of its own — it just re-asks after every move.
  activePlayers(state: GameState<TPublic, TPrivate>): Seat[];

  // Validate-and-apply; throw IllegalMove to reject. May mutate any zone — public or
  // any seat's private — since UNO Flip's flip card legitimately rewrites every hand at once.
  moves: Record<string, (ctx: {
    state: GameState<TPublic, TPrivate>;
    seat: Seat;
    payload: TMove;
    rng: SeededRandom;
  }) => void>;

  // Powers the phone UI's legal-move highlighting (§6.4). Technically optional, but
  // every game should ship it — without it the phone can only submit-and-hope.
  legalMoves?(state: GameState<TPublic, TPrivate>, seat: Seat): TMove[];

  // Takes FULL state, not just public — UNO's and Rummy's win conditions
  // ("my hand is empty") live in private state.
  endIf(state: GameState<TPublic, TPrivate>):
    { winners?: Seat[]; winningTeam?: number; cooperativeLoss?: boolean } | null;

  // The one function that makes TV-vs-player and hidden-hand work automatically
  view(state: GameState<TPublic, TPrivate>, viewer: Seat | 'SPECTATOR'): unknown;

  // Which disconnect-vote options make sense for this game (§5.3). Chess: Skip is
  // nonsense (a chess turn can't be passed), so only Pause / Kick-as-resign.
  // Pandemic: Kick should redistribute the leaver's cards, not destroy them.
  disconnectOptions?(state: GameState<TPublic, TPrivate>): ('skip' | 'pause' | 'kick')[];

  // Called when a Kick vote resolves — each game defines what elimination means
  // (Monopoly: bankruptcy, assets return to bank; Risk: territories neutralized;
  // UNO: hand shuffled back into the draw pile, seat skipped thereafter).
  onPlayerRemoved?(state: GameState<TPublic, TPrivate>, seat: Seat): void;
}
```

Four details of this contract exist specifically because a more naive version would have failed on this exact game list (caught in review — worth preserving the reasoning):
1. **`activePlayers` is derived from state, not a static "turn mode" field** — Catan switches between single-active and multi-active *within one turn* (normal play → trade response → robber discard on a 7), so no per-game constant can describe it.
2. **`endIf` receives full state including private zones** — UNO and Rummy end when a *private* hand empties; a public-only signature can't see the win.
3. **`legalMoves` exists** because the player client promises legal-move highlighting (§6.4) — the UI can't highlight what the contract can't enumerate.
4. **`setup` receives team composition** — teams are a confirmed v1 decision, and modules like team-Risk deal differently by team; passing bare player IDs would strand that information in the DB.

**Teams**: a seat's optional `team` (also stored as `game_players.team_index`, §5.3) doesn't change turn order or seating — it feeds `setup`, `endIf`'s winner check, and any team-aware game logic. This keeps 2v2 Chinese Checkers or team Risk a thin layer on top of the same engine rather than a special case.

**Trades, simplified**: because in-app negotiation was deliberately scoped down to "propose an exact swap, other player accepts or rejects" (the actual back-and-forth happens live/on a call), a trade doesn't need any new engine machinery — it's just a move after which `activePlayers` temporarily includes the target player until they accept or reject. This removes what would otherwise be the single most complex piece of Catan/Monopoly.

This vocabulary is deliberately borrowed from two proven prior-art systems rather than invented from scratch:
- **`boardgame.io`** — `G`/`ctx`, `moves`, `phases`, `playerView`, seeded `Random` plugin (state never sent to clients, so dice/shuffles stay fair *and* replayable).
- **Board Game Arena** — the `ACTIVE_PLAYER` / `MULTIPLE_ACTIVE_PLAYER` split, which is exactly what's needed for Catan trade responses and Monopoly auctions (several players promoted to "may act" at once, not just one).

We're borrowing the *ideas*, not the dependency — see [§5.1](#51-realtime-transport--game-engine) for why.

### 4.2 Board topology — one shared primitive

Despite looking very different, every requested game's board reduces to **a graph of position-nodes + adjacency edges**, with a thin per-game "geometry helper" for convenient coordinate math on top:

| Game | Underlying topology |
|---|---|
| Chess, Checkers | 8×8 (or 10×10) orthogonal grid, generated as a graph |
| Catan | Hex tiles (axial/cube coords) **plus** vertices and edges as first-class graph nodes — settlements sit on vertices, roads on edges |
| Risk, Pandemic | Hand-authored adjacency-list graph (territories/cities + connections) |
| Ludo, Snakes & Ladders, Monopoly | Linear/cyclic track, generated as a graph (Ludo needs 4 colored entry offsets converging on a shared home stretch) |
| Chinese Checkers | Star-shaped lattice, ~121 holes, graph of holes + adjacency |
| UNO, UNO Flip, Rummy | No board — draw pile / discard pile / hand primitives only |

Only the **legal-move generator** differs per game; storage and adjacency-query code is shared.

### 4.3 RNG / fairness

The engine owns one seeded PRNG per game instance. The seed and RNG state live only in server-side persisted state and are **never** sent to any client. Moves needing randomness (dice, shuffles) call an injected `rng` — this keeps outcomes both unpredictable to clients (fair) and fully deterministic/replayable from the stored seed + move log (needed for resume and spectator replay).

### 4.4 Per-game complexity — what's hard and why

Ranked hardest → easiest to fit the shared model (this should inform build order and where to budget extra time):

1. **Catan** — resource distribution on every roll, the robber, and the bank trade are still real state to model; the player-to-player trade itself is now simple (propose-exact-swap/accept-reject, per §1) since real negotiation happens live off-app, which removes what would otherwise be the hardest part.
2. **Monopoly** — not one hard mechanic, but many interacting simple ones sharing a currency ledger: banking, auctions, mortgages, jail sub-state, bankruptcy. Two-party trades are simplified the same way as Catan's.
3. **Pandemic** — cooperative shared-loss with *several independent* loss triggers (8th outbreak / a color's cubes exhausted / player deck exhausted) plus asymmetric per-role special actions.
4. **Risk** — a single "turn" contains an unbounded dice-resolved combat sub-loop, plus continent-bonus computation over a ~42-territory graph.
5. **Checkers** — forced-capture rule means legal-move computation must scan the *whole board* before any move validates, and one "move" can be a chained multi-jump.
6. **Rummy** — combinatorial meld/lay-off validation (sets, runs, ace-high/low) is fiddly; turn structure itself is simple.
7. **Chinese Checkers** — hop-chain move generation is combinatorial like checkers, without the forced-capture wrinkle.
8. **Chess** — turn structure is trivial; recommend delegating move-legality entirely to **`chess.js`** (actively maintained, handles check/checkmate/castling/en passant/promotion/draws + FEN/PGN) rather than reinventing it.
9. **UNO / UNO Flip** — simple sequential-with-direction-flag turn order. UNO Flip adds one wrinkle worth designing for early: a Flip card bulk-mutates *every* zone (draw pile, discard pile, all hands) at once, so the core move/patch model must allow multi-zone mutation, not just "mutate the current player's state."
10. **Ludo** — dice-driven race with capture/safe-squares; fully public, no hidden hands.
11. **Snakes & Ladders** — purely luck-driven, zero player decisions, simplest of all twelve.

---

## 5. Tech stack

### 5.1 Realtime transport & game engine

**Recommendation: Socket.IO (rooms keyed by `gameId`) as the transport, with a small custom `GameModule` engine on top (per §4.1) — not a full third-party game-server framework.**

This was the one point where the research came back split, so here's the reasoning for resolving it:

- **Colyseus** (a purpose-built Node.js game-server framework) has a genuinely excellent feature for this project's hardest problem: its `StateView` API lets one room broadcast a single state tree while each client sees only fields explicitly added to its own view — and Colyseus's own demo is literally a turn-based card game built to show this off. It also has clean room/matchmaking + reconnection-token primitives.
- However, Colyseus's headline strength — binary delta-compressed schema sync — is built for high-frequency real-time games (dozens of updates/sec). Turn-based games update state maybe once every few seconds; that advantage goes unused, so you'd mainly be adopting Colyseus for its room/view ergonomics, at the cost of learning its schema-decorator system and reconciling its own room lifecycle with this project's TV-vs-player broadcast model.
- The equivalent of `StateView` — "call one projection function per connected viewer, send plain JSON" — is easy to hand-roll directly on Socket.IO (which already gives you rooms, reconnection with backoff, and heartbeat/timeout detection for free). Socket.IO is also more mainstream, has a much larger community, and needs no new framework to track for updates.
- Colyseus does **not** persist state across a server restart by itself either — you'd be building the same Postgres-as-source-of-truth layer regardless of which library sits underneath.

**Net: Socket.IO + a small hand-written `GameModule` core captures ~90% of what Colyseus would give you, with one fewer framework dependency and a simpler mental model** — consistent with this project's own bias toward mainstream, low-overhead tooling. If gameplay ever needs high-frequency real-time sync (not on the current game list), Colyseus is worth revisiting then.

Other transports considered and rejected: **raw `ws`** (loses reconnection/heartbeat for no payoff at this scale), **SSE** (one-way only — would still need a second channel for player moves), **WebRTC data channels** (needs its own signaling + STUN/TURN infrastructure and solves a latency problem this server-authoritative, turn-based system doesn't have), **long-polling** (fine only as Socket.IO's automatic fallback, never as the primary path), **PartyKit** (now effectively a Cloudflare Workers product — doesn't run on a plain VPS), **Nakama** (production-grade but wants its own CockroachDB + full social/matchmaking stack — disproportionate for a family hobby project).

Rooms map 1:1 onto **one `gameId` = one Socket.IO room**, which is exactly how many independent concurrent games (e.g. a chess tournament across several TVs) stay isolated with zero extra infrastructure.

### 5.2 Authentication

**Recommendation: a minimal custom Google OAuth flow (Authorization Code + PKCE, via `google-auth-library` or `Arctic`) + your own DB-backed session cookie + a Jackbox-style TV pairing PIN/QR — not a full auth framework.**

Why not an off-the-shelf framework: the multi-provider/2FA/account-linking machinery that Auth.js, Better Auth, or Passport exist to provide has little value when there's exactly one provider (Google) and a fixed, small, known set of family members. You also can't avoid writing custom glue either way — Socket.IO's WebSocket upgrade doesn't run through normal HTTP session middleware, so the handshake-auth code is hand-written regardless of which library issues the session.

It's also worth knowing the ground shifted recently in this space: **Lucia was deprecated** (March 2025, now "read the code, don't install it"), **Auth.js/NextAuth** went into maintenance-only mode and was folded into **Better Auth** (Sept 2025) — which Vercel then acquired (announced days before this research, July 2026). None of that churn is a reason to avoid Google login; it's a reason to prefer the thin, dependency-light path here.

Concrete flow:
1. Backend implements Google's Authorization Code + PKCE flow (per current IETF guidance, RFC 9700) and verifies the ID token server-side with `google-auth-library`.
2. On success, check the verified email against a **hardcoded family allowlist**, then issue an opaque, DB-backed session cookie (`httpOnly`, `secure`, `sameSite=lax`). Lifetime is generous (e.g. a year, rolling on activity) — session length was explicitly not something to optimize for, and revocation is still a single DB delete if a device is ever lost.
3. **TV pairing (Jackbox-style, not literal OAuth device flow):** the TV is never itself an authenticated actor — it's a passive display. It shows the game's **numeric PIN**, plus a QR code as a convenience shortcut that encodes the same PIN as a `/join/<pin>` deep-link (not a separate mechanism). A phone scans or types it, completes Google login if needed, gets checked against the allowlist, and is attached to that `gameId`'s room as `{gameId, userId, role: 'player'}`. (A literal RFC 8628 "device authorization grant" — the protocol behind "sign in on your phone" on streaming devices — solves a different problem: it's for when the *device itself* needs an access token. Your TV never needs one, so only the join-PIN UX is worth borrowing, not the protocol.)

### 5.3 Persistence

**Recommendation: PostgreSQL as the sole source of truth, no Redis/Valkey for v1.**

Schema sketch (every table keyed by `game_id`, so concurrent independent games — e.g. several chess tables in a tournament — never contend with each other):

```sql
users(id uuid pk, google_sub text unique, email text, display_name text,
      avatar_url text, created_at timestamptz)

game_types(slug text pk, display_name text, rules_version text,
           min_players int, max_players int)

games(
  id uuid pk,
  game_type text references game_types(slug),
  rules_version text not null,         -- COPY of game_types.rules_version at creation — an audit
                                       -- record of what rules this game was played under, not a
                                       -- runtime dispatch key (§5.3 below: old versions are never
                                       -- resumed, so the engine never needs to run two at once)
  status text check (status in ('lobby','active','paused','completed','abandoned','discontinued')),
  join_pin text unique,                -- numeric PIN for TV pairing / joining;
                                       -- NULLED when the game ends, so PINs recycle instead of
                                       -- colliding with completed rows kept forever
  version bigint not null default 0,  -- optimistic-concurrency counter == last move seq
  current_state jsonb not null,       -- denormalized PUBLIC snapshot (board, discard pile,
                                       -- turn order, reserve pile size)
  active_seats int[] not null default '{}',  -- cache of module.activePlayers() after the last
                                              -- move; an array because Catan trade responses /
                                              -- Monopoly auctions have several actors at once
  final_result jsonb,                  -- winners/scores, kept forever regardless of purge policy
  created_by uuid references users(id),
  created_at timestamptz, updated_at timestamptz, ended_at timestamptz
)

game_players(                          -- seat + private per-player view
  id bigserial pk,
  game_id uuid references games(id),
  user_id uuid references users(id),
  seat_index int,
  team_index int,                      -- nullable; groups seats into teams for team/partner variants
  role text check (role in ('player','spectator')),  -- 'spectator' reserved for v1.1 (§6.8)
  private_state jsonb,                 -- e.g. hand of cards — NEVER put this in games.current_state
  connected boolean default false,
  disconnect_vote jsonb,               -- in-flight Skip/Pause/Kick vote state, if any (see §6.6)
  eliminated_at timestamptz,           -- set when a Kick vote resolves; blocks rejoining this seat
  last_seen_at timestamptz,
  unique(game_id, user_id), unique(game_id, seat_index)
)

moves(                                 -- append-only log = replay/spectate/audit source of truth
  id bigserial pk,
  game_id uuid references games(id),
  seq integer not null,
  player_id uuid references users(id), -- NULL for system events (vote resolution, auto-skip,
                                       -- grace-period expiry) — these mutate state too and must
                                       -- be in the log or deterministic replay breaks
  type text not null,                  -- e.g. PLAY_CARD, ROLL_DICE, END_TURN, VOTE_RESOLVED
  payload jsonb not null,
  created_at timestamptz default now(),
  unique(game_id, seq)
)

rooms(id uuid pk, name text, pairing_code text unique,   -- a physical TV/Pi
      active_game_id uuid references games(id), last_seen_at timestamptz)
```

**Rules upgrades: discontinue, don't multi-version.** You've confirmed you're fine losing in-flight games rather than keeping old rules code around — which is a real simplification, not just a lesser evil: it means the backend never needs to run two versions of a game module at once. On deploy, the backend compares each module's built-in version string to its stored `game_types.rules_version`; if a module changed, every one of its games not already `completed`/`abandoned` is marked `discontinued` (players see "this game's rules were updated, sorry — start a new one" next time they open it), and `game_types.rules_version` is bumped for future games. **Adding a brand-new game module never triggers this** — it's a new `game_types` row with nothing to compare against, so every other game type is untouched. The practical rule of thumb: editing `packages/games/catan/` can discontinue open Catan games; adding `packages/games/pandemic/` never touches anything else.

Why this shape and not "pure" event sourcing or a snapshot-only design:
- **Full event sourcing with periodic snapshots** is built for aggregates with thousands+ events (bank ledgers). A board game rarely exceeds a few hundred moves, so replaying from move 0 is always sub-100ms — a separate snapshot table would be complexity with no payoff.
- **Snapshot-only, no move log** is simpler but throws away replay, spectate, undo, and audit ("how did we get to this state?") for negligible savings (one extra row per human turn).
- The chosen hybrid gives **O(1) resume** (`games.current_state` is enough to rehydrate after a restart) *and* full replay/audit via `moves`, matching how a couple of independent production references (a chess system-design write-up, an OSS Postgres-event-sourcing reference) both converge on this shape.

**No Redis/Valkey for v1**: at "a handful of concurrent games," a single Node process holding an in-memory `Map<gameId, GameRuntime>` is enough — one process already holds every live game's state, so broadcasting needs no pub/sub layer at all. Both `boardgame.io` and Colyseus default to in-memory drivers at this scale too. Add Valkey (the BSD-licensed community fork of Redis — not Redis itself, whose license changed in 2024) only if you ever run multiple backend processes.

**Concurrency control:** a per-game `version`/`seq` counter, checked with a conditional `UPDATE ... WHERE id=$1 AND version=$2` alongside the `moves` table's `unique(game_id, seq)` constraint. Zero rows updated ⇒ the client's view was stale and must refetch. Cheap, and protects correctness even though a single Node process already serializes same-game mutations naturally.

**Reconnect model:** because turns are human-paced (not 20–60Hz), the simplest correct approach is "send the full current snapshot on (re)connect, then subscribe to live pushes." No delta/ring-buffer catch-up logic is needed — game state is small (KBs).

**Retention & backups:** backups are a local `pg_dump` on the same host running the deployment (VPS or LAN device) — no offsite copy. A scheduled job handles any game in `lobby`/`active`/`paused` with no activity for 30 days by marking it `abandoned`; `discontinued` games (above) get the same cleanup immediately rather than waiting out the 30 days, since there's no reason to keep a dead game's heavy state around. Both cases: delete `moves` rows, clear each seat's `private_state`, reset `current_state` to a small tombstone (the column is `NOT NULL`), and null `join_pin` so the PIN recycles. `completed` games keep their `final_result` (winners, scores, players, date) **forever** — cheap to retain, and the one thing worth not losing. Because there's no offsite copy, a full host failure loses everything including that permanent history — the retention policy is a guard against data creep, not a durability guarantee, which matches treating this as a fun project rather than a critical system.

**Disconnect handling (core-engine mechanism, per-game applicability):** after a configurable grace period (default ~60s) a disconnected player's seat is flagged. Any connected player can call a vote; the *options on the ballot* come from the game module's `disconnectOptions` hook (§4.1), because not every option makes sense in every game:
- **Skip** — auto-pass that player's turn(s) until they reconnect. (Chess excludes this — a chess turn cannot legally be passed.)
- **Pause** — halt the game entirely until they reconnect or a new vote is called. Always available.
- **Kick** — remove them permanently; the engine calls `onPlayerRemoved` so each game defines what elimination means (Monopoly: bankruptcy; Chess: resignation; Pandemic: redistribute their cards rather than destroy them).

**Resolution is early-decision, not wait-for-all**: the vote resolves the instant one option secures a strict majority of currently-connected voters — outstanding votes from stragglers don't need to come in if the outcome can no longer change. Only a genuine tie (all connected have voted, evenly split) falls back to **Pause** as the safest default. Any connected player can call a new vote at any time, e.g. to escalate from Pause to Kick after waiting a while. One consequence to be aware of, stated rather than accidental: **in a 2-player game, the "majority" is just the one remaining connected player** — they unilaterally decide, which is reasonable (in Chess, Kick is effectively claiming a win by abandonment) but is a policy, not an oversight.

**Switching devices mid-game is always allowed** — a player can log in as the same Google account on a new device at any point (phone dies, grab a tablet) and their socket reconnects to the same `game_players` row by `user_id`; no special handling needed beyond the normal session/reconnect flow. The only thing that blocks this is `eliminated_at` being set — once a Kick vote removes a seat, that seat can't rejoin the game (their Google account still works fine everywhere else, including other games).

### 5.4 Frontend

**Recommendation: one Vite + React + TypeScript app**, with two route namespaces (`/tv/:gameId` and `/play/:gameId`) sharing a component library, rather than two separate apps. Each game plugin exports a `TvView` and a `PlayerView` component alongside its rules module (see [§5.6](#56-monorepo-layout)) — this keeps a game's UI and logic co-located as one plugin package.

Build it as an installable **PWA** (web manifest + service worker) from day one — this costs little up front and is the natural stepping stone toward "native app later" without committing to one now. It's also the mechanism for a genuinely useful later feature: **Web Push "it's your turn" notifications**, which matter a lot for async remote play with your sister (not decided/scoped for v1, flagged as a strong v1.1 candidate).

### 5.5 Deployment

Your framing — Podman for the local Pi/LAN game, Dokploy for the VPS — is a real, coherent split, not "either/or for the same job": **two independent deployment profiles running the same container images**, chosen based on who's playing.

#### Profile A — VPS, via Dokploy (multi-home / remote play)

Used whenever anyone (e.g. your sister) is joining from outside the house. Dokploy is a Docker-based self-hosted PaaS: it's the lightest of the mainstream self-hosted PaaS options (~300–400MB idle RAM), has native `docker-compose.yml` support (paste your manifest, it manages the whole stack), and gives automatic Traefik + Let's Encrypt HTTPS through its UI's Domains tab with zero manual proxy config. Trade-off: it's Docker-only (no Podman), and it's one more always-on service (its own Next.js+Postgres+Traefik stack) to keep patched — acceptable here since this is the profile that's reachable from the internet and benefits most from a UI for deploys/env-vars/SSL/rollbacks.

```yaml
# VPS profile — paste into Dokploy as a Compose service, or run directly with `docker compose`
services:
  frontend:
    image: ghcr.io/you/gamebox-frontend:latest
    restart: unless-stopped

  backend:
    image: ghcr.io/you/gamebox-backend:latest
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://gamebox:${DB_PASSWORD}@postgres:5432/gamebox
    depends_on:
      postgres: { condition: service_healthy }

  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: gamebox
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: gamebox
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gamebox"]
      interval: 10s
      timeout: 5s
      retries: 5

  pg_backup:                       # nightly local pg_dump — no offsite copy, per §5.3
    image: offen/docker-volume-backup:latest
    restart: unless-stopped
    environment:
      BACKUP_CRON_EXPRESSION: "0 3 * * *"
    volumes: ["pgdata:/backup/pgdata:ro"]

volumes: { pgdata: {} }
```

(Dokploy injects Traefik routing/TLS labels for `frontend`/`backend` through its UI — no Caddyfile needed here. If you ever run this profile without Dokploy, plain Docker Compose + Caddy is the fallback: Caddy gets automatic HTTPS *and* automatic WebSocket-upgrade handling in ~10 lines, with no manual `Upgrade`/`Connection` header wrangling.)

#### Profile B — LAN, via Podman (local-only play)

The *same* backend/frontend/Postgres images run locally via Podman (Quadlets, or `podman compose` against Podman's Docker-API-compatible socket) on whichever device you end up designating — the TV Pi itself, or a separate always-on box (NAS/mini-PC/another Pi). Since that's not decided yet, the only thing that should differ between "backend on the TV Pi" and "backend on a separate box" is a `BACKEND_URL`/`DATABASE_URL`-style environment variable — same images either way, so the decision can be made later purely based on hardware, not a redesign.

```ini
# postgres.container — Podman Quadlet, ~/.config/containers/systemd/ (rootless)
[Unit]
Description=GameBox Postgres (LAN)

[Container]
Image=docker.io/library/postgres:18-alpine
Volume=gamebox-pgdata.volume:/var/lib/postgresql/data
Environment=POSTGRES_USER=gamebox
Environment=POSTGRES_DB=gamebox
Secret=gamebox_db_password,type=env,target=POSTGRES_PASSWORD
Network=gamebox.network
HealthCmd=pg_isready -U gamebox
AutoUpdate=registry

[Service]
Restart=always
TimeoutStartSec=300

[Install]
WantedBy=default.target
```

`backend.container` and `frontend.container` follow the same shape, referencing the same images as the VPS profile. No Redis/Valkey is needed for this profile either.

**The LAN profile still needs real HTTPS — a `.local`/mDNS name or a raw LAN IP won't work, and this is not optional** (caught in review). Three things this plan depends on all break on a plain-HTTP or non-HTTPS-capable origin:
1. **Google OAuth refuses redirect URIs on anything except `https://` or `http://localhost`** — a `.local` name or a bare IP can't get a browser-trusted certificate, so login can never complete there.
2. The **`secure` session cookie** (§5.2) is never sent over HTTP.
3. **PWA install + service workers** (§5.4) require a secure context.

Good news: **you already have exactly what this needs** — a domain with easy DNS mapping on Dokploy for your other apps. Add one more subdomain (e.g. `lan.gamebox.<yourdomain>`) whose DNS record points at your home's LAN IP (a public DNS record is free to point at a private IP — nothing about this exposes your home to the internet, since only devices already on your LAN can actually route to that address). Reserve a fixed IP for whichever device runs the LAN backend (a DHCP reservation in your router, one-time setup) so the record doesn't go stale. Run Caddy in this profile too, and get its certificate via a **DNS-01 challenge** (Caddy plus your DNS provider's plugin automates renewal) — DNS-01 needs no inbound port-forwarding, so the LAN box is never exposed to the internet; only certificate issuance/renewal (and Google login itself, per §3) needs the internet up, gameplay itself doesn't.

Practical consequence: one Quadlet more (`caddy.container`) than the earlier draft assumed, and the Google OAuth client needs **two** authorized redirect URIs — the VPS hostname and this new LAN hostname. The **join QR code** (§5.2) then encodes the fully-qualified `https://lan.gamebox.<yourdomain>/join/<pin>` link — exactly the "URL and PIN already encoded" behavior you wanted, just served from a real HTTPS hostname instead of a `.local` name so it actually works with Google login.

#### Notes that apply to both profiles

Run `pg_dump` on a schedule (never snapshot a live Postgres volume directly), prefer `restart: unless-stopped` over `always`/`on-failure`, gate backend startup on `depends_on`/`After=` health conditions, and prefer manual/deliberate deploys (`git pull` → rebuild → redeploy) over auto-updating images — a schema migration needs to land in lockstep with its backend version, which an auto-updater can't guarantee.

### 5.6 Monorepo layout

```
gamebox/
  apps/
    backend/            # Node.js + Express/Fastify + Socket.IO, core engine
    frontend/           # Vite + React; /tv/:gameId and /play/:gameId routes
  packages/
    core-engine/        # GameModule contract, turn-order state machine,
                         # board graph primitive, seeded RNG, view redaction
    shared-types/       # User, Game, Move, etc. — shared by backend + frontend
    games/
      uno/               # rules module + TvView/PlayerView components
      uno-flip/
      rummy/
      monopoly/
      catan/
      pandemic/
      risk/
      ludo/
      chess/             # thin wrapper around chess.js
      checkers/
      chinese-checkers/
      snakes-and-ladders/
  infra/
    docker-compose.yml
    Caddyfile
    pi-kiosk/            # kiosk setup scripts, systemd unit templates
  dream/                 # planning docs — this file
```

Use **pnpm workspaces** + TypeScript project references so `packages/games/*` can be imported by both the backend (for rules) and the frontend (for UI), sharing types with no build-time duplication.

### 5.7 TV / Raspberry Pi kiosk

**Recommendation: Raspberry Pi OS (64-bit, Desktop image) + labwc autostart + a systemd `--user` kiosk service.**

- **The kiosk boots to a stable *room* URL, never a game URL** — `/tv?room=<pairing_code>`, where the pairing code identifies the physical TV (the `rooms` table, §5.3) and never changes for the life of the device. The TV page follows `rooms.active_game_id`: when no game is assigned it shows an idle/"cast a game here" screen, and when a phone assigns a game to that room from the lobby, the backend updates the row and pushes the navigation over the room's own socket. This is what makes §6.2's "reassign a TV to a different game without touching the device" true — an earlier draft hardcoded a `GAME_ID` into the systemd unit, which would have required SSHing into the Pi every game night.
- Use the **Desktop** image, not Lite — Bookworm's default compositor is Wayland/labwc, and starting from Lite means manually reassembling `raspberrypi-ui-mods`/`xserver-xorg-legacy` anyway.
- Autostart lives at `~/.config/labwc/autostart` (the old `~/.config/lxsession/...` X11 location silently does nothing now).
- Supervise Chromium via a `systemd --user` service (`Restart=always`, `RestartSec=5`) rather than launching it directly from autostart — gives crash auto-recovery and `journalctl` logging.
- Turn off screen blanking via `raspi-config` → Display Options (simpler and more reliable than the Wayland-level `swayidle`/`wlopm` route, which has known compositor bugs).
- Enable "wait for network at boot," and add an `ExecStartPre` script that polls your backend's `/healthz` before launching Chromium — otherwise a Pi that boots faster than the VPS/router (e.g. after a shared power outage) shows a raw connection-refused page.
- **The most important resilience layer is in the frontend app, not the kiosk config**: none of the above detects a WebSocket that silently drops while the page still looks fine (e.g. the backend container restarts mid-game). Build reconnect-with-backoff into the frontend's socket client, and fall back to a full `location.reload()` if reconnection keeps failing for ~30–60s — there's no human at the TV to hit refresh.
- If this Pi is also chosen as the LAN-profile backend host (§5.5), Podman runs the backend/Postgres containers alongside — but that's an independent systemd/Podman concern from the native Chromium kiosk service above; the browser never runs inside a container. If a separate box hosts the LAN backend instead, this Pi only ever runs the native kiosk service and never touches Podman at all.

Example kiosk systemd unit:

```ini
[Unit]
Description=Chromium Kiosk
After=graphical-session.target network-online.target
Wants=network-online.target

[Service]
ExecStartPre=/home/pi/wait-for-backend.sh
ExecStart=/usr/bin/chromium --kiosk --noerrdialogs --disable-infobars \
  --no-first-run --start-maximized --ozone-platform=wayland \
  https://gamebox.example.com/tv?room=LIVING_ROOM
Restart=always
RestartSec=5

# Point at https://lan.gamebox.example.com/tv?room=... instead when this TV
# should follow the LAN profile (§5.5) rather than the VPS.

[Install]
WantedBy=default.target
```

---

## 6. Feature list

### 6.1 Accounts & access
- Google (Gmail) sign-in only; verified email checked against a family allowlist.
- DB-backed session, long-lived cookie on phones (so nobody re-logs-in every game night).
- No public sign-up — the allowlist *is* the authorization boundary.
- **Switch devices freely** — logging in as the same Google account on a new device picks up the same seat in any in-progress game, unless that seat was removed by a Kick vote (§5.3).

### 6.2 Lobby & session management
- Create a new game: pick a game type + player count, get a `gameId` + numeric join **PIN**.
- TV displays the join PIN and a QR code encoding the full `https://.../join/<pin>` link; phones join via scan or manual PIN entry.
- The **creator is the host** (`games.created_by`) — the only one who can configure teams, start the game, or abandon it. No host-transfer mechanism in v1; if the host disappears, the disconnect vote (§5.3/§6.6) is still how remaining players get unstuck.
- Assign players to **teams** at creation time, for games that support team/partner variants.
- **Resume by game ID** — reopen a game from a "my games" list at any time, from any device.
- **Multiple concurrent independent games** — several tables of the same or different game types running at once (e.g. a chess tournament across several TVs), fully isolated from each other.
- Reassign a physical TV/Pi to a different `gameId` without reconfiguring the device.

### 6.3 In-game (TV client)
- Public board/state rendering per game (cards' discard pile + draw pile size for UNO; hex board + robber + settlements for Catan; etc.).
- Whose turn it is, turn order/direction, per-player hand/resource *counts* (never contents).
- Reconnect-with-backoff + full-reload fallback (no human present to refresh).

### 6.4 In-game (player client)
- Private hand/cards/resources, dice-roll control, legal-move highlighting, move submission.
- Own current session persists across reconnects/app switches (mobile OSes routinely suspend background sockets — this is expected, not a bug to "fix").

### 6.5 Network / remote play
- Remote games (e.g. with your sister) run on the **VPS profile** — everyone connects to the same hosted URL, no distinction in the client between "local" and "remote" players.
- Local-only game nights run on the **LAN profile** instead — lower latency, no VPS dependency, same client and game code either way.
- Multiple TVs in different physical locations can display the *same* game simultaneously if ever wanted (e.g. two houses both watching the same Catan game, on the VPS profile).

### 6.6 Reliability
- **Disconnect handling is a vote, not a fixed policy**: after a grace period, connected players choose from whichever of Skip / Pause / Kick the game module allows (§5.3) — dynamic per situation rather than hardcoded per game.
- Full-state resync (not delta patches) on every reconnect — appropriate since board-game state is small and turns are human-paced.
- **A deploy that changes a game's rules discontinues its own in-flight games** (§5.3) rather than risk corrupting them under new logic — other game types are never affected.
- Nightly local `pg_dump` (no offsite copy); incomplete/abandoned/discontinued games purged after 30 days (or immediately for discontinued ones), completed games' results kept forever (§5.3).

### 6.7 Out of scope for v1 (explicitly, per your answers)
- AI/bot opponents (engine should not preclude adding them later — a bot is just another move-submitter using the same validation path).
- In-app voice/video/text chat (use your existing call app).

### 6.8 Good candidates for v1.1+ (not committed, worth tracking)
- PWA install + Web Push "it's your turn" notifications — high value for async remote play, low cost given the PWA groundwork in §5.4.
- Spectator-only role (e.g. a relative watching with no seat) — falls out naturally from the same viewer-projection mechanism as the TV client.
- Lightweight admin view: list all in-progress games, force-abandon a stalled one.
- Native app wrapper (Capacitor/Tauri) around the same PWA, if ever wanted.

---

## 7. Open questions worth deciding before/while building

Everything the second critical-review pass surfaced (LAN HTTPS/domain, host powers, rules-upgrade policy, the two-profile allowlist duplication) is now resolved and folded into the plan above. One item remains genuinely open:

1. **LAN backend host** — the TV Pi itself, or a separate always-on box (NAS/mini-PC/another Pi)? Deliberately left open (§5.5's compose/quadlet files are built to support either via an env var) — decide once you know what hardware you're actually using. Nothing else in the plan depends on resolving this soon.

---

## 8. Recommended build order

Now strictly **progressive, easiest → hardest**, per your go-ahead to drop the earlier UNO→Catan→Monopoly mandate — this is the reverse of the complexity ranking in [§4.4](#44-per-game-complexity--whats-hard-and-why), so each step adds roughly one new architectural concept on top of the last rather than a pile of them at once. The trade-off worth naming honestly: Catan and Monopoly — the two games most likely the actual favorites — land last, in position 10 and 11. If that ever feels like too long a wait once a few games are working, pulling one of them forward is a schedule change, not a redesign; nothing in the engine assumes this exact order.

1. **Snakes & Ladders** — zero decisions, one die, no hidden info, no board topology beyond a linear track with a teleport table. This is both the easiest game on the list and the walking skeleton: build it first and you've proven auth → TV pairing → play → persistence → resume end-to-end before any real rules complexity shows up.
2. **Ludo** — adds a real board (four colored entry points converging on a shared home stretch), capture, and safe squares — still fully public, no hidden hands, one more die-driven step up from Snakes & Ladders.
3. **UNO, then UNO Flip** — the first hidden-information game: introduces private per-player hands and the TV/player broadcast split via the projection function (§2) — arguably the single most important architectural milestone, since most of the rest of the game list depends on it working. UNO Flip is a small delta once UNO works (the "bulk-mutate every zone" case from §4.4).
4. **Chess** — a real grid board and the graph-topology primitive (§4.2), but no hidden info and no reason to write move-legality by hand: delegate entirely to `chess.js` (§4.4).
5. **Chinese Checkers** — hop-chain move generation (a move can traverse many pegs), still fully public, no forced-capture wrinkle yet.
6. **Rummy** — combinatorial meld/lay-off validation (sets, runs, ace-high/low) layered onto a hidden-hand model UNO already proved out; turn structure itself stays simple.
7. **Checkers** — forced capture: legal-move generation must scan the *whole* board before any move validates, and one move can be a chained multi-jump — a step up from Chinese Checkers' hop-chains.
8. **Risk** — a large hand-authored adjacency graph (~42 territories + continent bonuses) and an unbounded dice-resolved combat sub-loop inside a single turn — the first game with real sub-loop-inside-a-turn structure.
9. **Pandemic** — cooperative shared-loss with several independent loss triggers and asymmetric per-role special actions that punch exceptions through normal turn rules.
10. **Monopoly** — the shared currency ledger, auctions, mortgages, jail sub-state, and bankruptcy, all needing to stay consistent together — reuses multi-active turns (`activePlayers` returning several seats) for trades/auctions, kept manageable by the simplified propose/accept-reject trade model (§4.1/§5.3).
11. **Catan** — hardest: the hex/vertex/edge board (§4.2), dice-driven resource distribution to *all* players at once, the robber, the bank, and multi-active trade-response turns — everything before it in this list was, in some sense, practice for this one.

---

## 9. Key references

- Board topology / hex coordinates: [redblobgames.com/grids/hexagons](https://www.redblobgames.com/grids/hexagons/)
- `boardgame.io` (design reference for the plugin vocabulary): [github.com/boardgameio/boardgame.io](https://github.com/boardgameio/boardgame.io)
- Board Game Arena's state-machine model (`ACTIVE_PLAYER`/`MULTIPLE_ACTIVE_PLAYER`): [en.doc.boardgamearena.com](https://en.doc.boardgamearena.com/Your_game_state_machine:_states.inc.php)
- `chess.js`: [github.com/jhlywa/chess.js](https://github.com/jhlywa/chess.js/)
- Socket.IO rooms/connection-state-recovery: [socket.io/docs/v4](https://socket.io/docs/v4/connection-state-recovery)
- Google ID token verification: [developers.google.com/identity](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- Caddy automatic HTTPS + WebSocket reverse proxy: [caddyserver.com/docs](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- Raspberry Pi kiosk mode (official): [raspberrypi.com/tutorials](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/)
- Event-sourcing-lite Postgres schema pattern: [github.com/eugene-khyst/postgresql-event-sourcing](https://github.com/eugene-khyst/postgresql-event-sourcing)
