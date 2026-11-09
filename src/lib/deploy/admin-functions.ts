import { getAddress, isAddress, isHex, type Abi, type AbiFunction, type AbiParameter } from "viem";

/** A function that probably only the owner or an admin may call, chosen from the contract's own ABI. */
export interface AdminFunction {
  name: string;
  /** Plain words for the button, e.g. "Pause the app". */
  label: string;
  abi: AbiFunction;
  /** False when an input is a shape the form can't take (arrays, structs). Listed, not callable here. */
  supported: boolean;
  /** Why it isn't callable here, in plain words. */
  reason?: string;
  /** Moves funds or hands over control, so the confirm step says so. */
  sensitive: boolean;
}

/**
 * The ABI can't show which modifier guards a function, so this goes by name (like exit-functions.ts).
 * Everything found is shown as "may need the owner", and every call is simulated before the wallet
 * is asked, so the chain decides who is allowed.
 */
const ADMIN_NAME =
  /^(set|update|change|add|remove|pause|unpause|transferOwnership|renounceOwnership|grantRole|revokeRole|mint|withdraw|rescue|sweep|recover|upgrade|enable|disable|open|close|cancel|finali[sz]e|configure|blacklist|whitelist|ban|unban|freeze|unfreeze|emergency|reset|collect|distribute|release|settle|resolve|declare|lock|unlock|start|end)/i;
const SENSITIVE = /^(transferOwnership|renounceOwnership|grantRole|revokeRole|withdraw|rescue|sweep|recover|upgrade|emergency|distribute|release|mint)/i;
const SIMPLE = /^(address|bool|string|bytes\d{0,2}|u?int\d{0,3})$/;

const LABELS: Record<string, string> = {
  pause: "Pause the app",
  unpause: "Resume the app",
  transferOwnership: "Hand over ownership",
  renounceOwnership: "Give up ownership for good",
  grantRole: "Give someone a role",
  revokeRole: "Take a role away",
  mint: "Create new tokens",
};

/** "setFeeRate" -> "Set fee rate". Falls back to this for names without a hand-written label. */
export function plainLabel(name: string): string {
  if (LABELS[name]) return LABELS[name];
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function adminFunctions(abi: Abi): AdminFunction[] {
  const out: AdminFunction[] = [];
  for (const item of abi) {
    if (item.type !== "function" || item.stateMutability !== "nonpayable" || !ADMIN_NAME.test(item.name)) continue;
    const bad = item.inputs.find((i) => !SIMPLE.test(i.type));
    out.push({
      name: item.name,
      label: plainLabel(item.name),
      abi: item,
      supported: !bad,
      reason: bad ? "Needs a kind of input this page can't take. Use the block explorer." : undefined,
      sensitive: SENSITIVE.test(item.name),
    });
  }
  return out;
}

export type ParsedArg = { ok: true; value: unknown } | { ok: false; error: string };

/** Text typed in a field to the value the contract takes. Strict: a typo is an error, never a guess. */
export function parseArg(param: Pick<AbiParameter, "type">, raw: string): ParsedArg {
  const text = raw.trim();
  const type = param.type;
  if (type === "address") return isAddress(text, { strict: false }) ? { ok: true, value: getAddress(text.toLowerCase()) } : { ok: false, error: "That is not a wallet address." };
  if (type === "bool") return text === "true" || text === "false" ? { ok: true, value: text === "true" } : { ok: false, error: "Choose yes or no." };
  if (type === "string") return { ok: true, value: raw };
  const int = /^(u?)int(\d{0,3})$/.exec(type);
  if (int) {
    const unsigned = int[1] === "u";
    const bits = int[2] ? Number(int[2]) : 256;
    if (!(unsigned ? /^\d+$/ : /^-?\d+$/).test(text)) return { ok: false, error: "Use a whole number, with no commas or decimals." };
    const n = BigInt(text);
    const limit = BigInt(1) << BigInt(unsigned ? bits : bits - 1);
    const ok = unsigned ? n < limit : n >= -limit && n < limit;
    return ok ? { ok: true, value: n } : { ok: false, error: "That number is too large for this field." };
  }
  const bytes = /^bytes(\d{0,2})$/.exec(type);
  if (bytes) {
    if (!isHex(text) || text.length % 2 !== 0) return { ok: false, error: "Use 0x followed by hex characters." };
    if (bytes[1] && text.length !== 2 + Number(bytes[1]) * 2) return { ok: false, error: `Needs exactly ${bytes[1]} bytes.` };
    return { ok: true, value: text };
  }
  return { ok: false, error: "This kind of input isn't supported here." };
}

/** Parse every input of a function. Returns the args, or the first problem with the field it belongs to. */
export function parseArgs(fn: AbiFunction, raws: string[]): { ok: true; args: unknown[] } | { ok: false; index: number; error: string } {
  const args: unknown[] = [];
  for (let i = 0; i < fn.inputs.length; i++) {
    const parsed = parseArg(fn.inputs[i], raws[i] ?? "");
    if (!parsed.ok) return { ok: false, index: i, error: parsed.error };
    args.push(parsed.value);
  }
  return { ok: true, args };
}
