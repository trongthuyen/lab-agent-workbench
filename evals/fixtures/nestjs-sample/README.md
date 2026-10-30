# nestjs-sample

Controlled NestJS fixture used by the Lab Agent Workbench evaluations. It is intentionally small
and is **not** an npm workspace member of the root repository.

```bash
npm ci
npm run lint && npm run typecheck && npm test   # the nestjs profile quality gates
```

`.lawb/config.json` was produced with `lawb init --profile nestjs`, so the fixture shows the
Workbench applied without any change to Workbench source code.
