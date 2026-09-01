# Hexfleet

Multiplayer battleships on one shared hexagonal sea, for two to six captains.
Hulls lie along three axes instead of two, several fleets can occupy the same
hex, and a single shot can strike more than one captain at once.

Play at <https://tim-patterson.github.io/hexfleet/>.

## Layout

| Package | What it is |
| --- | --- |
| `packages/shared` | Pure hex geometry, ship rules and the wire protocol. Imported by both other packages so placement legality and hit resolution have one implementation. |
| `packages/worker` | Cloudflare Worker routing WebSocket upgrades into one `TableDO` Durable Object per table code. Sole authority on game state; the only holder of fleet positions. |
| `packages/web` | React + Vite frontend, deployed to GitHub Pages. |
| `design/` | The imported Claude Design source this was built from. |
| `docs/superpowers/` | The design spec and the implementation plan. |

## Running locally

```bash
npm ci
npm run dev -w @hexfleet/worker   # http://127.0.0.1:8787
npm run dev -w @hexfleet/web      # http://localhost:5173
```

The frontend defaults to `http://127.0.0.1:8787` when `VITE_API_BASE` is unset.

The deployed Worker only accepts WebSocket upgrades from the production Pages
origin (see `ALLOWED_ORIGINS` in `packages/worker/wrangler.toml`). To let the
local Vite dev server talk to `wrangler dev`, copy
`packages/worker/.dev.vars.example` to `packages/worker/.dev.vars` (already
gitignored) — `wrangler dev` picks it up automatically and it overrides
`ALLOWED_ORIGINS` for local runs only.

## Testing

```bash
npm test          # every workspace
npm run typecheck
```

`packages/worker` uses `@cloudflare/vitest-pool-workers`, which runs the real
Durable Object under Miniflare. Its clock tests use shortened `TURN_MS` and
`IDLE_MS` bindings set in `packages/worker/vitest.config.ts`.

## Deployment

Pushes to `main` run `.github/workflows/deploy.yml`, which builds the frontend
to GitHub Pages and deploys the Worker with Wrangler.

**One-time setup:**

1. **Pages** — repository *Settings → Pages → Build and deployment → Source:
   GitHub Actions*.
2. **Cloudflare API token** — Cloudflare dashboard → *My Profile → API Tokens →
   Create Token → Edit Cloudflare Workers* template. Scope it to your account.
3. **Repository secrets and variables:**

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID
   gh variable set VITE_API_BASE --body 'https://hexfleet-api.<your-subdomain>.workers.dev'
   ```

The Worker refuses WebSocket upgrades from any origin outside
`ALLOWED_ORIGINS` in `packages/worker/wrangler.toml`. If the Pages URL ever
changes, update that list or tables will silently fail to connect.

## Rules

- Hexagonal board, radius 8 (217 cells), axial coordinates.
- Five hulls per captain: Carrier 5, Cutter 4, Trawler 3, Skiff 3, Tug 2, each
  along one of three axes.
- Your own hulls may not overlap. Other captains' hulls may share your hexes.
- One shot per turn, 30-second clock. A shot strikes every captain with a hull
  on that hex -- including the captain who fired it, so mind your own fleet.
- Three consecutive clock expiries mark a captain adrift; they are skipped but
  their fleet stays a target, and reconnecting brings them back.
- The table ends when one fleet is left afloat.
