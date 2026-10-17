# Changesets

For user-visible changes after the initial release, run `pnpm changeset` and
commit the generated Markdown file with the implementation. Choose a patch,
minor or major bump and describe the change for package users.

Run `pnpm version:packages` when preparing a release. This consumes pending
changesets, updates package versions and changelogs, synchronizes the pnpm
lockfile and formats the repository. Review and commit those changes before
tagging the verified release.

The initial unpublished `0.1.0` release is already described in `CHANGELOG.md`;
this tooling migration does not request an additional version bump.

Changesets manages versioning only. Publication uses the manual GitHub Actions
OIDC workflow described in [the release guide](../docs/releasing.md).
