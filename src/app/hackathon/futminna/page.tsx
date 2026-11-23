import { CampusHackathonPage, campusMetadata } from "@/components/hackathon/campus-page";

export const metadata = campusMetadata("futminna");

/** The FUTMinna hackathon (D160). */
export default function FutminnaHackathonPage() {
  return <CampusHackathonPage event="futminna" />;
}
