import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseNotes, shouldBeLatest } from "./github-release.mjs";

test("notes use only the exact version section, including dated headings", () => {
  const changelog =
    "# Changelog\r\n\r\n## 1.1.0\r\n\r\nNewer\r\n\r\n## 1.0.0 — 2026-10-17\r\n\r\n### Added\r\n\r\nStable API\r\n\r\n## 0.2.0\r\n\r\nOlder\r\n";
  const notes = releaseNotes(changelog, "1.0.0");
  assert.ok(notes.startsWith("### Added\n\nStable API\n\n"));
  assert.ok(!notes.includes("Newer") && !notes.includes("Older"));
  assert.match(notes, /requires separate maintainer approval/);
  assert.match(notes, /better-auth-arcadedb\/v\/1\.0\.0/);
  assert.throws(() => releaseNotes(changelog, "1.0.1"), /Missing/);
  assert.throws(
    () => releaseNotes("## 1.0.0\n\n## 0.2.0\nOlder", "1.0.0"),
    /Empty/,
  );
});

test("historical releases cannot replace a newer stable Latest", () => {
  const release = (tag_name, flags = {}) => ({ tag_name, ...flags });
  assert.equal(shouldBeLatest("v1.0.0", []), true);
  assert.equal(shouldBeLatest("v0.2.0", [release("v1.0.0")]), false);
  assert.equal(shouldBeLatest("v1.9.0", [release("v1.10.0")]), false);
  assert.equal(shouldBeLatest("v1.0.1", [release("v1.0.2")]), false);
  assert.equal(shouldBeLatest("v1.10.0", [release("v1.9.0")]), true);
  assert.equal(shouldBeLatest("v1.0.0", [release("v1.0.0")]), true);
  assert.equal(
    shouldBeLatest("v1.0.0", [
      release("v2.0.0", { draft: true }),
      release("v3.0.0", { prerelease: true }),
      release("v4.0.0-beta.1"),
      release("other-package@5.0.0"),
    ]),
    true,
  );
  assert.throws(() => shouldBeLatest("v1.0.0-beta.1", []));
});
