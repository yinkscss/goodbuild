#!/usr/bin/env node
// Saves your GoodCash test keys into .env.local (git-ignored). Run: node scripts/set-goodcash-keys.mjs
// Typing is hidden and nothing is printed back. Press Enter to skip the secret key (it is optional).
import fs from "node:fs";
import readline from "node:readline";

const FILE = ".env.local";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let hide = false;
rl._writeToOutput = (s) => {
  if (!hide) process.stdout.write(s);
};
const lines = rl[Symbol.asyncIterator]();
async function ask(question) {
  process.stdout.write(question);
  hide = true;
  const { value } = await lines.next();
  hide = false;
  process.stdout.write("\n");
  return (value ?? "").trim();
}

const pk = await ask("Test publishable key (gc_pk_test_...): ");
if (!/^gc_pk_test_[A-Za-z0-9_-]+$/.test(pk)) {
  console.error("That is not a test publishable key (it should start with gc_pk_test_). Nothing was saved.");
  rl.close();
  process.exit(1);
}
const sk = await ask("Test secret key (gc_sk_test_..., Enter to skip): ");
if (sk && !/^gc_sk_test_[A-Za-z0-9_-]+$/.test(sk)) {
  console.error("That is not a test secret key (it should start with gc_sk_test_). Nothing was saved.");
  rl.close();
  process.exit(1);
}

rl.close();
let text = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "";
function put(name, value) {
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  text = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
}
put("GOODCASH_PUBLISHABLE_KEY", pk);
if (sk) put("GOODCASH_SECRET_KEY", sk);
fs.writeFileSync(FILE, text, { mode: 0o600 });
console.log(`Saved to ${FILE}: GOODCASH_PUBLISHABLE_KEY${sk ? " and GOODCASH_SECRET_KEY" : ""}. Restart pnpm dev, then tell Claude the keys are in.`);
