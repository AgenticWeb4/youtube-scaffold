import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const modules = [
  ["Reading", "src/features/reading", "createReadingService"],
  ["Vocabulary", "src/features/vocabulary", "createVocabulary"],
  ["Translation", "src/features/translation", "createTranslationService"],
  ["Explanation", "src/features/explanation", "createExplanationService"],
  ["Summary", "src/features/summary", "createSummaryService"],
  ["Collection", "src/features/collection", "createCollectionService"],
  ["Export", "src/features/export", "createExportService"],
  ["Configuration", "src/modules/infrastructure", "createConfiguration"],
];
const syncFile = "src/modules/syncs/SYNCS.md";
const sync = read(syncFile);
const errors = [];
const methods = new Map();
const specs = [];

// Inspect each factory's public return object, including nested reading.viewStorage.
// This checks name coverage, not parameter semantics or behavioral conformance.
for (const [name, base, factoryName] of modules) {
  const file = `${base}/CONCEPT.md`;
  const doc = read(file);
  specs.push({ name, file, doc });
  for (const heading of [
    "purpose",
    "state",
    "actions",
    "operational principle",
  ])
    if (!doc.includes(`## ${heading}\n`))
      errors.push(`${file}: missing ${heading}`);
  if (!doc.startsWith(`# concept ${name}`))
    errors.push(`${file}: wrong concept name`);
  const sourceFile =
    name === "Configuration"
      ? `${base}/src/index.ts`
      : `${base}/src/application/service.${name === "Export" ? "js" : "ts"}`;
  const ast = ts.createSourceFile(
    sourceFile,
    read(sourceFile),
    ts.ScriptTarget.Latest,
    true,
  );
  const factory = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === factoryName,
  );
  if (!factory?.body) throw new Error(`Missing factory ${factoryName}`);
  const returned = factory.body.statements
    .filter(ts.isReturnStatement)
    .at(-1)?.expression;
  if (!returned || !ts.isObjectLiteralExpression(returned))
    throw new Error(`Cannot inspect public return of ${factoryName}`);
  const names = new Set();
  function collect(object, prefix = "") {
    for (const property of object.properties) {
      const key = property.name?.getText(ast);
      if (!key || key === "api") continue;
      if (key === "viewStorage") {
        const declaration = factory.body.statements
          .filter(ts.isVariableStatement)
          .flatMap((s) => s.declarationList.declarations)
          .find((d) => d.name.getText(ast) === key)?.initializer;
        if (declaration && ts.isObjectLiteralExpression(declaration))
          collect(declaration, `${key}.`);
      } else names.add(`${prefix}${key}`);
    }
  }
  collect(returned);
  methods.set(name, names);
  for (const method of names)
    if (!doc.includes(method))
      errors.push(`${file}: undocumented public action ${method}`);
}

// Route rows must track all apply() switch cases, including explicit refusals.
const mediator = ts.createSourceFile(
  "syncs.ts",
  read("src/modules/syncs/src/index.ts"),
  ts.ScriptTarget.Latest,
  true,
);
const routes = new Set();
function visit(node) {
  if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression))
    routes.add(node.expression.text);
  ts.forEachChild(node, visit);
}
visit(mediator);
const documented = new Set(
  [...sync.matchAll(/^\| ([a-zA-Z]+) \|/gm)].map((m) => m[1]),
);
for (const route of routes)
  if (!documented.has(route))
    errors.push(`${syncFile}: missing route ${route}`);
for (const route of documented)
  if (!routes.has(route)) errors.push(`${syncFile}: stale route ${route}`);

const includes = [...sync.matchAll(/^include (\w+)(?: \[\w+\])? from (.+)$/gm)];
for (const [name] of modules) {
  const include = includes.find((m) => m[1] === name);
  const expected = specs.find((s) => s.name === name).file;
  if (
    !include ||
    path.posix.normalize(
      path.posix.join(path.posix.dirname(syncFile), include[2]),
    ) !== expected
  )
    errors.push(`${syncFile}: missing/wrong include for ${name}`);
}
for (const match of sync.matchAll(/\b(\w+)\/([\w.]+):/g)) {
  const [, owner, action] = match;
  if (["Gateway", "View"].includes(owner)) {
    if (!sync.includes(`\`${owner}/${action}\``))
      errors.push(`${syncFile}: undeclared entry ${owner}/${action}`);
  } else if (!methods.get(owner)?.has(action)) {
    errors.push(`${syncFile}: unresolved action ${owner}/${action}`);
  }
}

// Check local specification/evidence links and explicit include destinations.
for (const { file, doc } of [...specs, { file: syncFile, doc: sync }]) {
  const targets = [...doc.matchAll(/\]\(([^\s)]+)\)/g)].map((m) => m[1]);
  if (file === syncFile) targets.push(...includes.map((m) => m[2]));
  for (const target of targets) {
    if (/^[a-z]+:\/\//i.test(target)) continue;
    const [relative, anchor] = target.split("#");
    const destination = relative
      ? path.resolve(root, path.dirname(file), relative)
      : path.join(root, file);
    if (!fs.existsSync(destination))
      errors.push(`${file}: broken link ${target}`);
    else if (anchor) {
      const headings = [
        ...fs.readFileSync(destination, "utf8").matchAll(/^#{1,6} (.+)$/gm),
      ].map((m) =>
        m[1]
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, "")
          .replace(/\s/g, "-"),
      );
      if (!headings.includes(anchor))
        errors.push(`${file}: broken anchor ${target}`);
    }
  }
}

