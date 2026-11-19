import { SubmissionForm } from "@/components/hackathon/community";

export const metadata = { title: "My project · Hackathon · GoodBuild" };

export default function HackathonProjectPage() {
  return (
    <section aria-labelledby="hk-project">
      <h2 id="hk-project" className="display text-[22px] font-bold">My project</h2>
      <p className="mt-2 text-sm text-grey-600">Submit it now and come back to add your live app and source code. Add the live link to open approvals.</p>
      <div className="mt-5">
        <SubmissionForm />
      </div>
    </section>
  );
}
