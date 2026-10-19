# Releasing

Releases use Changesets for versioning and the [`Publish npm`](../.github/workflows/publish.yml) workflow for npm staging and GitHub Releases. A maintainer then approves the staged package on npm.

## Prepare the version

Include a changeset with each user-visible change:

```sh
pnpm changeset
pnpm changeset status
```

When ready to release, run `pnpm version:packages`. This consumes pending changesets, updates `package.json` and `CHANGELOG.md`, synchronizes `pnpm-lock.yaml` and formats the files. Review and commit the result before verification.

## Verify the release candidate

Use Node 24 and the pnpm version pinned in `packageManager` for release preparation. The development toolchain needs Node 22.18+ or 24.11+; the package itself supports ESM on Node >=22.

```sh
corepack enable
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm check
pnpm test:integration
pnpm lint:package
pnpm test:package
pnpm pack
```

`prepack` builds `dist`. Inspect the archive: it should contain built JavaScript and declarations, TypeScript sources for source maps, package metadata, README, changelog and license. Local environment files must not be included. `test:package` checks the packed artifact in an isolated consumer. To check the archive manually in a separate ESM project:

```sh
npm install /path/to/better-auth-arcadedb/better-auth-arcadedb-1.0.0.tgz better-auth@1.7.10 @arcadedb/driver@0.3.0
node --input-type=module -e 'import { arcadeDBAdapter } from "better-auth-arcadedb"; console.log(typeof arcadeDBAdapter)'
```

The import check should print `function`. Run the [checkout example](../examples/basic/README.md) to verify schema generation and explicit application against the local database. Stop the server with `docker compose stop` when finished.

## Configure trusted publishing

In the npm package's settings, configure a trusted publisher with these GitHub values:

| Setting              | Value                         |
| -------------------- | ----------------------------- |
| Organization or user | `DevSnap`                     |
| Repository           | `better-auth-arcadedb`        |
| Workflow filename    | `publish.yml` (filename only) |
| Environment          | `npm`                         |

Create the GitHub environment `npm`. The workflow uses GitHub-hosted runners, Node 24 and OIDC (`id-token: write`). Trusted publishing requires **npm >=11.5.1 and Node >=22.14.0**; the workflow checks the npm version.

Keep the `npm stage publish` permission in npm's trusted-publisher settings; direct publish and dist-tag management are not required. Validate new configurations before the deadline shown by npm. The manifest's `repository.url` must match `https://github.com/DevSnap/better-auth-arcadedb.git` (with the usual `git+` prefix in npm metadata).

See [npm's trusted-publisher documentation](https://docs.npmjs.com/trusted-publishers/) for current setup requirements.

## Publish

1. Create and push the matching `vX.Y.Z` tag on the verified release commit on `main`.
2. Dispatch `Publish npm` from `main`, supplying that tag. Pushes and tags do not start the workflow automatically.
3. After the workflow succeeds, review and approve the staged version in npm, completing authentication/2FA. The CLI alternative is `npm stage approve <stage-id>` from an authenticated maintainer session.
4. Verify the published version with `npm view better-auth-arcadedb@X.Y.Z version` and test registry installation in a separate project.

The workflow verifies that the tag belongs to `main` and matches the manifest version. It reruns checks, build, package validation and database integration tests on that commit, packs the release, rechecks the remote tag and stages the tarball with provenance using OIDC.

A separate `Create GitHub Release` job publishes the tag's changelog section and attaches the exact staged tarball. Only this job receives `contents: write`. It creates a draft, uploads the archive, then publishes; existing notes are preserved on retries. A stable version becomes Latest unless a higher stable release exists.

The order is **verification → npm staging → GitHub Release → npm approval**. The GitHub Release can therefore be public before the package is available on npm. Only npm approval publishes the package and updates `latest`.

### Failed jobs and retries

A staged version reserves its version number. Do not rerun successful staging or run `changeset publish` alongside this workflow.

If GitHub Release creation fails after staging succeeds, use **Re-run failed jobs** in the same Actions run to retry only `Create GitHub Release`. Do not use **Re-run all jobs** or dispatch `Publish npm` again. The tarball artifact is retained for 30 days; after that, recover the original tarball from npm once approved and create the GitHub Release manually from the existing tag and changelog. Never move a version tag or rebuild an artifact for an already published version.
