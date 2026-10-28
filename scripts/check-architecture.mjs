import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const features = [
  "reading",
  "vocabulary",
  "translation",
  "explanation",
  "summary",
  "collection",
  "export",
];
const errors = [];
const walk = (directory) =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() && !["dist", "node_modules"].includes(entry.name)
        ? walk(path.join(directory, entry.name))
        : entry.isFile()
          ? [path.join(directory, entry.name)]
          : [],
    );
const files = [
  ...walk(path.join(root, "src/features")),
  ...walk(path.join(root, "src/modules")),
  ...walk(path.join(root, "src/apps")),
].filter((p) => /\.(ts|js)$/.test(p));
for (const filename of files) {
  const relative = path
    .relative(path.join(root, "src"), filename)
    .replaceAll("\\", "/");
  const text = fs.readFileSync(filename, "utf8");
  const source = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const feature = relative.match(/^features\/([^/]+)\//)?.[1];
  for (const node of source.statements) {
    const specifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    const target = specifier.text;
    if (
      feature &&
      target.startsWith("@ys/") &&
      !["@ys/shared"].includes(target)
    )
      errors.push(
        `${relative}: feature imports another business unit: ${target}`,
      );
    if (
      relative.startsWith("modules/gateway/") &&
      target.startsWith("@ys/") &&
      !["@ys/syncs", "@ys/shared"].includes(target)
    )
      errors.push(`${relative}: gateway bypasses syncs: ${target}`);
    if (
      /\/src\/(domain|application)\//.test(relative) &&
      /adapters|presentation/.test(target)
    )
      errors.push(
        `${relative}: inward layer imports outward implementation: ${target}`,
      );
    if (target.startsWith(".") && feature) {
      const resolved = path.relative(
        path.join(root, "src/features", feature),
        path.resolve(path.dirname(filename), target),
      );
      if (resolved.startsWith(".."))
        errors.push(`${relative}: relative escape from feature`);
    }
    if (
      /@ys\/(reading|translation|explanation|summary|collection|export|vocabulary)\/presentation/.test(
        target,
      ) &&
      !relative.startsWith("apps/")
    )
      errors.push(
        `${relative}: presentation assembly is restricted to application entries`,
      );
  }
  if (
    /\/src\/domain\//.test(relative) &&
    /\b(?:fetch|chrome|indexedDB|document|window)\b/.test(text)
  )
    errors.push(`${relative}: domain depends on browser/network state`);
  if (
    /features\/.*\/src\/presentation\//.test(relative) &&
    /chrome\.storage|indexedDB/.test(text)
  )
    errors.push(`${relative}: presentation bypasses its state owner`);
}
// Resolve names even in migrated dynamic DOM views. Browser globals are explicit.
const ambient = path.join(root, "artifacts/lint-globals.d.ts");
fs.mkdirSync(path.dirname(ambient), { recursive: true });
fs.writeFileSync(ambient, "declare const chrome: any;\n");
const program = ts.createProgram([...files, ambient], {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  strict: false,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
});
for (const diagnostic of program.getSemanticDiagnostics())
  if (
    [2304, 2552].includes(diagnostic.code) &&
    diagnostic.file &&
    !diagnostic.file.fileName.includes("/dist/")
  ) {
    const at = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start || 0,
    );
    errors.push(
      `${path.relative(root, diagnostic.file.fileName)}:${at.line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
    );
  }
for (const name of features) {
  const base = path.join(root, "src/features", name);
  for (const layer of ["application", "presentation"])
    if (!fs.existsSync(path.join(base, "src", layer)))
      errors.push(name + ": missing " + layer);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  `Architecture passed: ${features.length} feature modules; inward dependencies; explicit presentation assembly; ${files.length} source files checked for unresolved names.`,
);
