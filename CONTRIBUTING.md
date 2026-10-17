# Contributing

## Setup

Use Node.js 22.18+ or 24.11+ and the exact pnpm version in `packageManager`. `.nvmrc` selects Node 24. Run `corepack enable` once to activate pnpm; if Corepack is unavailable, install the pinned pnpm version from `package.json`.

```sh
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm check
pnpm test:integration
```

`pnpm check` runs Oxlint, Oxfmt's formatting check, strict TypeScript checking, unit tests and the tsdown build. `pnpm format` formats files; `pnpm lint:fix` applies lint fixes. Integration tests require an actual ArcadeDB server; they do not silently skip when it is unavailable.

Tests use disposable databases. Always use a dedicated development/test server with an account permitted to create and drop databases. `docker compose stop` stops the local service and retains its database. The [basic example](examples/basic/README.md) uses the persistent `better_auth` database separately from integration-test databases.

## Changes

- Keep database values parameterized and identifiers quoted.
- Preserve Better Auth's public adapter contract and schema mapping.
- Add meaningful regression tests for behavior changes.
- Exercise database-specific behavior against ArcadeDB, especially concurrency and affected-row counts.
- Update the README and changelog when the public behavior changes.
- Run `pnpm pack` when changing package exports or build output.
- Run `pnpm test:package` to verify the packed artifact in an isolated npm consumer.
- Commit `pnpm-lock.yaml`; install with `--frozen-lockfile` in CI. Do not add npm or Yarn lockfiles.
- After the initial release, run `pnpm changeset` for user-visible changes and commit the generated release note. Tooling-only changes do not require a version bump unless they affect the distributed package.

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat: add a supported adapter capability
fix: correct null filtering
test: cover concurrent token consumption
docs: explain schema generation
ci: update the verification matrix
chore: update development dependencies
```

Use a `!` and a `BREAKING CHANGE:` footer when appropriate. Keep commits focused and independently understandable.

## Release preparation

Version `0.1.0` is being prepared and has not been published to npm. Keep release notes under `Unreleased` until the release coordinator chooses the release date. Use a local tarball to verify consumer installation before publication.

Follow [docs/releasing.md](docs/releasing.md) for package checks, the manual first publication and subsequent GitHub Actions OIDC setup for `DevSnap/better-auth-arcadedb` with `publish.yml`. The guide describes the publishing workflow requirements; configure and verify that workflow before using it. Version tags, GitHub releases and npm publication are maintainer release actions.
