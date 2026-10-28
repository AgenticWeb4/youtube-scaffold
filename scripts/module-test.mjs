import { spawnSync } from "node:child_process";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const feature = process.argv[2];
const tests = {
  reading: "reading",
  vocabulary: "vocabulary",
  translation: "translation",
  explanation: "explanation",
  summary: "summary",
  collection: "collection",
  export: "export",
  syncs: "application",
  infrastructure: "infrastructure",
  gateway: "presentation",
  shared: "contracts",
  extension: "application",
};
const integration = new Set([
  "application",
  "configuration",
  "contracts",
  "infrastructure",
  "vocabulary",
]);
const testFile = path.join(
  root,
  "tests",
  integration.has(tests[feature]) ? "integration" : "unit",
  `${tests[feature]}.test.mjs`,
);
const testFiles =
  feature === "vocabulary"
    ? [
        testFile,
        path.join(root, "tests/integration/vocabulary-storage.test.mjs"),
        path.join(root, "tests/unit/vocabulary-view.test.mjs"),
        path.join(root, "tests/unit/vocabulary-dialog.test.mjs"),
      ]
    : [testFile];
const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
  cwd: root,
});
process.exitCode = result.status ?? 1;
