# Hexfleet — Design

**Date:** 2026-08-31
**Status:** Approved, ready for implementation planning

## 1. What this is

Hexfleet is multiplayer battleships on a single shared hexagonal sea. Two to
six captains place fleets on the *same* board, then take turns firing at it.
Because everyone shares the water, one hex can hold several captains' hulls and
a single shot can strike more than one fleet at once. Hulls run along three
axes rather than two.

The design was authored in Claude Design and imported to `design/`:

- `design/Hex Battleships.dc.html` — the visual and interaction reference,
  including a complete single-player prototype of the rules.
- `design/styles.css` — the "Organic" design system: colour ramps, type scale,
  spacing, radii, elevation.

The prototype is client-only and fills empty seats with bots. This spec covers
turning it into real multiplayer: a React frontend on GitHub Pages talking to a
Cloudflare Worker backed by Durable Objects, deployed by GitHub Actions.

`design/_ds_bundle.js` in the source project turned out to be empty (no
components), so the design system is `styles.css` alone. It is not vendored
here.

## 2. Rules

Fixed by the design and carried over unchanged:

- **Board.** Hexagonal, axial coordinates, radius 10 (331 cells). Cells are all
  `(q, r)` with `max(|q|, |r|, |q+r|) <= R`.
- **Axes.** Three: `[1,0]` (E–W), `[0,1]` (NW–SE), `[-1,1]` (NE–SW).
- **Fleet.** Five hulls per captain: Carrier 5, Cutter 4, Trawler 3, Skiff 3,
  Tug 2. Each occupies contiguous cells along exactly one axis.
- **Overlap.** A captain's own hulls may not overlap each other. Hulls
  belonging to *different* captains may freely share a hex — this is the point
  of the shared sea.
- **Firing.** One shot per turn at any not-yet-shot hex. The shot strikes every
  captain *other than the shooter* whose hull occupies that hex. The shooter is
  never damaged by their own shot.
- **Sinking.** A hull is sunk when every one of its cells has been struck.
- **Elimination.** A captain is out when all five hulls are sunk.
- **Victory.** The table ends when at most one captain still has an unsunk
  hull.
- **Turn clock.** 30 seconds.

### Rules added for real multiplayer

- **Adrift.** Three consecutive turn-clock expiries mark a captain adrift.
  Adrift captains are skipped in the turn order; their fleet stays on the board
  as a target. Reconnecting clears the flag and restores them to the rotation.
- **Abandoned table.** If every captain still standing is adrift, the table
  ends and goes to results. Without this an abandoned game auto-fires at itself
  until one fleet happens to sink.

## 3. Decisions

| Question | Decision |
| --- | --- |
| Seating | Humans only, 2–6. No bots anywhere in the system. The captain who created the table is the host and starts the battle once at least two captains have locked their fleets. |
| Turn expiry | Auto-fire at a uniformly random unshot hex, so play always advances. Three consecutive expiries → adrift. |
| Identity | Opaque per-seat token minted by the Durable Object, held in `localStorage` under `hexfleet:seat:<code>`. No accounts, no login. |
| Table lifecycle | "Play again" resets the same Durable Object to lobby, keeping the code, seats and names. A table idle for 24h in lobby or results is deleted, freeing its code. |
| Frontend | React + Vite. |
| Sync | Redacted snapshot on connect, then sequence-numbered events; client refetches a snapshot on any gap. |
| Hosting | GitHub Pages at `https://tim-patterson.github.io/hexfleet/` (Vite `base: '/hexfleet/'`); Worker on a `workers.dev` subdomain, its URL injected at build time via `VITE_API_BASE`. |
| Repo | `tim-patterson/hexfleet`. |

## 4. Architecture

One repository, three npm workspaces.

```
hexfleet/
  package.json               workspaces: shared, worker, web
  packages/
    shared/                  @hexfleet/shared
    worker/                  Cloudflare Worker + TableDO
    web/                     React + Vite frontend
  design/                    imported design reference
  docs/superpowers/specs/
  .github/workflows/         ci.yml, deploy.yml
```

### 4.1 `@hexfleet/shared`

Exists because placement legality and hit resolution must be identical on both
sides: the client previews whether a hull fits (the mockup's green/orange
preview hexes), the server enforces it. One implementation, tested once,
imported by both. It is pure — no I/O, no platform APIs.

