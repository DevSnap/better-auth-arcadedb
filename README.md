# better-auth-arcadedb

[![npm version](https://img.shields.io/npm/v/better-auth-arcadedb)](https://www.npmjs.com/package/better-auth-arcadedb)

An ESM TypeScript database adapter for [Better Auth](https://better-auth.com), built on the official [`@arcadedb/driver`](https://github.com/ArcadeData/arcadedb-drivers).

## API stability

`arcadeDBAdapter` and `ArcadeDBAdapterConfig` are stable as of 1.0.0. Breaking changes require a major release.

Upgrading from 0.2.0 to 1.0.0 requires no API or database schema changes.

## Features

- Parameterized CRUD, filters, sorting, pagination and exact affected-row counts.
- Custom model/field names, plural names, plugin models and additional fields.
- Driver-managed transactions with commit and rollback.
- Native atomic `consumeOne` and guarded `incrementOne` operations.
- Better Auth relationship fallback queries.
- SQL schema generation, unique indexes and lookup indexes.
- TypeScript declarations; no separate HTTP client or connection configuration.

## Compatibility

| Component                    | Verified version     |
| ---------------------------- | -------------------- |
| Better Auth / test utilities | 1.7.10               |
| `@arcadedb/driver`           | 0.3.0                |
| ArcadeDB                     | 26.10.2              |
| Node.js                      | >=22 (CI: 22 and 24) |

Use ESM imports. Better Auth-generated string IDs, UUID strings and auto-incrementing numeric IDs (`generateId: "serial"`) are supported. Application IDs are distinct from ArcadeDB RIDs.

## Installation

```sh
npm install better-auth-arcadedb@1.0.0 better-auth@1.7.10 @arcadedb/driver@0.3.0
```

### Build a local tarball

To install directly from the [repository](https://github.com/DevSnap/better-auth-arcadedb):

```sh
git clone https://github.com/DevSnap/better-auth-arcadedb.git
cd better-auth-arcadedb
corepack enable
pnpm install --frozen-lockfile
pnpm pack
```

`pnpm pack` builds the ESM package through `prepack`. Repository development uses the exact pnpm version in `packageManager` and Node 22.18+ or 24.11+ (Node 24 recommended). The published package supports Node >=22. In your consuming project's directory, install the archive and peer dependencies:

```sh
npm install /path/to/better-auth-arcadedb/better-auth-arcadedb-1.0.0.tgz
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

For a runnable example with Docker and schema setup, see [examples/basic](https://github.com/DevSnap/better-auth-arcadedb/tree/main/examples/basic).

### Options

| Option      | Default | Description                                                                                        |
| ----------- | ------- | -------------------------------------------------------------------------------------------------- |
| `usePlural` | `false` | Apply Better Auth plural model naming.                                                             |
| `debugLogs` | `false` | Better Auth debug option: boolean or per-operation settings. Logs can contain authentication data. |

Configure URL, authentication and custom `fetch` on the official driver client.

### Auto-incrementing IDs

```ts
const auth = betterAuth({
  database: arcadeDBAdapter(db),
  advanced: { database: { generateId: "serial" } },
});
```

Generate and apply the schema using these same options. Serial IDs and scalar references to IDs use `LONG` properties; Better Auth returns them as strings to the application. Ordinary numeric fields remain `DOUBLE`.

The generated SQL creates a counter per model in the reserved `__better_auth_serial` type. IDs start at 1; allocation and insertion share a transaction. Reapplying the schema preserves counters. Models with disabled migrations need their properties, indexes and counter rows provisioned separately.

IDs and references must be safe integers, up to `Number.MAX_SAFE_INTEGER`. Explicit IDs accepted through Better Auth's `forceAllowId` advance the counter when larger. Deleting a document does not reset its counter. Rolled-back IDs can be reused; numbering is not guaranteed to be gapless.

Serial IDs cannot be changed after creation. References can be reassigned or cleared, but not incremented. Null references remain distinct from zero; `NOT IN` does not include null/missing references.

Use string IDs for single-use checks keyed by deterministic IDs, including some SAML, DPoP and `private_key_jwt` paths: Better Auth 1.7.10 documents that these checks lose their single-use guarantee with `serial`. Not every plugin has been tested with numeric IDs.

Direct database inserts must supply IDs and maintain counters themselves. Apply schema changes separately from live writes. Switching an existing database between string and serial IDs requires migrating IDs, references and counters. See [serial ID allocation](https://github.com/DevSnap/better-auth-arcadedb/blob/main/docs/architecture.md#serial-id-allocation) for implementation and retry details.

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

Use `sqlscript` to apply the complete multi-statement file. The [apply script](https://github.com/DevSnap/better-auth-arcadedb/blob/main/examples/basic/apply-schema.ts) makes this an explicit step, separate from generation and authentication startup.

DDL is additive (`IF NOT EXISTS`), including `id` uniqueness, indexes for `unique`, `index` and reference fields, and table-level indexes (including compound uniqueness). Plugin models with `disableMigration: true` are omitted. Changing existing property types or constraints requires a separate migration. Schema generation does not execute DDL. Required/default/enum validation is handled by Better Auth rather than generated database constraints.

## Storage and semantics

- Dates are canonical UTC ISO strings, converted back to `Date` by Better Auth.
- JSON fields are encoded as JSON strings, preserving nested objects, arrays and scalars; they are not queryable as native embedded documents. Equality and membership compare the serialized value (including object key order), rather than structural JSON equality.
- Typed array fields use native ArcadeDB lists; booleans use native boolean properties.
- Reference fields hold application IDs. The adapter does not enforce foreign keys or database cascade deletes; application/Better Auth operations manage related records.
- Relations use Better Auth's fallback queries, including when its joins option is enabled. They are not single-query native joins.
- Single-record writes use `LIMIT 1`. Empty predicates on `update`, `delete`, `consumeOne` and `incrementOne` make no changes. Bulk methods allow empty predicates.
- Text operators treat input literally, including SQL wildcard and regex characters. Case-insensitive matching uses lowercase comparison, not locale-specific collation.
- Identifiers may contain spaces, hyphens and reserved words; backticks, control characters and leading `@` metadata names are rejected.
- Truncated responses are rejected instead of silently returning partial results.

### Concurrency

`consumeOne` uses `DELETE … RETURN BEFORE … LIMIT 1`; `incrementOne` uses a guarded `UPDATE … RETURN AFTER … LIMIT 1`. Missing/null counters start at zero. Deltas must be finite numbers; setting and incrementing the same field is rejected.

Outside explicit transactions, single-record updates and atomic operations retry recognized optimistic concurrency conflicts up to seven times. Standalone serial creates retry allocation conflicts up to 31 times with backoff and jitter. Other errors propagate. Inside a transaction, a conflict aborts the transaction; the adapter does not replay the application callback. Network failures and ambiguous commit failures are never automatically retried.

## Development

```sh
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm check
pnpm test:integration
pnpm lint:package
pnpm test:package
pnpm pack
docker compose stop
```

The Compose database uses local-only port `2480` and development credentials. Integration tests create uniquely named disposable databases and drop them afterward. The test account must have database create/drop permissions. To target a dedicated external test server, set `ARCADEDB_URL`, `ARCADEDB_USERNAME` and `ARCADEDB_PASSWORD`.

## Contributing

See [CONTRIBUTING.md](https://github.com/DevSnap/better-auth-arcadedb/blob/main/CONTRIBUTING.md) for bug reports, development setup and pull requests.

Technical details: [architecture](https://github.com/DevSnap/better-auth-arcadedb/blob/main/docs/architecture.md) · [release guide](https://github.com/DevSnap/better-auth-arcadedb/blob/main/docs/releasing.md).

## License

[MIT](LICENSE).
