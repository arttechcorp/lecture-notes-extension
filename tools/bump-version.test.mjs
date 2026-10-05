import test from "node:test";
import assert from "node:assert/strict";
import { nextVersion, addChangelogHead } from "./bump-version.mjs";

test("nextVersion bumps patch/minor/major, accepts an explicit higher X.Y.Z, refuses equal or lower", () => {
  assert.equal(nextVersion("1.0.0", "patch"), "1.0.1");
  assert.equal(nextVersion("1.0.9", "minor"), "1.1.0");
  assert.equal(nextVersion("1.4.2", "major"), "2.0.0");
  assert.equal(nextVersion("1.0.0", "1.1.0"), "1.1.0");
  assert.throws(() => nextVersion("1.1.0", "1.1.0"), /커야/);
  assert.throws(() => nextVersion("1.1.0", "1.0.9"), /커야/);
  assert.throws(() => nextVersion("1.1.0", "next"), /올바르지/);
  assert.throws(() => nextVersion("1.1", "patch"), /X\.Y\.Z/);
});

test("addChangelogHead puts the new version under the title once", () => {
  const a = addChangelogHead("", "1.1.0", "2026-10-05");
  assert.equal(a, "# Changelog\n\n## 1.1.0 — 2026-10-05\n\n- \n\n");
  const b = addChangelogHead(a, "1.2.0", "2026-10-06");
  assert.ok(b.indexOf("## 1.2.0") < b.indexOf("## 1.1.0"));
  assert.equal(addChangelogHead(b, "1.2.0", "2026-10-07"), b, "같은 버전은 두 번 달지 않는다");
});
