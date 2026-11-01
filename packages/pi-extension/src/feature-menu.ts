import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, SettingsList, Text, type Component, type SettingItem } from "@earendil-works/pi-tui";
import { disabledGuardrails, featureCatalog, type FeatureStates } from "@lab-agent-workbench/core";

/** Draft-only: neither the switches nor the backing config change until the caller accepts Apply. */
export function createFeatureMenu(
  initial: FeatureStates,
  theme: Theme,
  requestRender: () => void,
  done: (result: FeatureStates | undefined) => void
): Component {
  const draft = { ...initial };
  const container = new Container();
  const heading = new Text("", 1, 0);
  const scope = new Text("Scope: this Pi session / active branch. Project config is unchanged.", 1, 0);
  const warning = new Text("", 1, 0);
  const footer = new Text("", 1, 0);
  const refresh = () => {
    heading.setText(theme.fg("accent", theme.bold("LAWb / Feature controls")));
    const off = disabledGuardrails(draft);
    warning.setText(off.length === 0
      ? theme.fg("muted", "Guardrails enabled (configured rules still apply; not a sandbox).")
      : theme.fg("warning", `Guardrails OFF: ${off.join(", ")}`));
    const changed = featureCatalog.some(({ id }) => draft[id] !== initial[id]);
    footer.setText(theme.fg("dim", `${changed ? "Unsaved changes" : "No changes"} | Up/Down select | Enter/Space toggle | Ctrl+S apply | Esc cancel`));
  };
  const items: SettingItem[] = featureCatalog.map((feature) => ({
    id: feature.id,
    label: feature.label,
    description: feature.description,
    currentValue: draft[feature.id] ? "on" : "off",
    values: ["on", "off"]
  }));
  const settings = new SettingsList(items, 6, {
    label: (text, selected) => theme.fg(selected ? "accent" : "text", text),
    value: (text) => theme.fg(text === "on" ? "success" : "warning", text),
    description: (text) => theme.fg("muted", text),
    cursor: theme.fg("accent", "> "),
    hint: (text) => theme.fg("dim", text)
  }, (id, value) => {
    const feature = featureCatalog.find((item) => item.id === id);
    if (feature) draft[feature.id] = value === "on";
    refresh();
  }, () => done(undefined));
  container.addChild(heading);
  container.addChild(scope);
  container.addChild(settings);
  container.addChild(warning);
  container.addChild(new Text("Quality gates: run lawb gates in your terminal. CLI behavior is not changed here.", 1, 0));
  container.addChild(footer);
  refresh();
  return {
    render: (width) => container.render(width),
    invalidate: () => { container.invalidate(); refresh(); },
    handleInput: (data) => {
      if (matchesKey(data, "ctrl+s")) done({ ...draft });
      else if (matchesKey(data, "ctrl+c")) done(undefined);
      else settings.handleInput(data);
      requestRender();
    }
  };
}

export function showFeatureMenu(ctx: ExtensionCommandContext, state: FeatureStates): Promise<FeatureStates | undefined> {
  return ctx.ui.custom<FeatureStates | undefined>((tui, theme, _keybindings, done) =>
    createFeatureMenu(state, theme, () => tui.requestRender(), done));
}
