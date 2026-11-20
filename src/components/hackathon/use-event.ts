"use client";
import { usePathname } from "next/navigation";
import { eventFromPath, HACKATHON_EVENTS, type HackathonEvent } from "@/lib/hackathon-events";

/** Which hackathon this page belongs to, from its address (D160), and that event's settings. */
export function useHackathonEvent(): { event: HackathonEvent; config: (typeof HACKATHON_EVENTS)[HackathonEvent] } {
  const event = eventFromPath(usePathname());
  return { event, config: HACKATHON_EVENTS[event] };
}
