import { CampusLeaderboard, campusTitle } from "@/components/hackathon/campus-app-pages";

export const metadata = campusTitle("kadpoly", "Leaderboard");

export default function KadpolyLeaderboardPage() {
  return <CampusLeaderboard event="kadpoly" />;
}
