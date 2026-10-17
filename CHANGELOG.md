# Changelog

## 1.0.0

### Major Changes

- Promote the existing adapter API to the first stable release. The public API consists of `arcadeDBAdapter` and `ArcadeDBAdapterConfig`, including driver-based configuration, string and serial IDs, and explicit SQL schema generation. No API or storage changes are required when upgrading from 0.2.0; the documented compatibility requirements and limitations continue to apply. Future incompatible changes to this public API will require a major release.

  Add a live npm version badge and a direct package link to the README.

## 0.2.0

### Minor Changes

- 46db4ec: Support Better Auth's `generateId: "serial"` with persistent per-model counters, transactional allocation, numeric reference schemas and bounded concurrency retries. Preserve string IDs in Better Auth output and validate safe-integer limits.

### Patch Changes

- 46db4ec: Resolve physical field metadata using canonical model keys, preserve nullable serial predicates across Better Auth conversions, reject serial ID mutations and reference increments, and validate counter/insert response invariants. Add isolated concurrency, rollback and mapping regressions and document compatibility boundaries.

## 0.1.0 — 2026-10-17

### Fixed

- Honor plugin migration opt-outs and table-level indexes, including compound uniqueness, during schema generation.
- Preserve JSON membership lists by encoding each candidate independently for `in` and `not_in` filters.

### Added

- Initial `arcadeDBAdapter` integration with Better Auth 1.7.10 and the official ArcadeDB HTTP driver 0.3.0.
- Parameterized CRUD, literal text filters, field/model mapping, ordering and pagination.
- Native single-record consume and guarded increment operations, transactions and rollback.
- Additive schema generation with unique and lookup indexes.
- Official Better Auth compatibility suites and real ArcadeDB concurrency tests.
- Local Docker setup, TypeScript declarations and CI verification.
- Runnable checkout examples with environment setup and separate SQL generation/application using the official driver's `sqlscript` command.
- Registry and tarball installation instructions and a manual-first-release / subsequent OIDC publishing guide.
- Deterministic retry and transaction failure tests, isolated tarball consumption checks and a manual OIDC publishing workflow.
- Pinned pnpm toolchain, Oxlint/Oxfmt quality checks, tsdown ESM/declaration builds and Changesets-based versioning.
