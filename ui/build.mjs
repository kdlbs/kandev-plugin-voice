// Builds the two artifacts kandev serves out of the installed package:
//
//   ui/bundle.js         the ES module kandev imports at
//                        /api/plugins/kandev-plugin-voice/bundle
//   ui/whisper-worker.js the in-browser Whisper worker, fetched at
//                        /api/plugins/kandev-plugin-voice/ui/ui/whisper-worker.js
//                        (the /ui/* route serves package-relative paths, hence
//                        the doubled segment)
//
// Contract requirements (docs/plans/plugins/PLUGIN-API.md):
// - NO bundled React: every `react` import is aliased to src/react-shim.ts,
//   which delegates to host.React. Nothing may touch React at module scope,
//   because the bundle is evaluated before `initialize` hands us the host --
//   that is why the icons are inlined rather than imported from a library
//   that builds its components with forwardRef at import time.
// - The automatic JSX runtime resolves through the same shim.
//
// The worker is the opposite case: it runs off the main thread with no host
// object at all, so transformers.js *is* bundled into it.
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => path.join(here, "src", p);

const shared = {
  bundle: true,
  format: "esm",
  target: "es2022",
  logLevel: "info",
};

await esbuild.build({
  ...shared,
  entryPoints: [src("index.tsx")],
  outfile: path.join(here, "bundle.js"),
  // Automatic runtime: esbuild emits imports from "react/jsx-runtime",
  // which the alias below points at our host-delegating shim.
  jsx: "automatic",
  alias: {
    react: src("react-shim.ts"),
    "react/jsx-runtime": src("react-shim.ts"),
  },
});

await esbuild.build({
  ...shared,
  entryPoints: [src("whisper-worker.ts")],
  outfile: path.join(here, "whisper-worker.js"),
  // transformers.js resolves onnxruntime-node when it thinks it is on a
  // server. Force the browser condition so only onnxruntime-web is pulled in.
  platform: "browser",
  minify: true,
});
