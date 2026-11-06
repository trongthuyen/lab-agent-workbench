import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  defaultFeatureStates,
  disabledGuardrails,
  featureCatalog,
  featureStateVersion,
  migrateLegacyFeatureStates,
  resolveConfig,
  resolveFeatureConfig,
  validateFeatureStates,
  type FeatureStates,
  type WorkbenchConfig
} from "@lab-agent-workbench/core";

import type { showFeatureMenu as showMenuType } from "./feature-menu.js";

export const featureStateEntry = "lawb-features";

interface SavedState {
  version: number;
  cwd: string;
  features: FeatureStates;
}

/** Only this user command changes state. There is deliberately no model-callable toggle tool. */
export function registerFeatureControls(
  pi: ExtensionAPI,
  baseConfigFor: (cwd: string) => Promise<WorkbenchConfig>,
  clearRuntime: () => void
): (cwd: string) => Promise<WorkbenchConfig> {
  const overrides = new Map<string, FeatureStates>();
  const effective = new Map<string, WorkbenchConfig>();
  const keyFor = (cwd: string) => resolve(cwd);
  const emptyDefaults = resolveConfig();
  const stateFor = async (cwd: string) => overrides.get(keyFor(cwd)) ?? defaultFeatureStates(await baseConfigFor(cwd));
  const configFor = async (cwd: string): Promise<WorkbenchConfig> => {
    const key = keyFor(cwd);
    const cached = effective.get(key);
    if (cached) return cached;
    const base = await baseConfigFor(cwd);
    const override = overrides.get(key);
    const config = override ? resolveFeatureConfig(base, override) : base;
    effective.set(key, config);
    return config;
  };
  const updateStatus = (ctx: ExtensionContext, state: FeatureStates) => {
    if (!ctx.hasUI) return;
    // Experimental features are shown separately so the default "4/4" still means every stable feature is on.
    const stable = featureCatalog.filter(({ experimental }) => !experimental);
    const enabled = stable.filter(({ id }) => state[id]).length;
    const off = disabledGuardrails(state);
    ctx.ui.setStatus("lawb", `LAWb ${enabled}/${stable.length}${off.length > 0 ? " | WARNING: guards off" : ""}${state.contextInjection ? " | context" : ""}`);
  };
  const clear = () => {
    overrides.clear();
    effective.clear();
    clearRuntime();
  };
  const restore = async (_event: unknown, ctx: ExtensionContext) => {
    clear();
    // Only the newest matching entry on the active branch is authoritative, even if malformed.
    const saved = ctx.sessionManager.getBranch().filter((entry) =>
      entry.type === "custom" && entry.customType === featureStateEntry).at(-1);
    if (saved?.type === "custom") {
      let restored: FeatureStates | undefined;
      let legacyRecord: unknown;
      try {
        const data = saved.data as SavedState | undefined;
        if (!data || typeof data.cwd !== "string" || (data.version !== 1 && data.version !== featureStateVersion)) {
          throw new Error("Invalid state");
        }
        if (keyFor(data.cwd) === keyFor(ctx.cwd)) {
          if (data.version === 1) {
            // Check the four-switch shape now; the project default for context injection completes it below.
            migrateLegacyFeatureStates(data.features, defaultFeatureStates(emptyDefaults));
            legacyRecord = data.features;
          } else {
            restored = validateFeatureStates(data.features);
          }
        }
      } catch {
        if (ctx.hasUI) ctx.ui.notify("Invalid LAWb feature state ignored; using project defaults.", "warning");
      }
      if (legacyRecord !== undefined) {
        restored = migrateLegacyFeatureStates(legacyRecord, defaultFeatureStates(await baseConfigFor(ctx.cwd)));
      }
      if (restored) overrides.set(keyFor(ctx.cwd), restored);
    }
    // Still load and validate project config when restoring an all-off state.
    const state = await stateFor(ctx.cwd);
    await configFor(ctx.cwd);
    updateStatus(ctx, state);
    if (ctx.hasUI && disabledGuardrails(state).length > 0) {
      ctx.ui.notify(`LAWb guardrails disabled in this branch: ${disabledGuardrails(state).join(", ")}. Use /lawb to re-enable.`, "warning");
    }
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("session_shutdown", async (_event, ctx) => {
    clear();
    if (ctx.hasUI) ctx.ui.setStatus("lawb", undefined);
  });

  pi.registerCommand("lawb", {
    description: "Enable or disable LAWb features for this Pi session (active branch)",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("/lawb feature controls require interactive TUI mode.", "warning");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the agent to finish before changing LAWb features.", "warning");
        return;
      }
      try {
        const current = await stateFor(ctx.cwd);
        await configFor(ctx.cwd);
        let showFeatureMenu: typeof showMenuType;
        try {
          ({ showFeatureMenu } = await import("./feature-menu.js"));
        } catch {
          // Typically a missing @earendil-works/pi-tui in the install; say so instead of blaming config.
          ctx.ui.notify("LAWb feature menu could not load its UI dependency (@earendil-works/pi-tui). Reinstall the extension, then /reload.", "error");
          return;
        }
        const selection = await showFeatureMenu(ctx, current);
        if (!selection) return;
        const next = validateFeatureStates(selection);
        if (featureCatalog.every(({ id }) => current[id] === next[id])) return;
        const disabling = featureCatalog.filter((feature) => feature.guardrail && current[feature.id] && !next[feature.id]);
        if (disabling.length > 0 && !await ctx.ui.confirm(
          "Disable LAWb guardrails?",
          `${disabling.map((feature) => feature.label).join(", ")} will be OFF in this session branch. ` +
          "Affected tool calls may read secrets, modify protected files, or execute destructive commands. " +
          "This persists on resume/reload until you re-enable it. Apply changes?"
        )) return;
        if (!ctx.isIdle()) {
          ctx.ui.notify("Agent became active; changes were not applied. Open /lawb again when idle.", "warning");
          return;
        }
        // Verify the prospective config before writing the session entry or mutating live switches.
        const config = resolveFeatureConfig(await baseConfigFor(ctx.cwd), next);
        try {
          pi.appendEntry<SavedState>(featureStateEntry, { version: featureStateVersion, cwd: keyFor(ctx.cwd), features: next });
        } catch {
          // Native SessionManager may update its in-memory branch before a disk write fails.
          // Append the previous state as compensation so a later reload cannot activate the draft.
          try {
            pi.appendEntry<SavedState>(featureStateEntry, { version: featureStateVersion, cwd: keyFor(ctx.cwd), features: current });
          } catch { /* A storage failure may persist; keep the current live switches unchanged. */ }
          throw new Error("Could not save LAWb feature state");
        }
        overrides.set(keyFor(ctx.cwd), next);
        effective.set(keyFor(ctx.cwd), config);
        updateStatus(ctx, next);
        const sends = next.contextInjection && !current.contextInjection
          ? " Context injection now sends excerpts of matching project docs to the model." : "";
        ctx.ui.notify(`LAWb features applied to this session branch. Project config unchanged.${sends}`, disabling.length > 0 ? "warning" : "info");
      } catch {
        // Do not echo arbitrary config/session contents or filesystem error messages into the UI.
        ctx.ui.notify("LAWb features were not applied. Check project configuration and session storage, then /reload.", "error");
      }
    }
  });
  return configFor;
}
