import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, "..");
const version = JSON.parse(
  fs.readFileSync(path.join(root, "package.json")),
).version;
const filename = `youtube-scaffold-v${version}.zip`,
  output = path.join(root, "dist", filename);
if (fs.existsSync(output)) fs.unlinkSync(output);
const result = spawnSync("zip", ["-X", "-q", "-r", output, "."], {
  cwd: path.join(root, "dist/extension"),
  stdio: "inherit",
});
if (result.status) process.exit(result.status);
const sha256 = createHash("sha256")
  .update(fs.readFileSync(output))
  .digest("hex");
fs.writeFileSync(
  path.join(root, "dist", filename + ".sha256"),
  `${sha256}  ${filename}\n`,
);
console.log(`Created ${output}\nSHA-256: ${sha256}`);
