// Loaded before scripts/worker.ts (pnpm worker). Server modules import "server-only", which
// throws outside a React Server Components bundle. Stub just that package. The broader
// --conditions=react-server flag would also swap react for its server build, which has no
// createContext, and break lucide-react (used by the icon check): measured on 5 Nov 2026.
const Module = require("node:module");
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "server-only") return {};
  return load.call(this, request, ...rest);
};
