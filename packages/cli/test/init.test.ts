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

test("adds **/.lawb to a new .gitignore", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lawb-test-"));
  try {
    const result = await initializeProject({ cwd, profile: "nestjs" });
    assert.equal(result.gitignoreUpdated, true);
    assert.equal(await readFile(join(cwd, ".gitignore"), "utf8"), "**/.lawb\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("appends to an existing .gitignore without touching its content", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lawb-test-"));
  try {
    await writeFile(join(cwd, ".gitignore"), "node_modules/\ndist/", "utf8");
    await initializeProject({ cwd, profile: "nestjs" });
    assert.equal(await readFile(join(cwd, ".gitignore"), "utf8"), "node_modules/\ndist/\n**/.lawb\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("does not duplicate the entry, even across reruns and equivalent spellings", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lawb-test-"));
  try {
    await initializeProject({ cwd, profile: "nestjs" });
    const second = await initializeProject({ cwd, profile: "nestjs", force: true });
    assert.equal(second.gitignoreUpdated, false);
    assert.equal(await readFile(join(cwd, ".gitignore"), "utf8"), "**/.lawb\n");

    for (const existing of [".lawb", ".lawb/", "/.lawb", "**/.lawb/"]) {
      await writeFile(join(cwd, ".gitignore"), `build/\r\n${existing}\r\n`, "utf8");
      assert.equal((await initializeProject({ cwd, profile: "nestjs", force: true })).gitignoreUpdated, false, existing);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("adds the entry even when the config already exists", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lawb-test-"));
  try {
    await initializeProject({ cwd, profile: "nestjs", gitignore: false });
    const second = await initializeProject({ cwd, profile: "nestjs" });
    assert.equal(second.created, false);
    assert.equal(second.gitignoreUpdated, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("leaves .gitignore alone when gitignore is disabled", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lawb-test-"));
  try {
    const result = await initializeProject({ cwd, profile: "nestjs", gitignore: false });
    assert.equal(result.gitignoreUpdated, false);
    await assert.rejects(readFile(join(cwd, ".gitignore"), "utf8"), /ENOENT/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("keeps CRLF line endings when the existing .gitignore uses them", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lawb-test-"));
  try {
    await writeFile(join(cwd, ".gitignore"), "node_modules/\r\ndist/", "utf8");
    await initializeProject({ cwd, profile: "nestjs" });
    assert.equal(await readFile(join(cwd, ".gitignore"), "utf8"), "node_modules/\r\ndist/\r\n**/.lawb\r\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
