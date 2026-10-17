# Basic checkout example

Run every command below from the repository root with Node.js 22.18+ or 24.11+ (Node 24 recommended), pnpm and Docker Compose. This example imports `../../src/index.js` to exercise the checkout. The `tsx` runner resolves these `.js` imports to the TypeScript sources; Node's built-in type stripping alone does not resolve them. No build or globally installed runner is required.

For an application consuming the tarball (or the registry package after its first release), use `import { arcadeDBAdapter } from "better-auth-arcadedb"` instead; see the [root README](../../README.md).

## 1. Install and configure

```sh
corepack enable
pnpm install --frozen-lockfile
cp -n .env.example .env
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

Set `BETTER_AUTH_SECRET` in `.env` to the generated value. The copy command preserves an existing `.env`; review its settings before proceeding.

| Variable             | Local value / purpose                                   |
| -------------------- | ------------------------------------------------------- |
| `ARCADEDB_URL`       | `http://localhost:2480`                                 |
| `ARCADEDB_USERNAME`  | `root`                                                  |
| `ARCADEDB_PASSWORD`  | `arcadedb-test-password` (matches Compose)              |
| `ARCADEDB_DATABASE`  | `better_auth`                                           |
| `BETTER_AUTH_URL`    | `http://localhost:3000` (your application's public URL) |
| `BETTER_AUTH_SECRET` | Random secret of at least 32 characters                 |

## 2. Start ArcadeDB and create the database

```sh
docker compose up -d --wait
```

The repository's `compose.yaml` starts ArcadeDB 26.10.2 on loopback port 2480. Its `arcadedb.server.defaultDatabases=better_auth[root]` setting creates `better_auth` during server startup. The example scripts expect that database to exist. If you change the database name or use an external server, create that database first with ArcadeDB Studio or the driver's `createDatabase` method and update `.env` accordingly.

## 3. Generate, inspect and apply SQL

```sh
pnpm dlx tsx --env-file=.env examples/basic/generate-schema.ts
```

Inspect the generated `arcadedb-schema.sql`, then explicitly apply it:

```sh
pnpm dlx tsx --env-file=.env examples/basic/apply-schema.ts
```

Both scripts accept an optional file path as their last argument (relative to your current working directory). Generation reads the shared Better Auth `options` from `auth.ts` and only writes SQL; it does not contact the database or execute DDL. Application reads that file and submits the full command with `language: "sqlscript"`. Neither script creates or drops databases. Generated DDL uses `IF NOT EXISTS`; changing existing property types or constraints still requires a separate migration.

After changing plugins, additional fields or model/field names, regenerate from the same options used by your application, review the SQL and apply it before serving requests.

## 4. Use the configured auth instance

`auth.ts` exports `auth`, `options` and `db`. Import `auth` into your framework's Better Auth route handler. Running `auth.ts` directly only constructs the configuration; it does not start an HTTP server. `BETTER_AUTH_URL` must match the URL where your application serves authentication requests.

To stop the local server while retaining its container and database:

```sh
docker compose stop
```
