import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("Every feature exposes a resolvable public API and an independent build", () => {
  for (const feature of [
    "reading",
    "vocabulary",
    "translation",
    "explanation",
    "summary",
    "collection",
    "export",
  ]) {
    const root = new URL(`../../src/features/${feature}/`, import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(new URL("package.json", root)));
    assert.equal(pkg.scripts.build, "tsc -b");
    assert.ok(pkg.exports["."]);
    assert.ok(pkg.exports["./presentation"]);
    for (const name of [".", "./presentation"]) {
      for (const target of Object.values(pkg.exports[name])) {
        assert.ok(fs.existsSync(new URL(target, root)), `${feature}: missing export ${target}`);
      }
    }
  }
});
