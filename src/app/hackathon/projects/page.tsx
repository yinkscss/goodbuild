import Link from "next/link";
import { ProjectGallery } from "@/components/hackathon/community";
import { styles } from "@/components/hackathon/styles";
import "@/components/hackathon/hackathon.css";
export const metadata = {
  title: "Project showcase & leaderboard · GoodBuild Hackathon",
};
export default function Page() {
  return (
    <div className={styles.page}>
      <main className={`${styles.wrap} py-10 sm:py-16`}>
        <Link className={styles.linkGhost} href="/hackathon">
          ← Hackathon home
        </Link>
        <div className="hk-community-header">
          <div>
            <p className={styles.eyebrow}>The community decides</p>
            <h1 className={`${styles.disp} mt-3`}>
              Built by people.
              <br />
              Approved by people.
            </h1>
          </div>
          <div className="hk-community-intro">
            <p>
              Explore every project, try a published app, and give it your
              approval. The leaderboard updates as verified humans vote.
            </p>
            <Link className={styles.btnV} href="/hackathon/submit">
              Submit or update a project →
            </Link>
          </div>
        </div>
        <ProjectGallery />
      </main>
    </div>
  );
}
