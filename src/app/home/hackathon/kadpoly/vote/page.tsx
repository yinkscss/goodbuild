import { CampusVote, campusTitle } from "@/components/hackathon/campus-app-pages";

export const metadata = campusTitle("kadpoly", "Vote");

export default function KadpolyVotePage() {
  return <CampusVote event="kadpoly" />;
}
