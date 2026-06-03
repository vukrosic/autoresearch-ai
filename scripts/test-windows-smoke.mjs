#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "researchloop.js");
const tmp = mkdtempSync(path.join(os.tmpdir(), "autoresearch-windows-smoke-"));

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    const command = `node bin/researchloop.js ${args.join(" ")}`;
    throw new Error(`${command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout;
}

try {
  run(["--help"]);
  run(["init", "--agent", "codex", "--dir", tmp]);
  run(["goal", "--dir", tmp, "windows smoke latency", "--metric", "latency_ms", "--direction", "lower"]);
  run(["infra-doctor", "--dir", tmp, "--format", "json", "--write"]);
  const benchCommand = `${JSON.stringify(process.execPath)} -e "console.log('latency_ms=1.23')"`;
  run([
    "run",
    "--dir", tmp,
    "--id", "windows-node-benchmark",
    "--metric", "latency_ms",
    "--command", benchCommand,
    "--allow-unsafe",
  ]);
  const compare = run(["compare", "--dir", tmp, "--metric", "latency_ms", "--direction", "lower"]);
  if (!compare.includes("windows-node-benchmark")) {
    throw new Error(`compare output did not include run id:\n${compare}`);
  }
  const scaffoldOut = path.join(tmp, "python-benchmark");
  run(["scaffold", "--template", "python-benchmark", "--out", scaffoldOut, "--force"]);
  console.log("windows smoke ok");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
