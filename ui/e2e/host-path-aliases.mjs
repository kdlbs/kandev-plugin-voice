import path from "node:path";
import { createRequire } from "node:module";

const hostRoot = process.env.KANDEV_HOST_ROOT;
if (!hostRoot)
  throw new Error(
    "KANDEV_HOST_ROOT is required by the Voice host smoke runner",
  );

const require = createRequire(import.meta.url);
const Module = require("node:module");
const resolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveHostAlias(
  request,
  parent,
  isMain,
  options,
) {
  if (typeof request === "string" && request.startsWith("@/")) {
    request = path.resolve(hostRoot, "apps/web", request.slice(2));
  }
  return resolveFilename.call(this, request, parent, isMain, options);
};
