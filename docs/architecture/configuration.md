# Configuration contract

Status: v0.1 draft

## Location

Project configuration is stored at `.lawb/config.json`.

## Precedence

Configuration layers are applied in this order:

1. Base defaults
2. Technology profile
3. Project override
4. Session override

Later layers take precedence. Objects merge recursively. Arrays and scalar values are replaced as a whole; arrays are never appended implicitly.

## Validation

- The only supported schema version is `1`.
- Unknown keys are rejected.
- Required fields must be present after resolution.
- Command and redaction patterns must compile as regular expressions.
- Invalid configuration fails closed in the Pi `tool_call` policy boundary.

## Schema

```json
{
  "version": 1,
  "profile": "nestjs",
  "policies": {
    "allowOutsideWorkspace": false,
    "protectedPaths": [".git", ".git/**", ".env", ".env.*"],
    "riskyCommandPatterns": []
  },
  "telemetry": {
    "enabled": true,
    "path": ".lawb/runs/telemetry.jsonl",
    "redactPatterns": []
  },
  "qualityGates": {
    "commands": ["npm run lint", "npm run typecheck", "npm test"]
  }
}
```

The example omits the built-in regular-expression values for readability. `lawb init --profile nestjs` writes the complete resolved configuration.

## Migration policy

A future incompatible schema must increment `version` and provide an explicit migration command. The runtime must not silently reinterpret an unsupported version.
