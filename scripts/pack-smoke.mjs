#!/usr/bin/env node
/* global process, console */
// Installs the packed tarballs into an empty directory and exercises them there, outside this repo's
// node_modules. Unit tests cannot catch a runtime import that is missing from "dependencies" (v0.1.3 bug).
// Peers are deliberately not installed (--legacy-peer-deps), matching a Pi package directory.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaces = ["core", "pi-extension", "cli"];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args, cwd) => execFileSync(npm, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });

for (const name of workspaces) {
  if (!existsSync(join(root, "packages", name, "dist"))) {
    throw new Error(`packages/${name}/dist is missing; run \`npm run build\` first`);
  }
}

const work = await mkdtemp(join(tmpdir(), "lawb-pack-smoke-"));
try {
  const tarballs = join(work, "tarballs");
  const install = join(work, "install");
  const project = join(work, "project");
  await Promise.all([tarballs, install, project].map((directory) => mkdir(directory)));

  const files = workspaces.map((name) => {
    const output = run(["pack", "--pack-destination", tarballs, "--json"], join(root, "packages", name));
    return join(tarballs, JSON.parse(output)[0].filename);
  });
  await writeFile(join(install, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module" }));
  run(["install", ...files, "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund"], install);

  // 1. The CLI binary exists and starts.
  const cli = join(install, "node_modules", "@lab-agent-workbench", "lawb", "dist", "cli.js");
  const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  if (!help.includes("lawb init")) throw new Error("lawb --help did not print usage");

  // 2. `lawb init` writes a config that the extension then loads.
  execFileSync(process.execPath, [cli, "init", "--profile", "nestjs", "--no-gitignore"], { cwd: project });

  await mkdir(join(project, "docs"));
  await writeFile(join(project, "docs", "auth.md"), "# Authentication\n\nTokens expire quickly.\n");
  await writeFile(join(project, "docs", "other.md"), "# Other\n\nunrelated\n");
  const inspected = JSON.parse(execFileSync(process.execPath, [cli, "context", "inspect", "--query", "authentication tokens", "--json"], { cwd: project, encoding: "utf8" }));
  if (inspected.selected.length !== 1 || inspected.selected[0].path !== "docs/auth.md") {
    throw new Error("lawb context inspect did not select docs/auth.md");
  }

  // 3. The extension registers /lawb and the real menu opens and applies, using only installed dependencies.
  const entry = join(install, "node_modules", "@lab-agent-workbench", "pi-extension", "dist", "index.js");
  const { default: factory, createLabAgentWorkbench } = await import(pathToFileURL(entry).href);
  const create = createLabAgentWorkbench ?? factory;
  const commands = new Map();
  const appended = [];
  create({ homeDirectory: work })({
    on() {},
    registerCommand: (name, options) => commands.set(name, options),
    appendEntry: (type, data) => appended.push({ type, data })
  });
  const lawb = commands.get("lawb");
  if (!lawb) throw new Error("/lawb was not registered");

  const notices = [];
  const theme = new Proxy({}, { get: () => (...args) => String(args.at(-1)) });
  await lawb.handler("", {
    cwd: project,
    mode: "tui",
    hasUI: true,
    isIdle: () => true,
    sessionManager: { getBranch: () => [] },
    ui: {
      notify: (message, level) => notices.push({ message, level }),
      confirm: async () => true,
      setStatus() {},
      custom: (build) => new Promise((done) => {
        const menu = build({ requestRender() {} }, theme, {}, done);
        menu.render(80);
        menu.handleInput("\r"); // toggle the first switch
        menu.handleInput("\x13"); // Ctrl+S applies
      })
    }
  });
  const applied = notices.find(({ message }) => message.startsWith("LAWb features applied"));
  if (!applied || appended.length !== 1) {
    throw new Error(`/lawb did not apply features: ${JSON.stringify(notices)}`);
  }
  console.log("pack smoke test passed");
} finally {
  await rm(work, { recursive: true, force: true });
}
