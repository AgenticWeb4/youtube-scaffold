import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, ".."),
  output = path.join(root, "dist/extension");
const files = fs
  .readdirSync(output, { recursive: true })
  .filter((name) => fs.statSync(path.join(output, name)).isFile());
const allow = new Set([
  "manifest.json",
  "background.js",
  "content.js",
  "sidepanel.js",
  "options.js",
  "sidepanel.html",
  "options.html",
  "sidepanel.css",
  "options.css",
  "action-icons.css",
  "LUCIDE-LICENSE",
  "DEXIE-LICENSE",
  "README.md",
  "PRIVACY.md",
  "LICENSE",
  "NOTICE",
  "prompts/analysis.md",
  "prompts/explain.md",
  "prompts/note-cleanup.md",
  "prompts/translation.md",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
]);
const errors = [];
for (const file of files)
  if (!allow.has(file.replaceAll("\\", "/")))
    errors.push("Unexpected public file: " + file);
for (const file of allow)
  if (!fs.existsSync(path.join(output, file)))
    errors.push("Missing public file: " + file);
const manifest = JSON.parse(
  fs.readFileSync(path.join(output, "manifest.json"), "utf8"),
);
const version = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;
if (manifest.version !== version)
  errors.push("Manifest version differs from root package");
for (const group of ["apps", "features", "modules"]) {
  for (const name of fs.readdirSync(path.join(root, "src", group))) {
    const pkg = path.join(root, "src", group, name, "package.json");
    if (
      fs.existsSync(pkg) &&
      JSON.parse(fs.readFileSync(pkg, "utf8")).version !== version
    )
      errors.push(`Package version mismatch: ${group}/${name}`);
  }
}
for (const name of ["LICENSE", "NOTICE", "PRIVACY.md"]) {
  if (
    !fs
      .readFileSync(path.join(root, name))
      .equals(fs.readFileSync(path.join(output, name)))
  )
    errors.push("Published policy differs from source: " + name);
}
if (manifest.manifest_version !== 3 || manifest.name !== "YouTube Scaffold")
  errors.push("Unexpected manifest identity");
if (
  JSON.stringify(manifest.permissions) !==
  JSON.stringify(["sidePanel", "storage", "tabs", "scripting"])
)
  errors.push("Unexpected permissions");
if (
  JSON.stringify(manifest.host_permissions) !==
  JSON.stringify([
    "https://www.youtube.com/*",
    "https://api.supadata.ai/*",
    "https://api.deepseek.com/*",
  ])
)
  errors.push("Unexpected host scope");
for (const file of [
  "background.js",
  "content.js",
  "sidepanel.js",
  "options.js",
]) {
  const result = spawnSync(
    process.execPath,
    ["--check", path.join(output, file)],
    { encoding: "utf8" },
  );
  if (result.status) errors.push(file + ": " + result.stderr);
  const text = fs.readFileSync(path.join(output, file), "utf8");
  if (
    /127\.0\.0\.1|Fixture preview|Synthetic data used only|fixture-key/.test(
      text,
    )
  )
    errors.push("Development fixture entered production: " + file);
  if (
    /\bsk-[A-Za-z0-9_-]{20,}|\bsd_[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(
      text,
    )
  )
    errors.push("Possible credential: " + file);
}
for (const page of ["sidepanel.html", "options.html"]) {
  const text = fs.readFileSync(path.join(output, page), "utf8");
  for (const match of text.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    if (
      !/^[a-z]+:/i.test(match[1]) &&
      !fs.existsSync(path.join(output, match[1]))
    )
      errors.push(page + " references missing " + match[1]);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  `Release passed: ${files.length} allowlisted files; exact permissions; no preview or credential material.`,
);
