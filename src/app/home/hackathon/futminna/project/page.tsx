import { CampusProject, campusTitle } from "@/components/hackathon/campus-app-pages";

export const metadata = campusTitle("futminna", "My project");

export default function FutminnaProjectPage() {
  return <CampusProject event="futminna" />;
}