// Rebuild navigation from contract contents, never modification times.
let map = `# 架构与规格导航\n\n此文件由 \`node scripts/check-specs.mjs --write-map\` 从 CONCEPT/SYNCS 内容派生，勿手改。\n\n`;
map += `## 扫描范围\n\n覆盖 7 个 feature、Configuration、工作线程 mediator、页面补译/回放/重置协调及对应测试引用。\n不扫描生成的 dist、node_modules 或历史研究。用途为实现回填推断，不代表产品设计适切性已证明。\n\n`;
map += `## 概念索引\n\n| 概念 | 用途 | 权威规格 |\n| --- | --- | --- |\n`;
for (const { name, file, doc } of specs) {
  const purpose = doc.match(/## purpose\n\n([^\n]+)/)?.[1] || "待补";
  map += `| ${name} | ${purpose} | [CONCEPT](${file}) |\n`;
}
map += `\n## 同步地图\n\n权威来源：[SYNCS](${syncFile})。全部 ${routes.size} 个 mediator 路由在 route coverage 表中；\n下图只展示 SYNCS 内显式命名规则。单动作路由、权限/重放中间件和 UI 导出回调不伪装为额外同步节点。\n\n实线为 when 完成或 then 调用；虚线保留 where 过滤/绑定。多条 when 入边表示同一 flow 内的合取。\nGateway/View 是外部入口，矩形动作名均回溯到 include 契约；图不表示同步引擎已存在。\n\n`;
const ruleNames = new Set();
for (const flow of sync.split(/^\/\/ flow: /m).slice(1)) {
  const flowName = flow.split("\n")[0].trim();
  const rules = flow
    .split(/^sync /m)
    .slice(1)
    .map((chunk) => {
      const text = chunk.split("```")[0];
      const name = text.split("\n")[0].trim();
      if (ruleNames.has(name)) errors.push(`Duplicate sync name ${name}`);
      ruleNames.add(name);
      const when =
        text.split("when {")[1]?.split(/\n(?:where|then) \{/)[0] || "";
      const then = text.split("then {")[1] || "";
      if (!when || !then) errors.push(`Incomplete sync ${name}`);
      const actions = (value) =>
        [...value.matchAll(/\b(\w+)\/([\w.]+):/g)].map(
          (m) => `${m[1]}/${m[2]}`,
        );
      return {
        name,
        when: actions(when),
        then: actions(then),
        where: text.includes("\nwhere {"),
      };
    });
  if (!sync.includes(`## ${flowName}\n`))
    errors.push(`Missing flow anchor ${flowName}`);
  map += `### ${flowName}\n\n来源：[规则组](${syncFile}#${flowName})；可按下列 sync 名在 SYNCS 定位。\n\n\`\`\`mermaid\nflowchart LR\n`;
  const id = (value) => value.replace(/[^\w]/g, "_");
  for (const rule of rules) {
    map += `  ${rule.name}{"${rule.name}"}\n`;
    for (const action of rule.when)
      map += `  ${id(action)}["${action}"] -->|when| ${rule.name}\n`;
    if (rule.where) {
      map += `  ${rule.name}_where["where：见源规则的过滤与绑定"] -.-> ${rule.name}\n`;
    }
    for (const action of rule.then)
      map += `  ${rule.name} -->|then| ${id(action)}["${action}"]\n`;
  }
  map += "```\n\n";
}
map += `## 边界、覆盖与未决项\n\n`;
map += `- gateway：浏览器协议适配；syncs：协调；shared：类型；app：装配，均不因有目录就成为业务概念。Configuration 是 infrastructure 中独立拥有设置状态的例外。\n`;
map += `- ${ruleNames.size} 个命名同步规则均来自 SYNCS；路由表覆盖 ${routes.size} 个 apply 分支。静态检查验证名称、路由覆盖和本地引用，不验证参数/失败语义或模型适切性。\n`;
map += `- 本次没有创建 PIPELINE；用户范围是概念与同步。网络/构建技术流水线不据此获得新的业务契约。\n`;
map += `- 未发现独立总体 PRD，故不生成产品依赖矩阵；不得从调用或同步边推断产品依赖。README 只作为当前场景用途的出处。\n`;
map += `- 已知限制与修复方向集中在 [SYNCS 的 observed limits](${syncFile}#view-local-composition-and-observed-limits)：跨库部分完成、有限重放窗口、epoch 非原子取消、Export 回调耦合。\n`;

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
const mapFile = path.join(root, "ARCHITECTURE.md");
if (process.argv.includes("--write-map")) fs.writeFileSync(mapFile, map);
else if (!fs.existsSync(mapFile) || fs.readFileSync(mapFile, "utf8") !== map) {
  console.error(
    "ARCHITECTURE.md differs from specifications; run pnpm run specs:map",
  );
  process.exit(1);
}
console.log(
  `Specifications passed: ${specs.length} concepts, ${routes.size} routes, ${ruleNames.size} sync rules; local links/public action names and derived map checked. Behavioral review still required.`,
);
