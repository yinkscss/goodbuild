/**
 * Which uploaded files are still waiting in the composer, and which a sent message carried.
 * A file belongs to the message it was sent with (meta.assetIds) and shows in that bubble; until
 * then it is a chip above the composer. Files uploaded before messages recorded this (older
 * projects) count as sent once a later message went out, so they don't sit in the composer.
 */

type Message = { role: string; createdAt: string; meta: Record<string, unknown> | null };

/** The files a user message was sent with, in upload order as saved. */
export function messageAssetIds(meta: Record<string, unknown> | null | undefined): string[] {
  const ids = meta?.assetIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

/** Ids of files uploaded since the last message that could have carried them. */
export function pendingAssetIds(messages: Message[], assets: Array<{ id: string; createdAt: string }>): Set<string> {
  const users = messages.filter((m) => m.role === "user");
  const sent = new Set(users.flatMap((m) => messageAssetIds(m.meta)));
  // The newest message sent from a composer that attaches files; for older projects, the newest message.
  const carrier = [...users].reverse().find((m) => m.meta && "assetIds" in m.meta) ?? users.at(-1);
  const cutoff = carrier ? Date.parse(carrier.createdAt) : -Infinity;
  return new Set(assets.filter((a) => !sent.has(a.id) && Date.parse(a.createdAt) > cutoff).map((a) => a.id));
}
