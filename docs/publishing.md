# Publishing

Three packages are published to the public npm registry under the `@lab-agent-workbench` scope:
`core`, `pi-extension` and `lawb` (the CLI). `pi-extension` and `lawb` depend on `core` at the exact
same version, so all three are released together and `core` is published first.

Always pass `--registry=https://registry.npmjs.org/`. A machine may default to a private registry,
and lockfiles generated against one fail in CI with `E401`.

## Release

```bash
git switch main && git pull
npm ci --registry=https://registry.npmjs.org/
npm run check && npm run build && npm run eval

# bump all three, then update the pinned "@lab-agent-workbench/core" version in cli and pi-extension
npm version <patch|minor> --workspaces --no-git-tag-version

R=https://registry.npmjs.org/
npm publish -w @lab-agent-workbench/core         --registry=$R --tag next
npm publish -w @lab-agent-workbench/pi-extension --registry=$R --tag next
npm publish -w @lab-agent-workbench/lawb         --registry=$R --tag next
```

Build before publishing. npm validates the `bin` entry of `lawb` *before* `prepublishOnly` runs, so
publishing from a clone without `dist/` can ship `lawb` without its command.

Verify from an empty directory, then promote each package to `latest`:

```bash
npx --registry=$R @lab-agent-workbench/lawb@next --help
npm dist-tag add @lab-agent-workbench/core@<version> latest
```

Commit the version bump and tag it (`git tag v<version>`). Published versions cannot be replaced.
