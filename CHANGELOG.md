# Changelog

## Unreleased

Release preparation for **0.1.0**. The release coordinator will assign the date and move these notes to a versioned heading when the release is ready; this heading does not indicate npm publication.

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
- Tarball installation instructions for the unpublished package and a manual-first-release / subsequent OIDC publishing guide.
- Deterministic retry and transaction failure tests, isolated tarball consumption checks and a manual OIDC publishing workflow.
