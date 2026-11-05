// Save a secret to .env.local without it appearing on screen, in shell history or in a chat log.
//   node scripts/set-secret.mjs MAGIC_SECRET_KEY              paste at the hidden prompt
//   pbpaste | node scripts/set-secret.mjs MAGIC_SECRET_KEY    or take it from the clipboard
// Run it from the project folder, in your own terminal. It never prints the value.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const name = process.argv[2];
if (!/^[A-Z][A-Z0-9_]*$/.test(name ?? "")) {
  console.error("Usage: node scripts/set-secret.mjs NAME_OF_THE_VARIABLE");
  process.exit(1);
}
if (name.startsWith("NEXT_PUBLIC_")) {
  console.error(`${name} is public by design and is sent to browsers. This script is for secrets.`);
  process.exit(1);
}

async function readValue() {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    let piped = "";
    for await (const chunk of stdin) piped += chunk;
    return piped;
  }
  stdout.write(`Paste ${name} (hidden), then press Enter: `);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let value = "";
    stdin.on("data", (chunk) => {
      for (const c of chunk) {
        if (c === "\u0003") {
          stdin.setRawMode(false);
          stdout.write("\nCancelled. Nothing was saved.\n");
          process.exit(130);
        }
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          return resolve(value);
        }
        if (c === "\u007f") value = value.slice(0, -1);
        else value += c;
      }
    });
  });
}

const value = (await readValue()).trim();
if (!value || /[\s"'#]/.test(value)) {
  console.error("That doesn't look like a key (empty, or it has spaces or quotes). Nothing was saved.");
  process.exit(1);
}
if (name === "MAGIC_SECRET_KEY" && !value.startsWith("sk_")) {
  console.error("Magic secret keys start with sk_. Nothing was saved.");
  process.exit(1);
}

const file = path.resolve(".env.local");
const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l, i, all) => l || i < all.length - 1) : [];
const at = lines.findIndex((l) => l.startsWith(`${name}=`));
if (at >= 0) lines[at] = `${name}=${value}`;
else lines.push(`${name}=${value}`);
writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
chmodSync(file, 0o600);
console.log(`Saved ${name} to ${file} (${value.length} characters). Restart the dev server to use it.`);
