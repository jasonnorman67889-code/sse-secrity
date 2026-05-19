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

- Private key: `keys/sovereign_private.pem` (git-ignored)
- Public key: `static/keys/sovereign_public.pem` (served to frontend)

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

- Scans every 30 seconds.
- Auto-reverts tampered `identity_events` rows when a Golden Record is available.
- Sends Telegram alert on heal action.
- Publishes `AUTO_HEAL_REVERT` pulse events to Redis `biometric-stream` for HUD feedback.
# sse-security-as-code
