# Contributing

## Setup

Use Node.js 22 or 24 and npm. `.nvmrc` selects Node 24.

```sh
npm ci
docker compose up -d --wait
npm run check
npm run test:integration
```

`npm run check` runs Biome, strict TypeScript checking, unit tests and the build. `npm run format` applies formatting and safe lint fixes. Integration tests require an actual ArcadeDB server; they do not silently skip when it is unavailable.

Tests use disposable databases. Always use a dedicated development/test server with an account permitted to create and drop databases. `docker compose stop` stops the local service and retains its database. The [basic example](examples/basic/README.md) uses the persistent `better_auth` database separately from integration-test databases.

## Changes

- Keep database values parameterized and identifiers quoted.
- Preserve Better Auth's public adapter contract and schema mapping.
- Add meaningful regression tests for behavior changes.
- Exercise database-specific behavior against ArcadeDB, especially concurrency and affected-row counts.
- Update the README and changelog when the public behavior changes.
- Run `npm pack --dry-run` when changing package exports or build output.
- Run `npm run test:package` to verify the packed artifact in an isolated consumer.

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
