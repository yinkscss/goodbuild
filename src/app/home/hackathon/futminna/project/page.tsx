import { SubmissionForm } from "@/components/hackathon/community";

export const metadata = { title: "My project · FUTMinna Hackathon · GoodBuild" };

export default function FutminnaProjectPage() {
  return (
    <section aria-labelledby="hk-project">
      <h2 id="hk-project" className="display text-[22px] font-bold">My FUTMinna project</h2>
      <p className="mt-2 text-sm text-grey-600">
        Enter your app or game now and come back to add your live link and source code. Add the live link to open approvals. Each
        builder enters one hackathon.
      </p>
      <div className="mt-5">
        <SubmissionForm />
      </div>
    </section>
  );
}
