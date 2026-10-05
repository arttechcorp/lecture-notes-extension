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

test("nextVersion has a fourth W level: build bumps it, higher levels reset it, W=0 is not written", () => {
  assert.equal(nextVersion("1.3.9", "build"), "1.3.9.1");
  assert.equal(nextVersion("1.3.9.4", "build"), "1.3.9.5");
  assert.equal(nextVersion("1.3.9.4", "patch"), "1.3.10");
  assert.equal(nextVersion("1.3.9.4", "minor"), "1.4.0");
  assert.equal(nextVersion("1.3.9.4", "major"), "2.0.0");
  assert.equal(nextVersion("1.3.9", "1.3.9.2"), "1.3.9.2");
  assert.equal(nextVersion("1.3.9.2", "1.3.10.0"), "1.3.10");
  assert.throws(() => nextVersion("1.3.9", "1.3.9.0"), /커야/);
  assert.throws(() => nextVersion("1.3.9.2", "1.3.9.1"), /커야/);
  assert.throws(() => nextVersion("1.3.9", "1.3.09.1"), /올바르지/, "Chrome: 앞자리 0 금지");
  assert.throws(() => nextVersion("1.3.9", "1.3.9.1.1"), /올바르지/, "Chrome: 정수 4개까지");
  assert.throws(() => nextVersion("1.3.9.65535", "build"), /올바르지/, "Chrome: 각 65535 이하");
});

test("addChangelogHead puts the new version under the title once", () => {
  const a = addChangelogHead("", "1.1.0", "2026-10-05");
  assert.equal(a, "# Changelog\n\n## 1.1.0 — 2026-10-05\n\n- \n\n");
  const b = addChangelogHead(a, "1.2.0", "2026-10-06");
  assert.ok(b.indexOf("## 1.2.0") < b.indexOf("## 1.1.0"));
  assert.equal(addChangelogHead(b, "1.2.0", "2026-10-07"), b, "같은 버전은 두 번 달지 않는다");
});
