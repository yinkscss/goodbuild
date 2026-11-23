import { CampusLeaderboard, campusTitle } from "@/components/hackathon/campus-app-pages";

export const metadata = campusTitle("futminna", "Leaderboard");

export default function FutminnaLeaderboardPage() {
  return <CampusLeaderboard event="futminna" />;
}
