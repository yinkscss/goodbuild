import { CampusProject, campusTitle } from "@/components/hackathon/campus-app-pages";

export const metadata = campusTitle("kadpoly", "My project");

export default function KadpolyProjectPage() {
  return <CampusProject event="kadpoly" />;
}
