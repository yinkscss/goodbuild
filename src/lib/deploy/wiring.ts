const PLATFORM_DIR = "src/contracts/";

/** The deployed addresses in the project's contract modules. Changes exactly when a deploy lands. */
export function contractAddressKey(files: Record<string, string>): string {
  return Object.entries(files)
    .filter(([p]) => p.startsWith(PLATFORM_DIR))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([, source]) => source.match(/export const \w+Address\b[^=]*=\s*\{[\s\S]*?\};/g) ?? [])
    .join("");
}

/** Contracts whose module holds an address for this chain. */
export function deployedContracts(files: Record<string, string>, chainId: number): string[] {
  return Object.entries(files)
    .filter(([p]) => p.startsWith(PLATFORM_DIR))
    .flatMap(([, source]) => [...source.matchAll(/export const (\w+)Address\b[^=]*=\s*(\{[\s\S]*?\});/g)])
    .filter((m) => m[2].includes(`"${chainId}"`))
    .map((m) => m[1]);
}

/**
 * Deployed contracts the app needs wiring to: all of them when no page reads any <Name>Address, and
 * none otherwise. A helper contract the app never touches directly is normal in a working app, so
 * one unread address alone isn't worth a paid build.
 */
export function contractsToWire(files: Record<string, string>, deployed: string[]): string[] {
  const app = Object.entries(files).filter(([p]) => p.startsWith("src/") && !p.startsWith(PLATFORM_DIR));
  const wired = deployed.some((name) => app.some(([, source]) => new RegExp(`\\b${name}Address\\b`).test(source)));
  return wired ? [] : deployed;
}

export function wirePrompt(names: string[]): string {
  return `I just deployed ${names.join(" and ")}, but the app doesn't use ${names.length > 1 ? "them" : "it"} yet. Wire it up: import the ABI and address map from ./contracts (<Name>Abi, <Name>Address[chain.id]), replace any sample data with real reads and writes, and don't hardcode addresses or change the contract.`;
}
