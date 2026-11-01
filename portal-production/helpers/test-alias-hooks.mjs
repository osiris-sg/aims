// Resolve hooks for helpers/test-alias.mjs (node:module register).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const EXTS = [".ts", ".tsx", "/index.ts"];
const firstFile = (base) => EXTS.map((e) => new URL(base.href + e)).find((u) => existsSync(fileURLToPath(u)));

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const hit = firstFile(new URL(specifier.slice(2), ROOT));
    if (hit) return next(hit.href, context);
  }
  if (specifier.startsWith(".") && context.parentURL && /\.tsx?$/.test(context.parentURL) && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    const hit = firstFile(new URL(specifier, context.parentURL));
    if (hit) return next(hit.href, context);
  }
  return next(specifier, context);
}
