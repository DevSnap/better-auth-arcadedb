# better-auth-arcadedb

An ESM TypeScript database adapter for [Better Auth](https://better-auth.com), built on the official [`@arcadedb/driver`](https://github.com/ArcadeData/arcadedb-drivers).

Local development version: **0.1.0**. This project has not been published to npm.

## Features

- Parameterized CRUD, filters, sorting, pagination and exact affected-row counts.
- Custom model/field names, plural names, plugin models and additional fields.
- Driver-managed transactions with commit and rollback.
- Native atomic `consumeOne` and guarded `incrementOne` operations.
- Better Auth relationship fallback queries.
- SQL schema generation, unique indexes and lookup indexes.
- TypeScript declarations; no separate HTTP client or connection configuration.

## Compatibility

| Component | Verified version |
| --- | --- |
| Better Auth / test utilities | 1.7.10 |
| `@arcadedb/driver` | 0.3.0 |
| ArcadeDB | 26.10.2 |
| Node.js | 22 and 24 |

Use ESM imports. Auto-incrementing numeric IDs (`generateId: "serial"`) are not supported. Better Auth-generated string IDs and UUID strings are supported and are distinct from ArcadeDB RIDs.

## Local installation

```sh
npm ci
npm run build
```

For another local project, build an archive with `npm pack`, install the resulting archive there, and install the peer dependencies:

```sh
npm install /path/to/better-auth-arcadedb/better-auth-arcadedb-0.1.0.tgz
npm install better-auth@1.7.10 @arcadedb/driver@0.3.0
```

## Configure Better Auth

```ts
import { basicAuth, createClient } from "@arcadedb/driver";
import { betterAuth } from "better-auth";
import { arcadeDBAdapter } from "better-auth-arcadedb";

const server = createClient({
  baseUrl: process.env.ARCADEDB_URL!,
  auth: basicAuth(
    process.env.ARCADEDB_USERNAME!,
    process.env.ARCADEDB_PASSWORD!,
  ),
});

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  database: arcadeDBAdapter(server.db(process.env.ARCADEDB_DATABASE!), {
    usePlural: false,
  }),
  emailAndPassword: { enabled: true },
});
```

Create the database and apply the generated schema before serving requests. The adapter does not create or alter schema during authentication.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `usePlural` | `false` | Apply Better Auth plural model naming. |
| `debugLogs` | `false` | Better Auth debug option: boolean or per-operation settings. Logs can contain authentication data. |

Configure URL, authentication and custom `fetch` on the official driver client.

## Schema generation

The adapter implements Better Auth's `createSchema` hook for the CLI `generate` command. You can also generate SQL directly from your exact Better Auth options:

```ts
const options = {
  emailAndPassword: { enabled: true },
  // Include your plugins, additional fields and custom model/field names here.
};
const adapter = arcadeDBAdapter(db)(options);
const schema = await adapter.createSchema!(options);
// Write schema.code to schema.path (arcadedb-schema.sql by default).
```

Apply the SQL file through ArcadeDB Studio, its console, or the official driver:

```ts
import { readFile } from "node:fs/promises";

await db.command({
  language: "sqlscript",
  command: await readFile("arcadedb-schema.sql", "utf8"),
});
```

DDL is additive (`IF NOT EXISTS`), including `id` uniqueness and indexes for `unique`, `index` and reference fields. Changing existing property types or constraints requires a separate migration. Schema generation does not execute DDL. Required/default/enum validation is handled by Better Auth rather than generated database constraints.

## Storage and semantics

- Dates are canonical UTC ISO strings, converted back to `Date` by Better Auth.
- JSON fields are encoded as JSON strings, preserving nested objects, arrays and scalars; they are not queryable as native embedded documents.
- Typed array fields use native ArcadeDB lists; booleans use native boolean properties.
- Reference fields hold application IDs. The adapter does not enforce foreign keys or database cascade deletes; application/Better Auth operations manage related records.
- Relations use Better Auth's fallback queries, including when its joins option is enabled. They are not single-query native joins.
- Single-record writes use `LIMIT 1`. Empty predicates on `update`, `delete`, `consumeOne` and `incrementOne` make no changes. Bulk methods allow empty predicates.
- Text operators treat input literally, including SQL wildcard and regex characters. Case-insensitive matching uses lowercase comparison, not locale-specific collation.
- Identifiers may contain spaces, hyphens and reserved words; backticks, control characters and leading `@` metadata names are rejected.
- Truncated responses are rejected instead of silently returning partial results.

### Concurrency

`consumeOne` uses `DELETE … RETURN BEFORE … LIMIT 1`; `incrementOne` uses a guarded `UPDATE … RETURN AFTER … LIMIT 1`. Missing/null counters start at zero. Deltas must be finite numbers; setting and incrementing the same field is rejected.

Outside explicit transactions, single-record updates and atomic operations retry recognized optimistic concurrency conflicts up to seven times. Other errors propagate. Inside a transaction, a conflict aborts the transaction; the adapter does not replay the application callback. Network failures and ambiguous commit failures are never automatically retried.

## Development

```sh
npm ci
docker compose up -d --wait
npm run check
npm run test:integration
npm pack --dry-run
docker compose down -v
```

The Compose database uses local-only port `2480` and development credentials. Integration tests create uniquely named disposable databases and drop them afterward. The test account must have database create/drop permissions. To target a dedicated external test server, set `ARCADEDB_URL`, `ARCADEDB_USERNAME` and `ARCADEDB_PASSWORD`.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [architecture decisions](docs/architecture.md).

## License

[MIT](LICENSE).
