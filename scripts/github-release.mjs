import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line === `## ${version}` || line.startsWith(`## ${version} — `),
  );
  assert.ok(start >= 0, `Missing changelog section for ${version}`);
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end++;
  const notes = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  assert.ok(notes, `Empty changelog section for ${version}`);
  return `${notes}\n\n## Distribution\n\nThe attached tarball is the verified artifact submitted to npm staging. npm publication requires separate maintainer approval; this GitHub Release does not confirm npm availability.\n\n[npm package](https://www.npmjs.com/package/better-auth-arcadedb/v/${version})\n`;
}

export function shouldBeLatest(tag, releases) {
  const stable = /^v(\d+)\.(\d+)\.(\d+)$/;
  assert.match(tag, stable);
  const candidate = tag.match(stable).slice(1).map(BigInt);
  return !releases.some((release) => {
    if (release.draft || release.prerelease || !stable.test(release.tag_name)) {
      return false;
    }
    const other = release.tag_name.match(stable).slice(1).map(BigInt);
    for (let i = 0; i < 3; i++) {
      if (other[i] !== candidate[i]) return other[i] > candidate[i];
    }
    return false;
  });
}

async function main() {
  const {
    RELEASE_TAG: tag,
    RELEASE_SHA: sha,
    RELEASE_DIRECTORY: directory,
  } = process.env;
  assert.match(tag ?? "", /^v\d+\.\d+\.\d+$/);
  assert.match(sha ?? "", /^[a-f0-9]{40}$/);
  assert.ok(directory, "RELEASE_DIRECTORY is required");
  const run = (command, args) =>
    execFileSync(command, args, { encoding: "utf8" }).trim();
  run("git", ["fetch", "origin", `refs/tags/${tag}`]);
  assert.equal(run("git", ["rev-parse", "FETCH_HEAD^{commit}"]), sha);
  run("git", ["merge-base", "--is-ancestor", sha, "origin/main"]);
  const manifest = JSON.parse(run("git", ["show", `${sha}:package.json`]));
  assert.equal(manifest.name, "better-auth-arcadedb");
  assert.equal(`v${manifest.version}`, tag);
  const archive = `better-auth-arcadedb-${manifest.version}.tgz`;
  const archivePath = join(directory, archive);
  assert.ok((await readFile(archivePath)).length, "Empty release tarball");
  const notesPath = join(directory, "release-notes.md");
  await writeFile(
    notesPath,
    releaseNotes(run("git", ["show", `${sha}:CHANGELOG.md`]), manifest.version),
  );
  const releases = JSON.parse(
    run("gh", [
      "api",
      "repos/{owner}/{repo}/releases?per_page=100",
      "--paginate",
      "--slurp",
    ]),
  ).flat();
  const existing = releases.find((release) => release.tag_name === tag);
  if (!existing) {
    run("gh", [
      "release",
      "create",
      tag,
      "--verify-tag",
      "--draft",
      "--title",
      tag,
      "--notes-file",
      notesPath,
    ]);
  }
  if (!existing?.assets.some((asset) => asset.name === archive)) {
    run("gh", ["release", "upload", tag, archivePath]);
  }
  if (!existing || existing.draft) {
    run("gh", [
      "release",
      "edit",
      tag,
      "--draft=false",
      `--latest=${shouldBeLatest(tag, releases)}`,
    ]);
  }
  console.log(
    run("gh", ["release", "view", tag, "--json", "url", "--jq", ".url"]),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
