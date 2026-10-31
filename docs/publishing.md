# Publishing

Three packages are published to the public npm registry under the `@lab-agent-workbench` scope:
`core`, `pi-extension` and `lawb` (the CLI). `pi-extension` and `lawb` depend on `core` at the exact
same version, so all three are released together and `core` is published first.

Always pass `--registry=https://registry.npmjs.org/`. A machine may default to a private registry,
and lockfiles generated against one fail in CI with `E401`.

## Release

Packages are published only from a clean, merged `main`, all three together and `core` first.

```bash
git switch main && git pull
npm ci --registry=https://registry.npmjs.org/
npm run check && npm run build && npm run eval
npm run bench -- validate                  # optional: verifiers only, no model calls

# Versions: bump the three packages, then pin the new core version in cli and pi-extension
npm version <patch|minor> -w @lab-agent-workbench/core -w @lab-agent-workbench/pi-extension -w @lab-agent-workbench/lawb --no-git-tag-version
# edit "@lab-agent-workbench/core" in packages/cli and packages/pi-extension to the same version
# (the private evals package depends on core as "*", so it follows the workspace; an exact pin there makes npm
#  install the old core from the registry next to it and the evaluations silently run the old policy)
npm install --package-lock-only --registry=https://registry.npmjs.org/
```

Move the CHANGELOG entry from "unreleased" to the release date, merge that change, then publish. npm asks for
a one-time code for each command, so run them one at a time:

```bash
R=https://registry.npmjs.org/
npm publish -w @lab-agent-workbench/core         --registry=$R
npm publish -w @lab-agent-workbench/pi-extension --registry=$R
npm publish -w @lab-agent-workbench/lawb         --registry=$R
```

Build before publishing. npm validates the `bin` entry of `lawb` *before* `prepublishOnly` runs, so
publishing from a clone without `dist/` can ship `lawb` without its command.

`npm view` can return 404 for a few minutes after a publish while the registry catches up. Wait before
concluding it failed. The registry may also show a `0.0.0-stage` placeholder version next to each release
(from staged publishing); it is harmless and `latest` points at the real version.

### Verify

From an empty directory:

```bash
npx --registry=$R @lab-agent-workbench/lawb@<version> --help
npm dist-tag ls @lab-agent-workbench/lawb       # latest should be the new version
pi install npm:@lab-agent-workbench/pi-extension
pi list
```

Then tag the published commit (npm records it as `gitHead`): `git tag -a v<version> <gitHead> && git push origin v<version>`.
Published versions cannot be replaced; fix forward with a new patch version.
