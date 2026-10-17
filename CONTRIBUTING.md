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

Tests use disposable databases. Always use a dedicated development/test server with an account permitted to create and drop databases. `docker compose down -v` removes the local service after testing.

## Changes

- Keep database values parameterized and identifiers quoted.
- Preserve Better Auth's public adapter contract and schema mapping.
- Add meaningful regression tests for behavior changes.
- Exercise database-specific behavior against ArcadeDB, especially concurrency and affected-row counts.
- Update the README and changelog when the public behavior changes.
- Run `npm pack --dry-run` when changing package exports or build output.

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

## Release status

The repository is in local development. There is no automatic publishing workflow. Version tags, pushes, GitHub releases and npm publication require an explicit maintainer decision.
