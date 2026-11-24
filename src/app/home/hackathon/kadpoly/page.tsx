import { GetStarted } from "@/components/hackathon/get-started";
import { campusTitle } from "@/components/hackathon/campus-app-pages";

export const metadata = campusTitle("kadpoly", "Get started");

/** Kadpoly's Get started (D160, D167). The component reads the event from the path. */
export default function KadpolyGetStartedPage() {
  return <GetStarted />;
}
