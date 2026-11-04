/**
 * Minimal Server-Sent Events parser for `data: <json>` frames. Feed it chunks as they
 * arrive; it returns complete events and keeps any partial frame for the next chunk.
 */
export function createSseParser<T>() {
  let buffer = "";
  return function push(chunk: string): T[] {
    buffer += chunk.replace(/\r\n/g, "\n");
    const out: T[] = [];
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try {
        out.push(JSON.parse(data) as T);
      } catch {
        // Ignore a malformed frame rather than break the stream.
      }
    }
    return out;
  };
}
