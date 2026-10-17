# Architecture decisions

## Scope and dependencies

The package adapts Better Auth to the official ArcadeDB HTTP driver. The application owns the driver client and passes an `ArcadeDBDatabase` handle. Both the driver and Better Auth are peer dependencies to avoid duplicate runtime instances. No new HTTP transport is introduced.

Initial versions verified against published artifacts: Better Auth/test-utils 1.7.10, driver 0.3.0, server 26.10.2. Broader compatibility is not assumed.

## Better Auth factory

`createAdapterFactory` owns IDs, field/model mapping, date conversions, output transformations and relation fallback queries. The custom adapter translates normalized operations to SQL. `findMany` explicitly projects selected fields because the published factory does not apply its select argument when transforming these results.

The public entry point exports only `arcadeDBAdapter` and `ArcadeDBAdapterConfig`.

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

## Schema generation

Better Auth provides the actual schema, including plugin models. Generated DDL creates document types, properties and indexes without applying them. References are string IDs with lookup indexes, not graph edges or enforced foreign keys. Schema evolution, database cascades and native join optimization are outside this initial generator's guarantees.

## Verification

Unit tests cover SQL boundary cases and protocol failures. Integration tests run the published Better Auth normal, case-insensitive, join, transaction, UUID and auth-flow suites, plus adapter-specific concurrency, rollback, plural naming and JSON round-trip cases. CI runs the same checks against a pinned ArcadeDB Docker image on Node 22 and 24.
