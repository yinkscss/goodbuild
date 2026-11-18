import Link from "next/link";
import { SubmissionForm } from "@/components/hackathon/community";
import { styles } from "@/components/hackathon/styles";
import "@/components/hackathon/hackathon.css";
export const metadata = { title: "Submit your project · GoodBuild Hackathon" };
export default function Page() {
  return (
    <div className={styles.page}>
      <main className={`${styles.wrap} py-10 sm:py-16`}>
        <Link className={styles.linkGhost} href="/hackathon">
          ← Hackathon home
        </Link>
        <div className={`${styles.shead} mt-10`}>
          <h1 className={styles.disp}>
            Your idea
            <br />
            belongs here.
          </h1>
          <p>
            Start with a name and a short pitch. Share your idea now, build on
            GoodBuild, and return to add your live app and source code. Everyone
            can participate.
          </p>
        </div>
        <SubmissionForm />
        <p className="mt-10">
          <Link className={styles.linkGhost} href="/hackathon/projects">
            Browse projects & leaderboard →
          </Link>
        </p>
      </main>
    </div>
  );
}
