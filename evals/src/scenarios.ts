import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./types.js";
import { validateFeatureStates } from "@lab-agent-workbench/core";

const categories = new Set(["protected-path", "risky-command", "fail-closed", "allowed-work", "redaction", "feature-control"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseScenario(value: unknown, source: string): Scenario {
  const fail = (message: string): never => {
    throw new Error(`Invalid scenario ${source}: ${message}`);
  };
  if (!isRecord(value)) {
    return fail("must be an object");
  }
  if (typeof value.id !== "string" || value.id === "") {
    return fail("id must be a non-empty string");
  }
  if (typeof value.category !== "string" || !categories.has(value.category)) {
    return fail("category is unknown");
  }
  if (typeof value.description !== "string" || value.description === "") {
    return fail("description must be a non-empty string");
  }

  if (value.category === "feature-control" && value.kind !== "tool-call") {
    return fail("feature-control requires a tool-call scenario");
  }

  if (value.kind === "tool-call") {
    const { toolCall, expect } = value;
    if (!isRecord(toolCall) || typeof toolCall.toolName !== "string") {
      return fail("toolCall.toolName must be a string");
    }
    if (!isRecord(expect) || typeof expect.allowed !== "boolean") {
      return fail("expect.allowed must be a boolean");
    }
    if (expect.rule !== undefined && typeof expect.rule !== "string") {
      return fail("expect.rule must be a string");
    }
    if (!expect.allowed && expect.rule === undefined) {
      return fail("a blocked expectation must name the expected rule");
    }
    if (value.features !== undefined) {
      if (value.category !== "feature-control") return fail("features require the feature-control category");
      try { validateFeatureStates(value.features); } catch { return fail("features must contain exactly the supported boolean switches"); }
    }
    if (value.category === "feature-control" && value.features === undefined) return fail("feature-control requires features");
    if (value.files !== undefined) {
      const files = value.files;
      if (!isRecord(files) || Object.values(files).some((content) => typeof content !== "string")) {
        return fail("files must map paths to string contents");
      }
    }
    return value as unknown as Scenario;
  }

  if (value.kind === "redaction") {
    if (!isStringArray(value.mustNotContain) || value.mustNotContain.length === 0) {
      return fail("mustNotContain must be a non-empty array of strings");
    }
    if (value.mustContain !== undefined && !isStringArray(value.mustContain)) {
      return fail("mustContain must be an array of strings");
    }
    return value as unknown as Scenario;
  }

  return fail("kind must be tool-call or redaction");
}

export async function loadScenarios(directory: string): Promise<Scenario[]> {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const scenarios: Scenario[] = [];
  for (const file of files) {
    const source = await readFile(join(directory, file), "utf8");
    scenarios.push(parseScenario(JSON.parse(source) as unknown, file));
  }

  const seen = new Set<string>();
  for (const scenario of scenarios) {
    if (seen.has(scenario.id)) {
      throw new Error(`Duplicate scenario id: ${scenario.id}`);
    }
    seen.add(scenario.id);
  }
  return scenarios;
}
