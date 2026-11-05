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
 * A saved version only replaces what the pop-out shows if it's newer. An equal version can be older
 * than the live files of a running build, and reverting creates a new version, so it still applies.
 */
export function isNewerSavedVersion(saved: number, showing: number): boolean {
  return saved > showing;
}
