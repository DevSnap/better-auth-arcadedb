# Architecture decisions

## Scope and dependencies

The package adapts Better Auth to the official ArcadeDB HTTP driver. The application owns the driver client and passes an `ArcadeDBDatabase` handle. Both the driver and Better Auth are peer dependencies to avoid duplicate runtime instances. No new HTTP transport is introduced.

Initial versions verified against published artifacts: Better Auth/test-utils 1.7.10, driver 0.3.0, server 26.10.2. Broader compatibility is not assumed.

## Better Auth factory

`createAdapterFactory` owns string ID generation, field/model mapping, date conversions, output transformations and relation fallback queries. The adapter allocates serial IDs in the database; the factory converts numeric IDs/references to strings on output. The custom adapter translates normalized operations to SQL. `findMany` explicitly projects selected fields because the published factory does not apply its select argument when transforming these results.

The public entry point exports only `arcadeDBAdapter` and `ArcadeDBAdapterConfig`.

Every custom operation uses the factory's canonical `modelKey` for metadata and the physical `model` for SQL targets. Physical field names are resolved by matching `fieldName ?? key` directly within that canonical model, avoiding ambiguity when models or fields swap names with other schema keys.

Better Auth 1.7.10 converts null serial predicates to zero before dispatch. A small wrapper around predicate-bearing methods preserves the original predicate in Node's `AsyncLocalStorage`; the SQL boundary restores scalar nulls for IDs/references after verifying the canonical model and mapped field. This keeps concurrent and nested invocations isolated while retaining the factory's other transformations. Membership retains SQL null semantics. Revisit this compatibility bridge when upgrading Better Auth.

## Toolchain and distribution

pnpm owns dependency resolution and the committed lockfile. Oxlint checks code, Oxfmt formats files and `tsc --noEmit` checks types independently. tsdown cleans and builds the single ESM entry point plus bundled declarations and source maps; Better Auth and the ArcadeDB driver remain external peer dependencies. Vitest separates unit tests from real-database integration tests. The tarball smoke test installs the pnpm-produced archive into an isolated npm consumer, checking public imports, types and declaration maps. Changesets prepares versions/changelogs; GitHub Actions publishes verified tarballs with npm OIDC.

## SQL and types

Identifiers are backtick-quoted with explicit rejection of unsupported characters and metadata names. Values use named bound parameters. Connectors are grouped left-to-right. Null equality uses `IS NULL`; missing nullable properties therefore participate in null comparisons. Empty membership lists compile to constant expressions.

Text matching uses Java-pattern quoted literals with embedded quote-terminator escaping. User input cannot add regex structure. Pagination is validated and rendered as integers.

HTTP JSON cannot preserve JavaScript `Date` objects directly. Dates use ISO strings with factory conversion. JSON fields use an explicit SQL-boundary string codec for all JSON kinds: assignments and equality encode one value, while membership encodes each candidate independently. The factory's default non-native JSON codec alone only serializes object inputs, so it is insufficient for JSON scalar strings. Arrays declared as array fields remain native lists. JSON equality compares serialized values, including object key order.

## Atomicity and transactions

Verified server primitives:

```sql
UPDATE `model` SET `remaining` = ifnull(`remaining`, 0) + :delta
RETURN AFTER WHERE `id` = :id AND `remaining` > :minimum LIMIT 1

DELETE FROM `model` RETURN BEFORE WHERE `id` = :id LIMIT 1
```

Concurrent integration tests establish single-consumer behavior, preservation of other matching rows, bounded decrements and no lost increments. Exact bulk counts come from the command's `{ count }` result, never a preliminary SELECT.

Only recognized `ConcurrentModificationException` errors are eligible for bounded single-statement retries outside transactions. Explicit transaction callbacks run with the driver's session-scoped database handle, and conflicts propagate without callback replay. The driver owns begin, commit and rollback handling.

### Serial ID allocation

Serial schemas initialize one counter row per physical model in `__better_auth_serial`, keyed by a unique `model` property with a `LONG` value. A standalone create opens a driver transaction, increments its counter with `RETURN AFTER`, then inserts the document. Creates inside application transactions use that transaction's handle. Explicit IDs advance the counter using `max(value, id)`. Both counter changes and documents roll back together. Safe-integer validation protects IDs/references and allocation stops before JSON/JavaScript integer precision is lost.

Standalone allocation transactions retry recognized MVCC conflicts up to 31 times with capped exponential backoff plus jitter. ArcadeDB can check the document's unique ID index before reporting the counter page's MVCC conflict; a `DuplicatedKeyException` qualifies only for automatic IDs and only when structured `exceptionArgs` names that model's exact `model[id]` index. Other unique constraints, explicit IDs, transport errors and ambiguous commits are not replayed. Application transaction callbacks are never replayed.

Serial IDs cannot be mutated after creation. Numeric references can be reassigned but not incremented. Allocation refuses missing/negative/null/exhausted counters, validates returned safe integers and requires the inserted ID to equal the assigned value. Standalone validation failures roll back the allocation transaction; application transaction errors propagate to the callback owner. Tests cover swapped metadata names, nullable predicates, mixed explicit/automatic allocations, duplicate explicit IDs, real transaction conflicts and invalid protocol responses. Serial scenarios use fresh databases per test to avoid ordering dependencies.

Better Auth's own deterministic-ID single-use checks have a documented limitation under `serial` in 1.7.10 (some SAML, DPoP and private-key JWT paths); adapter conformance does not override that framework limitation or certify every plugin.

Trigger probes against 26.10.2 ruled out the documented implementation: SQL bodies reject multiple statements, `UPDATE $record` on a BEFORE CREATE record fails with a null RID, and JavaScript execution shares a GraalVM context that rejects concurrent thread access. Adapter-owned transactions provide verified allocation without deploying Java classes or depending on these trigger paths. Direct SQL inserts must maintain the counter themselves.

## Schema generation

Better Auth provides the actual schema, including plugin models. Generated DDL creates document types, properties and indexes without applying them. References are application IDs with lookup indexes, not graph edges or enforced foreign keys. Serial IDs and scalar references to IDs use `LONG`; ordinary numbers remain `DOUBLE`. Serial counter initialization is conditional and preserves existing values. Apply the script separately from concurrent application writes. Models with disabled migrations need externally provisioned counters. Schema evolution, strategy conversion, database cascades and native join optimization are outside this initial generator's guarantees.

## Verification

Unit tests cover SQL boundary cases, allocation retry boundaries and protocol failures. Integration tests run the published Better Auth normal, case-insensitive, join, transaction, UUID, numeric-ID and auth-flow suites, plus adapter-specific concurrency, rollback, plural naming and JSON round-trip cases. Numeric suites use a separate database because additive DDL cannot change existing string properties to LONG. CI runs the same checks against a pinned ArcadeDB Docker image on Node 22 and 24.
