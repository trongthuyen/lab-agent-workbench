import type { ConfigLayer } from "./types.js";

export const profiles: Readonly<Record<string, ConfigLayer>> = {
  base: {},
  nestjs: {
    profile: "nestjs",
    qualityGates: {
      commands: [
        "npm run lint",
        "npm run typecheck",
        "npm test"
      ]
    }
  }
};

export function getProfile(name: string): ConfigLayer {
  const profile = profiles[name];
  if (!profile) {
    throw new Error(`Unknown profile: ${name}. Available profiles: ${Object.keys(profiles).join(", ")}`);
  }
  return structuredClone(profile);
}
