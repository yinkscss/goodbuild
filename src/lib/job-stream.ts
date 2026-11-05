import type { TurnEvent } from "./turn-types";

export interface JobStreamMessage {
  id: number | null;
  /** "message" for turn events, "end" when the job is over and everything was sent. */
  event: string;
  data: TurnEvent | null;
}

/** Incremental SSE parser that keeps `id:` (for ?after= reconnects) and `event:` lines. */
export function createJobStreamParser() {
  let buffer = "";
  return (chunk: string): JobStreamMessage[] => {
    buffer += chunk;
    const out: JobStreamMessage[] = [];
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let id: number | null = null;
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "id") id = Number(value);
        else if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (!data.length && event === "message") continue;
      let parsed: TurnEvent | null = null;
      try {
        parsed = event === "message" ? (JSON.parse(data.join("\n")) as TurnEvent) : null;
      } catch {
        parsed = null;
      }
      out.push({ id: Number.isFinite(id) ? id : null, event, data: parsed });
    }
    return out;
  };
}

/** Reconnect delay after the n-th consecutive failure: 1 s, 2 s, 4 s, then 8 s at most. */
export function backoffMs(failures: number): number {
  return Math.min(8_000, 1_000 * 2 ** Math.max(0, failures - 1));
}
