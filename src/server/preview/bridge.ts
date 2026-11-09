import { moduleStarts } from "@/server/publish/build";

/**
 * The script every own-build preview loads first (D69). It tells the workspace, by postMessage to
 * the page that frames it, that the app is up and what goes wrong in it, with the project file an
 * error came from. It reads nothing from the page and takes no instructions.
 *
 * The file is found the same way the run check finds it: the first stack frame inside one of the
 * project's own modules. The table of where each module starts is worked out at build time and
 * written into the script.
 */
export function previewBridge(js: string, jsName: string): string {
  // [line, file] pairs; consecutive package modules collapse into one "" entry.
  const table: Array<[number, string]> = [];
  for (const s of moduleStarts(js)) {
    if (table.length && table[table.length - 1][1] === s.file) continue;
    table.push([s.line, s.file]);
  }
  return `(function () {
  var MODULES = ${JSON.stringify(table)};
  var BUNDLE = ${JSON.stringify(jsName)};
  var seen = {};
  function send(message) {
    try {
      message.gb = "preview";
      window.parent.postMessage(message, "*");
    } catch (e) {}
  }
  function fileOf(stack) {
    var re = new RegExp(BUNDLE.replace(/[.*+?^$()|[\\]\\\\{}]/g, "\\\\$&") + ":(\\\\d+):\\\\d+", "g");
    var m;
    while ((m = re.exec(stack))) {
      var line = Number(m[1]);
      var owner = "";
      for (var i = 0; i < MODULES.length && MODULES[i][0] <= line; i++) owner = MODULES[i][1];
      if (owner) return owner;
    }
    return undefined;
  }
  function report(title, message, stack) {
    title = String(title || "Error").slice(0, 200);
    message = String(message || "").slice(0, 1500);
    if (seen[title + message]) return;
    seen[title + message] = true;
    send({ type: "error", title: title, message: message, path: fileOf(String(stack || "")) });
  }
  window.addEventListener("error", function (e) {
    if (!e.error && !e.message) return; // a failed <img> or <script>, not a thrown error
    report(e.error && e.error.name, e.message || String(e.error), e.error && e.error.stack);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    report((r && r.name) || "Unhandled promise rejection", (r && r.message) || String(r), r && r.stack);
  });
  window.addEventListener("load", function () {
    // After the app's first render.
    setTimeout(function () {
      var root = document.getElementById("root");
      send({ type: "ready", empty: !root || root.childElementCount === 0 });
    }, 80);
  });
})();
`;
}