| Module | Responsibility |
| --- | --- |
| `hex.ts` | Axial coordinate type, `AXES`, `key(q,r)`, board generation for a radius, membership test, pixel layout for rendering. |
| `ships.ts` | `SHIPS` table, `Fleet` type, `validateFleet`, `cellsFor(start, axis, len)`. |
| `rules.ts` | `resolveShot`, `shipStatus`, `isAlive`, `standings`, `stats`, `nextTurn`. |
| `protocol.ts` | `ClientMsg`, `ServerMsg`, `Snapshot`, `GameEvent`, `PublicSeat`. |
| `reduce.ts` | `applyEvent(snapshot, event) -> snapshot`, used by the client. |

### 4.2 Worker

Three routes, everything else 404:

- `POST /api/tables` — mint an unused code, return `{ code }`.
- `GET  /api/tables/:code/ws` — WebSocket upgrade, forwarded to the DO.
- `GET  /api/health` — liveness, for smoke-testing a deploy.

**Origin check.** The upgrade request's `Origin` header must be
`https://tim-patterson.github.io` or a configured localhost dev origin.
Rejected otherwise. With no accounts in the system this is the only thing
keeping the Worker from serving arbitrary third-party pages.

**Codes.** Format stays `WORD-NN` — four letters, dash, two digits — as the
mockup's validation regex and placeholder require. The prototype's six words
give only 300 codes, so the word list widens to 64 nautical four-letter words
for ~6,400 combinations. Minting generates a candidate, asks that DO whether it
is occupied, and retries up to 10 times before returning 503.

### 4.3 TableDO

One Durable Object per table code, addressed by `env.TABLES.idFromName(code)`.
SQLite-backed (`new_sqlite_classes` migration).

State, persisted in `ctx.storage` and mirrored in memory:

```ts
type TableState = {
  code: string
  phase: 'lobby' | 'battle' | 'results'
  hostSeat: number
  seats: Seat[]                              // index === seat number
  fleets: Record<number, Fleet>              // SECRET
  shots: Record<HexKey, { by: number; hits: number[] }>
  turn: number
  turnDeadline: number                       // epoch ms
  seq: number
  createdAt: number
  lastActivityAt: number
}

type Seat = {
  seat: number
  name: string
  color: string          // PALETTE[seat]
  tokenHash: string      // SHA-256 of the seat token
  ready: boolean         // fleet locked
  adrift: boolean
  timeouts: number       // consecutive
  connected: boolean
}
```

**Secrecy.** `fleets` never leaves the DO except to its owner. A snapshot built
for seat *n* contains that seat's fleet, the public shot map, and *derived*
per-ship status for every seat (`{ shipId, len, hits, sunk }`). The derived
status drives the mockup's coloured pips in the player rail and leaks no
positions — only counts, which are already visible on the board as hit markers.

**Hibernation.** Sockets are accepted with `ctx.acceptWebSocket()` and carry
their seat number in the socket attachment, so an idle table costs nothing and
a woken socket still knows who it is. All handlers are `webSocketMessage`,
`webSocketClose`, `webSocketError`.

**Alarms.** A Durable Object has one alarm slot, so it is always set to
`min(turnDeadline, idleEvictAt)` and the handler decides which job to do by
comparing clocks, then re-arms. `idleEvictAt = lastActivityAt + 24h`, and
eviction (`ctx.storage.deleteAll()`) only happens in `lobby` or `results`.

**Validation.** On `lockFleet`: exactly five hulls with the right ids and
lengths, each contiguous along one of the three axes, every cell in bounds, no
self-overlap. On `fire`: phase is `battle`, it is the sender's turn, the hex is
in bounds, the hex has not been shot. Every rejection returns an `error` event
to that socket alone and mutates nothing.

## 5. Protocol

WebSocket, JSON frames.

### Client → server

| Message | Payload | Notes |
| --- | --- | --- |
| `hello` | `{ token?, name? }` | First frame. A valid token rejoins that seat; otherwise a new seat is allocated and a token minted. Fails if the table is full or in battle with no free seat. |
| `lockFleet` | `{ fleet }` | Lobby only. Validated. |
| `unlockFleet` | `{}` | Lobby only — backs the "Change my placement" button. |
| `startBattle` | `{}` | Host only, lobby only, ≥2 seats ready. |
| `fire` | `{ q, r }` | Battle only, on your turn. |
| `rematch` | `{}` | Host only, results only. |
| `resync` | `{}` | Request a fresh snapshot; sent on a seq gap. |

### Server → client

`snapshot` carries the whole redacted state and the current `seq`. Every other
message is an event with a `seq` exactly one greater than the last:

