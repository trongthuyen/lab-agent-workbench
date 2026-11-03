import { constants } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { evaluateReadPath, matchesGlob } from "../policy.js";
import type { WorkbenchConfig } from "../types.js";
import type { SkippedSource, SkipReason, SourceScan } from "./types.js";

/**
 * This reader opens files itself, so nothing the tool_call policy checks applies to it. Every guard is
 * enforced here: workspace confinement on canonical paths, protectedReadPaths, internal exclusions that
 * `context.sources` cannot override, and bounded reads.
 */

/** Any path segment with one of these names is never read; matched case-insensitively. */
const excludedSegments = new Set([
  ".git", "node_modules", ".lawb", "dist", "build", "out", "coverage",
  ".next", ".nuxt", ".turbo", ".cache", ".test-dist"
]);
const excludedFile = /\.(?:jsonl|log|map|lock)$/i;
/** Hard bound on directory entries visited, whatever `maxFilesScanned` says about matching files. */
export const maxWalkEntries = 20000;

export function isInternallyExcluded(relativePath: string): boolean {
  const segments = relativePath.split("/");
  return segments.some((segment) => excludedSegments.has(segment.toLowerCase())) ||
    excludedFile.test(segments.at(-1) ?? "");
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function isOutside(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

function firstMatchingSource(config: WorkbenchConfig, relativePath: string): number {
  return config.context.sources.findIndex((glob) => matchesGlob(glob, relativePath));
}

/** Reads at most `limit` bytes; returns undefined when the file is larger, which is skipped, not truncated. */
async function readBounded(path: string, limit: number): Promise<Buffer | undefined> {
  // O_NOFOLLOW is 0 where unsupported (Windows); the canonical path was already resolved.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return length > limit ? undefined : buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function decode(buffer: Buffer): string | undefined {
  if (buffer.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
}

export interface DiscoverOptions {
  root: string;
  config: WorkbenchConfig;
  signal?: AbortSignal | undefined;
}

/** Walks the workspace in a deterministic order and returns the readable, permitted source files. */
export async function discoverSources(options: DiscoverOptions): Promise<SourceScan> {
  const { config, signal } = options;
  const limits = config.context;
  const rootReal = await realpath(options.root);
  const scan: SourceScan = { files: [], skipped: [], truncated: false, bytesRead: 0 };
  let entries = 0;
  let stopped = false;

  const skip = (path: string, reason: SkipReason): void => {
    scan.skipped.push({ path, reason } satisfies SkippedSource);
  };
  const stop = (): void => {
    scan.truncated = true;
    stopped = true;
  };

  /** All checks that apply to a candidate whose lexical path matched `context.sources`. */
  const readCandidate = async (absolute: string, rel: string, sourceIndex: number): Promise<void> => {
    signal?.throwIfAborted();
    let canonical: string;
    try {
      canonical = await realpath(absolute);
    } catch {
      return skip(rel, "unreadable");
    }
    const canonicalRel = relative(rootReal, canonical);
    if (isOutside(canonicalRel)) return skip(rel, "outside-workspace");
    const canonicalPosix = toPosix(canonicalRel);
    // The lexical name and the real target must both be permitted: an alias must not reach a protected file.
    for (const candidate of canonicalPosix === rel ? [rel] : [rel, canonicalPosix]) {
      if (isInternallyExcluded(candidate) || !evaluateReadPath(candidate, rootReal, config).allowed) {
        return skip(rel, "protected");
      }
    }

    let size: number;
    try {
      const info = await stat(canonical);
      if (!info.isFile()) return;
      size = info.size;
    } catch {
      return skip(rel, "unreadable");
    }
    if (size > limits.maxFileBytes) return skip(rel, "too-large");
    if (scan.files.length >= limits.maxFilesScanned || scan.bytesRead + size > limits.maxBytesScanned) {
      skip(rel, "scan-limit");
      return stop();
    }

    let buffer: Buffer | undefined;
    try {
      buffer = await readBounded(canonical, limits.maxFileBytes);
    } catch {
      return skip(rel, "unreadable");
    }
    if (!buffer) return skip(rel, "too-large");
    const text = decode(buffer);
    if (text === undefined) return skip(rel, "binary");
    scan.bytesRead += buffer.length;
    scan.files.push({ path: rel, text, bytes: buffer.length, sourceIndex });
  };

  const walk = async (directory: string, prefix: string): Promise<void> => {
    const children = (await readdir(directory, { withFileTypes: true }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const child of children) {
      if (stopped) return;
      signal?.throwIfAborted();
      entries += 1;
      if (entries > maxWalkEntries) return stop();

      const rel = prefix === "" ? child.name : `${prefix}/${child.name}`;
      if (isInternallyExcluded(rel)) continue;
      const absolute = join(directory, child.name);

      if (child.isSymbolicLink()) {
        let target;
        try {
          target = await stat(absolute);
        } catch {
          skip(rel, "unreadable");
          continue;
        }
        if (target.isDirectory()) {
          skip(rel, "symlink"); // Never walk through a linked directory.
        } else if (target.isFile()) {
          const index = firstMatchingSource(config, rel);
          if (index !== -1) await readCandidate(absolute, rel, index);
        }
      } else if (child.isDirectory()) {
        // A junction or mount can look like a plain directory; require that the real path is the walked path.
        try {
          if (await realpath(absolute) !== absolute) {
            skip(rel, "symlink");
            continue;
          }
          if ((await lstat(absolute)).isSymbolicLink()) {
            skip(rel, "symlink");
            continue;
          }
        } catch {
          skip(rel, "unreadable");
          continue;
        }
        await walk(absolute, rel);
      } else if (child.isFile()) {
        const index = firstMatchingSource(config, rel);
        if (index !== -1) await readCandidate(absolute, rel, index);
      }
    }
  };

  await walk(rootReal, "");
  return scan;
}
