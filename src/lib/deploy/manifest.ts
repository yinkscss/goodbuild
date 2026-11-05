import { getAddress, isAddress, isHex, type Abi, type AbiParameter, type Address } from "viem";
import { z } from "zod";

/**
 * Deploy manifest (D23): the agent writes `contracts/deploy.json` listing which contracts to
 * deploy and their constructor arguments. GoodBuild sorts it topologically, deploys one contract
 * per wallet signature, and fills references with real addresses as it goes.
 *
 *   { "contracts": [
 *     { "name": "RTXToken", "args": {} },
 *     { "name": "RTXPool",  "args": { "gd_": "${GOODDOLLAR}", "rtx_": "${RTXToken.address}" } } ] }
 *
 * References: `${Name.address}` (a contract in this manifest), `${GOODDOLLAR}` (G$ on the target
 * chain) and `${DEPLOYER}` (the signing wallet). Everything else is a literal.
 */

export const MANIFEST_PATH = "contracts/deploy.json";

export type ArgValue = string | number | boolean | ArgValue[] | { [key: string]: ArgValue };

const argValue: z.ZodType<ArgValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.array(argValue), z.record(z.string(), argValue)]),
);

export const manifestSchema = z.object({
  contracts: z
    .array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), args: z.record(z.string(), argValue).default({}) }))
    .min(1)
    .max(12),
});
export type DeployManifest = z.infer<typeof manifestSchema>;

export interface ManifestIssue {
  message: string;
}

export type ParseResult = { ok: true; manifest: DeployManifest } | { ok: false; issues: ManifestIssue[] };

export function parseManifest(source: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (e) {
    return { ok: false, issues: [{ message: `${MANIFEST_PATH} is not valid JSON: ${(e as Error).message}` }] };
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ message: `${MANIFEST_PATH}: ${i.path.join(".") || "root"}: ${i.message}` })),
    };
  }
  return { ok: true, manifest: parsed.data };
}

const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:\.(address))?\}/g;
const WHOLE_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?:\.(address))?\}$/;

export type Reference = { kind: "contract"; name: string } | { kind: "gooddollar" } | { kind: "deployer" };

/** Every reference inside an argument value. */
export function referencesIn(value: ArgValue): Array<{ raw: string; ref: Reference | null }> {
  if (typeof value === "string") {
    return [...value.matchAll(REF)].map((m) => ({ raw: m[0], ref: toReference(m[1], m[2]) }));
  }
  if (Array.isArray(value)) return value.flatMap(referencesIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(referencesIn);
  return [];
}

function toReference(name: string, member: string | undefined): Reference | null {
  if (!member && name === "GOODDOLLAR") return { kind: "gooddollar" };
  if (!member && name === "DEPLOYER") return { kind: "deployer" };
  if (member === "address") return { kind: "contract", name };
  return null;
}

export interface ContractAbi {
  name: string;
  abi: Abi;
}

export interface PlannedStep {
  name: string;
  /** Constructor argument templates by parameter name (still containing references). */
  args: Record<string, ArgValue>;
  /** Contracts that must be deployed first. */
  dependsOn: string[];
}

export type PlanResult = { ok: true; steps: PlannedStep[] } | { ok: false; issues: ManifestIssue[] };

function constructorInputs(abi: Abi): readonly AbiParameter[] {
  const ctor = abi.find((item) => item.type === "constructor");
  return ctor && ctor.type === "constructor" ? ctor.inputs : [];
}

/** Topological order that keeps the manifest's own order wherever dependencies allow. */
export function topoSort(nodes: Array<{ name: string; dependsOn: string[] }>): { order: string[] } | { cycle: string[] } {
  const done = new Set<string>();
  const order: string[] = [];
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const stack: string[] = [];
  let cycle: string[] | null = null;
  const visit = (name: string) => {
    if (done.has(name) || cycle) return;
    const at = stack.indexOf(name);
    if (at !== -1) {
      cycle = [...stack.slice(at), name];
      return;
    }
    stack.push(name);
    for (const dep of byName.get(name)?.dependsOn ?? []) visit(dep);
    stack.pop();
    if (!cycle) {
      done.add(name);
      order.push(name);
    }
  };
  for (const n of nodes) visit(n.name);
  return cycle ? { cycle } : { order };
}

/**
 * Check a manifest against the compiled contracts and put it in deploy order. Fails on unknown
 * contracts, missing or unknown constructor arguments, bad references and cycles.
 */
export function planManifest(manifest: DeployManifest, contracts: ContractAbi[]): PlanResult {
  const issues: ManifestIssue[] = [];
  const abis = new Map(contracts.map((c) => [c.name, c.abi]));
  const listed = new Set<string>();

  for (const entry of manifest.contracts) {
    if (listed.has(entry.name)) issues.push({ message: `${entry.name} is listed twice in ${MANIFEST_PATH}.` });
    listed.add(entry.name);
    const abi = abis.get(entry.name);
    if (!abi) {
      issues.push({ message: `${MANIFEST_PATH} lists ${entry.name}, but no deployable contract has that name. Compiled: ${[...abis.keys()].join(", ") || "none"}.` });
    }
  }

  const steps: PlannedStep[] = [];
  for (const entry of manifest.contracts) {
    const abi = abis.get(entry.name);
    if (!abi) continue;
    const inputs = constructorInputs(abi);
    const names = inputs.map((i) => i.name ?? "");
    const missing = names.filter((n) => n && !(n in entry.args));
    const unknown = Object.keys(entry.args).filter((k) => !names.includes(k));
    if (inputs.some((i) => !i.name)) issues.push({ message: `${entry.name} has an unnamed constructor parameter; name every constructor parameter so the manifest can fill it.` });
    if (missing.length) issues.push({ message: `${entry.name}: constructor argument${missing.length > 1 ? "s" : ""} ${missing.join(", ")} missing in ${MANIFEST_PATH}.` });
    if (unknown.length) issues.push({ message: `${entry.name}: ${unknown.join(", ")} ${unknown.length > 1 ? "are" : "is"} not a constructor parameter (expected: ${names.join(", ") || "none"}).` });

    const dependsOn = new Set<string>();
    for (const value of Object.values(entry.args)) {
      for (const { raw, ref } of referencesIn(value)) {
        if (!ref) {
          issues.push({ message: `${entry.name}: unknown reference ${raw}. Use \${Name.address}, \${GOODDOLLAR} or \${DEPLOYER}.` });
        } else if (ref.kind === "contract") {
          if (ref.name === entry.name) issues.push({ message: `${entry.name} refers to its own address (${raw}).` });
          else if (!listed.has(ref.name) && !manifest.contracts.some((c) => c.name === ref.name)) {
            issues.push({ message: `${entry.name}: ${raw} refers to a contract that isn't in ${MANIFEST_PATH}.` });
          } else dependsOn.add(ref.name);
        }
      }
    }
    steps.push({ name: entry.name, args: entry.args, dependsOn: [...dependsOn] });
  }
  if (issues.length) return { ok: false, issues };

  const sorted = topoSort(steps);
  if ("cycle" in sorted) {
    return { ok: false, issues: [{ message: `Circular deploy order: ${sorted.cycle.join(" → ")}. A contract can't need an address that needs it back; pass one address in after deploying (a setter the owner calls) or merge the contracts.` }] };
  }
  const byName = new Map(steps.map((s) => [s.name, s]));
  return { ok: true, steps: sorted.order.map((n) => byName.get(n)!) };
}

export interface ResolveContext {
  /** Addresses of contracts already deployed in this run. */
  deployed: Record<string, Address>;
  gooddollar: Address | null;
  deployer: Address;
}

/** Replace references in one value. A whole-string reference becomes the bare address. */
function fill(value: ArgValue, ctx: ResolveContext): ArgValue {
  if (typeof value === "string") {
    return value.replace(REF, (raw, name: string, member: string | undefined) => {
      const ref = toReference(name, member);
      if (!ref) throw new Error(`Unknown reference ${raw}.`);
      if (ref.kind === "deployer") return ctx.deployer;
      if (ref.kind === "gooddollar") {
        if (!ctx.gooddollar) throw new Error("There is no G$ address for this network yet.");
        return ctx.gooddollar;
      }
      const address = ctx.deployed[ref.name];
      if (!address) throw new Error(`${ref.name} must be deployed before it can be used here.`);
      return address;
    });
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, ctx));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, ctx)]));
  return value;
}

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

