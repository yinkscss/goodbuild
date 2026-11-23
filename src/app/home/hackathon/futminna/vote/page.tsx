import { CampusVote, campusTitle } from "@/components/hackathon/campus-app-pages";

export const metadata = campusTitle("futminna", "Vote");

export default function FutminnaVotePage() {
  return <CampusVote event="futminna" />;
}
