import { CampusHackathonPage, campusMetadata } from "@/components/hackathon/campus-page";

export const metadata = campusMetadata("kadpoly");

/** The Kadpoly (Kaduna Polytechnic) hackathon (D166). */
export default function KadpolyHackathonPage() {
  return <CampusHackathonPage event="kadpoly" />;
}