/** Coerce a JSON value to the JavaScript value viem expects for an ABI type. */
export function coerceArg(param: AbiParameter, value: ArgValue): unknown {
  const label = param.name || param.type;
  const type = param.type;
  const array = /^(.*)\[(\d*)\]$/.exec(type);
  if (array) {
    if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
    if (array[2] && value.length !== Number(array[2])) throw new Error(`${label} needs exactly ${array[2]} items.`);
    const inner = { ...param, type: array[1] } as AbiParameter;
    return value.map((v) => coerceArg(inner, v));
  }
  if (type === "tuple") {
    const components = (param as AbiParameter & { components: readonly AbiParameter[] }).components;
    if (Array.isArray(value)) return components.map((c, i) => coerceArg(c, value[i]));
    if (value && typeof value === "object") return components.map((c) => coerceArg(c, (value as Record<string, ArgValue>)[c.name ?? ""]));
    throw new Error(`${label} must be an object or list.`);
  }
  if (type === "address") {
    if (typeof value !== "string" || !isAddress(value, { strict: false })) throw new Error(`${label} must be a 0x address (got ${JSON.stringify(value)}).`);
    return getAddress(value.toLowerCase());
  }
  if (type === "bool") {
    if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
    return value;
  }
  if (type === "string") {
    if (typeof value !== "string") throw new Error(`${label} must be text.`);
    return value;
  }
  if (/^u?int\d*$/.test(type)) {
    const text = typeof value === "number" ? (Number.isSafeInteger(value) ? String(value) : "") : typeof value === "string" ? value.trim() : "";
    if (!/^-?\d+$/.test(text)) throw new Error(`${label} must be a whole number written in full, like 1000000000000000000 (got ${JSON.stringify(value)}).`);
    const n = BigInt(text);
    if (type.startsWith("u") && n < ZERO) throw new Error(`${label} can't be negative.`);
    const bits = Number(type.replace(/^u?int/, "") || 256);
    const max = type.startsWith("u") ? TWO ** BigInt(bits) - ONE : TWO ** BigInt(bits - 1) - ONE;
    const min = type.startsWith("u") ? ZERO : -(TWO ** BigInt(bits - 1));
    if (n > max || n < min) throw new Error(`${label} doesn't fit in ${type}.`);
    return n;
  }
  if (/^bytes\d*$/.test(type)) {
    if (typeof value !== "string" || !isHex(value)) throw new Error(`${label} must be 0x-prefixed hex.`);
    const size = Number(type.slice(5) || 0);
    if (size && (value.length - 2) / 2 !== size) throw new Error(`${label} must be exactly ${size} bytes.`);
    return value;
  }
  throw new Error(`${label}: unsupported type ${type}.`);
}

/** Positional constructor arguments for a step, with references filled and values typed for viem. */
export function resolveArgs(step: PlannedStep, abi: Abi, ctx: ResolveContext): unknown[] {
  return constructorInputs(abi).map((input) => {
    const raw = step.args[input.name ?? ""];
    return coerceArg(input, fill(raw, ctx));
  });
}
