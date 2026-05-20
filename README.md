# sv

Everything you need to build a Svelte project, powered by [sv](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.15.3 create --template minimal --types ts --add prettier sveltekit-adapter="adapter:node" eslint playwright tailwindcss="plugins:typography" drizzle="database:sqlite+sqlite:libsql" better-auth="demo:password" mdsvex mcp="ide:vscode+setup:remote" storybook --no-install sovereign-command-center-2
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Security-as-Code: Identity + Evidence Ledger

This workspace includes a Prisma-backed append-only audit pipeline with tamper-evident chaining:

- `IdentityEvent`: biometric/workstation auth events
- `EvidenceLedger`: immutable receipt entries chained by `previousHash`

### Files added

- `prisma/schema.prisma`
- `src/lib/server/prisma.ts`
- `src/lib/server/evidence-ledger.ts`
- `src/routes/api/identity-events/+server.ts`
- `scripts/verify-ledger.js`

### Run Prisma setup

```sh
npm install
npm run prisma:generate
```

If this is your first run with SQLite, create/migrate the schema:

```sh
npm run prisma:migrate -- --name init_identity_audit
```

### Ingest identity events

POST `api/identity-events` with JSON body:

```json
{
    "actorId": "eng-001",
    "action": "BIOMETRIC_SUCCESS",
    "workstationId": "ws-17",
    "biometricType": "FINGERPRINT",
    "riskScore": 0.14,
    "locationData": { "lat": 1.3521, "lng": 103.8198 }
}
```

Each accepted event writes:

1. An `IdentityEvent` record
2. A chained `EvidenceLedger` record with HMAC-SHA256 hash

### Verify chain integrity

```sh
npm run ledger:verify
```

If any link or payload hash is inconsistent, the script prints `TAMPER DETECTED` and exits with a non-zero code.

## Sovereign Public Key (HUD local verification)

Generate the local verification keypair:

```sh
npm run keys:generate
```

Generated files:

Frontend helper is available at `src/lib/crypto/sovereignPublicKey.ts`.

## Sovereign Sentinel (Self-Healing Worker)

The Sentinel worker continuously scans for unauthorized mutations in `identity_events` compared to ledger proofs and auto-heals from a Golden Record cache.

### Bootstrap Golden Records

Run this when chain integrity is green:

```sh
npm run sentinel:bootstrap
```

If you must seed from a partially tampered state, cache only verifiable rows:

```sh
npm run sentinel:bootstrap:tainted
```

### Run Autonomous Defense Loop

```sh
npm run sentinel:auto-heal
```

Behavior:

## Global Grid Quickstart

Use Docker Compose to scale geographically distinct workstation nodes quickly.

1. Ensure the dashboard is running at `http://localhost:5173`.
2. Start global nodes:

```powershell
docker compose up -d --build
```

The compose stack launches nodes for Tokyo, Frankfurt, and Sao Paulo.

## Threat Intel Overlay

The globe includes a threat overlay fed by `GET /api/threat-intel`.

- Red flickering dots represent simulated suspicious infrastructure.
- Severity is encoded by flicker intensity (`high`, `medium`, `low`).

## Sentinel Watchdog

Run the watchdog to automatically restart Sentinel if it goes offline:

```powershell
node scripts/sentinel-watchdog.mjs
```

Optional environment variables:

- `SENTINEL_PROCESS_NAME` (default: `sovereign-sentinel`)
- `SENTINEL_WATCHDOG_INTERVAL_MS` (default: `10000`)

## Correlation Engine Blueprint

This repository now includes a defensive cross-plane correlation engine.

### New Defensive APIs

- `POST /api/risk/spam-events`
- `POST /api/risk/identity-logs`

When both of the following occur within 30 minutes for the same `userId`, rule `spam_identity_001` triggers:

1. `spam_events.url_clicked = true`
2. `identity_logs.type = impossible_travel`

On trigger, SOAR hooks execute:

- Telegram alert attempt (via `PROXY_URL` when configured)
- Session-revocation placeholder (logged until session storage is configured)
- HUD update through Redis stream action `SPAM_IDENTITY_CORRELATED`

### SQL Schema

Yes, the SQL schema has been generated for correlation tables:

- `scripts/sql/correlation_schema.sql`

Apply it with your preferred SQLite workflow, or use Drizzle schema sync (`npm run db:push`) after updating `DATABASE_URL`.

### Defensive Pivot Simulation

Use the safe simulation script to test correlation and HUD overlays:

```powershell
python scripts/pivot-shadow-sim.py
```

This emits synthetic spam + impossible-travel events and validates the full defensive path. The script exits non-zero on failure and prints `PASS` on success.

Expected visual output:

- Red risk path line (lateral attempt visualization)
- Yellow exposure marker (spam-plane user exposure)

### Correlation Unit Test

Run the deterministic rule test for enterprise CI/CD validation:

```powershell
npm run test:correlation
```

### Enterprise Compose Upgrade

`docker-compose.yml` now includes:

- `neo4j-graph` (ports `7474`, `7687`)
- `kafka-stream` (port `9092`, KRaft mode)
- Global workstation nodes (Tokyo, Frankfurt, Sao Paulo)

## Step 0: Defensive Infrastructure Initialization

Initialize the multi-region Kubernetes federation for the 13-phase defensive deployment:

```powershell
npm run k8s:init:defensive
```

This executes:

1. Namespace bootstrap:
    - `simulation`
    - `telemetry`
    - `fraud-defense`
    - `replay`
    - `governance`
2. Node labeling for multi-region roles:
    - Los Angeles command node
    - London resilience node
    - Singapore simulation node
3. Defensive manifests:
    - `k8s/namespaces/*.yaml`
    - `k8s/infrastructure/simulation-storage-network.yaml`

### Direct Command Form (If you need manual execution)

```bash
kubectl create namespace simulation
kubectl create namespace telemetry
kubectl create namespace fraud-defense
kubectl create namespace replay
kubectl create namespace governance

kubectl label nodes los-angeles-primary region=los-angeles role=command --overwrite
kubectl label nodes london-secondary region=london role=resilience --overwrite
kubectl label nodes singapore-replay region=singapore role=simulation --overwrite
```

Synthetic simulation capacity quota in `simulation` is enforced at:

- `requests.cpu: 4`
- `requests.memory: 8Gi`
- `limits.cpu: 8`
- `limits.memory: 16Gi`

Persistent storage and network isolation for simulation/replay/governance are defined in:

- `k8s/infrastructure/simulation-storage-network.yaml`

## Autonomous SOC Python Agent Dependencies

The LangChain SOC helper uses a pinned Python dependency set for reproducible setup.

Install dependencies:

```powershell
python -m pip install -r scripts/requirements-autonomous-soc.txt
```

Run the agent:

```powershell
python scripts/autonomous-soc-langchain-agent.py
```

If `OPENAI_API_KEY` (or `OPENAI_ADMIN_KEY`) is not set, the script runs in defensive heuristic fallback mode.
