# Releasing

Repository: [DevSnap/better-auth-arcadedb](https://github.com/DevSnap/better-auth-arcadedb).

Version `0.1.0` is the initial release, dated 2026-10-17. Subsequent releases are prepared with Changesets and published through the workflow below.

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

`prepack` builds `dist`. Inspect the archive file list: it should contain the built JavaScript and declarations, TypeScript sources for source maps, package metadata, README, changelog and license, without local environment files. `test:package` verifies the packed artifact in an isolated consumer. You can also install the actual archive and peers in a separate ESM consumer project:

```sh
npm install /path/to/better-auth-arcadedb/better-auth-arcadedb-1.0.0.tgz better-auth@1.7.10 @arcadedb/driver@0.3.0
node --input-type=module -e 'import { arcadeDBAdapter } from "better-auth-arcadedb"; console.log(typeof arcadeDBAdapter)'
```

The import check should print `function`. Run the [checkout example](../examples/basic/README.md) to verify schema generation and explicit application against the local database. Stop the server with `docker compose stop` when finished.

## First npm publication: manual

The first release is published manually by an npm account authorized to create the unscoped `better-auth-arcadedb` package. Confirm package-name availability and ownership before publishing. The release coordinator sets the dated `0.1.0` changelog heading and coordinates the version, tag and release notes.

From the verified release checkout, authenticate with npm and publish the inspected tarball:

```sh
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm publish ./better-auth-arcadedb-0.1.0.tgz --access public --registry=https://registry.npmjs.org
```

Complete npm's interactive authentication/2FA as requested. These are release commands for the maintainer to execute, not setup steps for contributors. After successful publication, verify `npm view better-auth-arcadedb@0.1.0 version` and test registry installation in a separate project. Then update the README's publication status and installation guidance. A published version cannot be reused for a later release.

## Subsequent releases: GitHub Actions OIDC

After the first manual publication, configure a trusted publisher in the npm package's settings with these exact GitHub values:

| Setting              | Value                         |
| -------------------- | ----------------------------- |
| Organization or user | `DevSnap`                     |
| Repository           | `better-auth-arcadedb`        |
| Workflow filename    | `publish.yml` (filename only) |
| Environment          | `npm`                         |

The included `.github/workflows/publish.yml` is manually dispatched from `main` with an existing `vX.Y.Z` tag. Configure the GitHub environment `npm` before enabling this flow. It uses GitHub-hosted runners, `permissions: contents: read` and `id-token: write`, and Node 24 with `registry-url: https://registry.npmjs.org`. Trusted publishing currently requires **npm >=11.5.1 and Node >=22.14.0**; the workflow checks the npm version. The package's Node >=22 runtime requirement is separate from these publishing-tool requirements.

The job resolves the tag to a commit on `main`, verifies the manifest version and installs dependencies with pnpm's frozen lockfile. It reruns checks, build, package validation and real-database integration on that exact commit. It then packs the release with pnpm, rechecks the remote tag and stages the tarball with `npm stage publish` using OIDC without an npm write token. Ensure `package.json` has `repository.url` matching `https://github.com/DevSnap/better-auth-arcadedb.git` (normally `git+https://github.com/DevSnap/better-auth-arcadedb.git` in npm metadata). Stage each version only once. The workflow does not run automatically on pushes or tags.

In npm's trusted-publisher settings, keep the `npm stage publish` permission; direct publish and dist-tag management are not required. After the workflow succeeds, a maintainer reviews and approves the staged version in npm, completing the requested authentication/2FA. Only approval makes the version publicly available and updates `latest`. The CLI alternative is `npm stage approve <stage-id>` from an authenticated maintainer session. A staged version reserves its version number, so do not rerun a successful staging job. Newly created trusted-publisher configurations must be validated before the deadline shown by npm. The workflow submits provenance alongside the staged package.

### Automatic GitHub Release

After successful npm staging, a separate `Create GitHub Release` job creates the release from the existing tag, using that commit's changelog section and attaching the exact tarball submitted to npm. The tarball is preserved as a workflow artifact for 30 days before staging. Only the GitHub Release job receives `contents: write`; npm staging retains `contents: read` and `id-token: write`.

The order is **tag and verification → npm staging → GitHub Release → maintainer approval on npm**. GitHub Releases represent versioned source and downloadable artifacts, so they can be public before npm approval. Their distribution notes explicitly distinguish the GitHub Release from npm availability. No registry polling is required.

The job first creates a draft, uploads the tarball, then publishes the release. A new stable version becomes Latest unless a higher stable GitHub release already exists. Historical releases cannot displace a newer Latest. Existing release notes are preserved, and missing tarballs can be uploaded on a retry without duplicating releases.

If GitHub Release creation fails after npm staging succeeds, use **Re-run failed jobs** in the same Actions run to retry only `Create GitHub Release`. Do not use **Re-run all jobs** or dispatch `Publish npm` again for a successfully staged version. The retry needs the preserved artifact; after its 30-day retention expires, recover the original tarball from npm once approved and create the GitHub Release manually from the existing tag and changelog. Never move an existing version tag or rebuild a replacement artifact for an already published version.

## Versioning with Changesets

After the initial `0.1.0` publication, include a changeset with each user-visible change:

```sh
pnpm changeset
pnpm changeset status
```

To prepare the next release, run `pnpm version:packages`. This consumes the pending changesets, updates `package.json` and `CHANGELOG.md`, synchronizes `pnpm-lock.yaml` and formats the files. Review and commit that release preparation, run all verification commands, then create the matching `vX.Y.Z` tag. Dispatch `Publish npm` from `main` with that tag after configuring OIDC, then approve the staged version in npm.

Changesets owns versioning and changelog generation; the workflow owns publication. Do not run `changeset publish` alongside the OIDC workflow. The initial `0.1.0` notes were finalized manually; use Changesets for later versions.

See [npm's current trusted-publisher documentation](https://docs.npmjs.com/trusted-publishers/) for the latest setup requirements.