`seatJoined`, `seatLeft`, `seatReady`, `seatUnready`, `battleStarted`,
`shotFired` (`{ seat, q, r, hits, sunk }`), `turnAdvanced`
(`{ seat, deadline }`), `seatAdrift`, `seatReturned`, `gameEnded`
(`{ standings }`), `rematchStarted`, `error` (`{ code, message }`, unsequenced,
sent only to the offending socket).

A client that receives `seq !== expected` sends `resync` and discards events
until the snapshot arrives.

## 6. Frontend

React + Vite, `base: '/hexfleet/'`.

The prototype's `renderVals()` is already a pure state-to-view projection, so
it decomposes directly:

- **Screens:** `Landing`, `Name`, `Board`, `Results`. `Board` covers the
  deploy, waiting and battle phases, swapping only its right-hand panel — this
  mirrors the `sc-if` blocks in the mockup, which share the board and rail.

  The server has three phases, the UI has five states; they map as: server
  `lobby` + my seat not ready → **deploy**; server `lobby` + my seat ready →
  **waiting**; server `battle` → **battle**; server `results` → **results**.
  `Landing` and `Name` are pre-connection and have no server phase. This is why
  "Change my placement" on the waiting screen is `unlockFleet` and is legal in
  the lobby phase.
- **Components:** `HexBoard` (absolutely-positioned round cells plus rotated
  hull bars), `PlayerRail`, `ShipTray` with the three axis buttons,
  `FleetStatus`, `Standings`.
- **`useTable(code)`** owns the socket: connect, send `hello` with any stored
  token, hold the snapshot, apply events through `shared/reduce`, detect seq
  gaps, reconnect with exponential backoff and jitter.

**No optimistic updates.** The game is turn-based; a click sends `fire` and
waits for the server's echo. This costs one round trip of latency and buys the
guarantee that the client can never render a hit the server did not agree to.

**Local UI state** — hover, selected hull, drag, the deploy-time axis, sound
mute — stays in React and never goes over the wire. A fleet is only transmitted
when locked.

**Styling.** `design/styles.css` becomes a real stylesheet in `web`. Inline
styles are kept only where they are genuinely per-instance: hex positions, hull
rotations, seat colours.

**Audio.** The prototype's WebAudio SFX (`splash`, `boom`, `sunk`, `place`,
`win`) port verbatim into `audio.ts`; they are self-contained and need no
server involvement.

## 7. Testing

The valuable tests are on `shared`, because that is where the logic is and it
is pure. Written test-first:

- Hex geometry: board size for a radius, membership, neighbours, round-tripping
  through pixel layout.
- Placement: legal fleets on each of the three axes; rejection of off-board,
  non-contiguous, wrong-length, self-overlapping and duplicate-hull fleets;
  acceptance of two captains overlapping each other.
- Shot resolution: miss; hit one fleet; one hex striking several fleets at
  once; the shooter's own hull never hit; sunk detection; last-cell-of-last-hull
  eliminating a captain.
- Standings, accuracy and turn advance, including skipping eliminated and
  adrift seats.

The DO is tested with `@cloudflare/vitest-pool-workers` driving real
WebSockets: a full lobby → deploy → battle → results run, plus rejoin with a
valid token, rejoin with a junk token, firing out of turn, firing an
already-shot hex, locking an illegal fleet, non-host trying to start, clock
expiry auto-firing, and three expiries producing adrift.

Frontend tests stay light: the board projection and the event reducer.

## 8. Deployment

**`ci.yml`** — on every push and pull request: `npm ci`, typecheck, test,
build.

**`deploy.yml`** — on push to `main`, two jobs:

1. Build `web` with `VITE_API_BASE` from a repository variable, then
   `actions/upload-pages-artifact` and `actions/deploy-pages`. Needs
   `permissions: { pages: write, id-token: write }`, and the repository's Pages
   source set to "GitHub Actions".
2. Deploy the Worker with `cloudflare/wrangler-action`, using repository
   secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

The Cloudflare token needs the *Edit Cloudflare Workers* template. Setting it
up is a manual step taken at deploy time, walked through interactively rather
than documented and forgotten.

Durable Objects are available on the Cloudflare free plan, so this incurs no
hosting cost.

## 9. Out of scope

Deliberately not built: spectators, chat, reconnect across devices, persistent
player accounts, matchmaking or a public table list, leaderboards, mobile-
specific layout beyond the design's existing flex wrapping, and any form of
bot or AI opponent.
