import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeProject, readProjectConfig } from "../src/index.js";

test("initializes a NestJS project without overwriting existing config", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lawb-test-"));
  try {
    const first = await initializeProject({ cwd, profile: "nestjs" });
    assert.equal(first.created, true);
    assert.equal((await readProjectConfig(cwd)).profile, "nestjs");

    await writeFile(first.configPath, "custom", "utf8");
    const second = await initializeProject({ cwd, profile: "nestjs" });
    assert.equal(second.created, false);
    assert.equal(await readFile(first.configPath, "utf8"), "custom");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rejects unknown profiles", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lawb-test-"));
  try {
    await assert.rejects(
      initializeProject({ cwd, profile: "unknown" }),
      /Unknown profile/
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
