# Contributing

## Issues and proposals

Use [GitHub Issues](https://github.com/DevSnap/better-auth-arcadedb/issues) to report bugs or propose improvements. Search existing issues before opening a new one.

- For a bug report, include the expected and actual behavior, reproduction steps or a minimal example, and the versions of Node.js, Better Auth, `@arcadedb/driver`, ArcadeDB, and this adapter. Include relevant errors or logs with credentials, tokens, and personal data removed.
- For a feature request, describe the use case, the current limitation, and the proposed behavior.
- Open an issue to discuss substantial changes before implementing them. Small fixes and documentation corrections can go directly to a pull request.

## Pull requests

1. Fork the repository into your GitHub account and create a branch for your change.
2. Set up the development environment below and make a focused change following the project conventions.
3. Run `pnpm check` and the additional checks relevant to your change, including `pnpm test:integration` for database behavior.
4. Open a pull request against `main`. Explain the change, link any related issue, and list the checks you ran.

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
- Run `pnpm changeset` for user-visible changes and commit the generated release note. Tooling-only changes do not require a version bump unless they affect the distributed package.

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

Maintainers: follow [docs/releasing.md](docs/releasing.md) to prepare versions with Changesets and publish through GitHub Actions.
