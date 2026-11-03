import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  defaultConfig,
  getProfile,
  loadProjectConfig,
  resolveConfig,
  resolveProjectConfig,
  type ConfigLayer
} from "../src/index.js";

async function project(config: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lawb-loader-"));
  if (config !== undefined) {
    await mkdir(join(root, ".lawb"));
    await writeFile(join(root, ".lawb", "config.json"), typeof config === "string" ? config : JSON.stringify(config));
  }
  return root;
}

test("a project without config uses the defaults and is reported as defaulted", async () => {
  const root = await project(undefined);
  try {
    const loaded = await loadProjectConfig(root);
    assert.equal(loaded.defaulted, true);
    assert.deepEqual(loaded.config, resolveConfig());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("precedence is base, then the named profile, then the project file", () => {
  const config = resolveProjectConfig({
    profile: "nestjs",
    telemetry: { enabled: false },
    qualityGates: { commands: ["make verify"] }
  });
  assert.equal(config.profile, "nestjs");
  assert.equal(config.telemetry.enabled, false);
  assert.deepEqual(config.qualityGates.commands, ["make verify"]);
  assert.deepEqual(config.policies, defaultConfig.policies);

  // The profile fills what the project file leaves out.
  const partial = resolveProjectConfig({ profile: "nestjs" });
  assert.deepEqual(partial.qualityGates.commands, getProfile("nestjs").qualityGates?.commands);
});

test("an unknown profile name adds no layer and does not reject the file", () => {
  for (const name of ["acme-internal", "__proto__", "constructor", "toString"]) {
    const config = resolveProjectConfig({ profile: name } as ConfigLayer);
    assert.equal(config.profile, name);
    assert.deepEqual(config.qualityGates.commands, []);
  }
});

test("invalid project layers still fail closed", () => {
  assert.throws(() => resolveProjectConfig(null as never), /Configuration must be an object/);
  assert.throws(() => resolveProjectConfig([] as never), /Configuration must be an object/);
  assert.throws(() => resolveProjectConfig({ version: 2 } as never), /version must be 1/);
  assert.throws(() => resolveProjectConfig({ context: { enabled: 1 } } as never), /context\.enabled/);
});

test("a config written by v0.1.3 lawb init resolves with identical policy, gates and telemetry", async () => {
  const source = await readFile(new URL("../../test/fixtures/legacy-v0.1.3-nestjs.config.json", import.meta.url), "utf8");
  const legacy = JSON.parse(source) as Record<string, unknown>;
  assert.equal("context" in legacy, false, "the golden fixture must stay in the old format");

  const root = await project(source);
  try {
    const { config, defaulted } = await loadProjectConfig(root);
    assert.equal(defaulted, false);
    assert.deepEqual(config.policies, legacy.policies);
    assert.deepEqual(config.telemetry, legacy.telemetry);
    assert.deepEqual(config.qualityGates, legacy.qualityGates);
    assert.equal(config.profile, legacy.profile);
    assert.deepEqual(config.context, defaultConfig.context);
    assert.equal(config.context.enabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed JSON propagates so callers can fail closed", async () => {
  const root = await project("{ not json");
  try {
    await assert.rejects(loadProjectConfig(root), SyntaxError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
