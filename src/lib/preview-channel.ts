/** Messages between the workspace tab and its pop-out preview tabs. */
export type PreviewChannelMessage =
  | { type: "hello" }
  | { type: "files"; files: Record<string, string>; version: number };

export function previewChannelName(projectId: string): string {
  return `gb-preview:${projectId}`;
}

/** Null where the browser has no BroadcastChannel; the pop-out then relies on refetching. */
export function openPreviewChannel(projectId: string): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(previewChannelName(projectId));
}

/**
 * Saved files only replace what the pop-out shows if their version is newer, or the same version
 * gained a deployed address (a deploy adds no version). An equal version can otherwise be older than
 * the live files of a running build, and reverting creates a new version, so it still applies.
 */
export function shouldShowSaved(saved: { version: number; addresses: string }, showing: { version: number; addresses: string }): boolean {
  return saved.version > showing.version || (saved.version === showing.version && saved.addresses !== showing.addresses);
}
