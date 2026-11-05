import { Suspense } from "react";

import { ContactLine, LegalPage } from "@/components/legal/legal-page";
import { CONTACT_EMAIL } from "@/config/site-links";

export const metadata = { title: "Report an app · GoodBuild", description: "Report a published app that is harmful or breaks the GoodBuild terms." };

async function Reported({ searchParams }: { searchParams: PageProps<"/report">["searchParams"] }) {
  const { app } = await searchParams;
  const name = typeof app === "string" && /^[a-z0-9-]{1,40}$/.test(app) ? app : null;
  if (!name) return null;
  return (
    <p>
      You are reporting <strong className="font-semibold">{name}</strong>.
      {CONTACT_EMAIL && (
        <>
          {" "}
          <a className="text-violet hover:underline" href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Report: ${name}`)}`}>
            Email this report
          </a>
          .
        </>
      )}
    </p>
  );
}

export default function ReportPage({ searchParams }: PageProps<"/report">) {
  return (
    <LegalPage draft={false} eyebrow="Report" title="Report an app" intro="Tell us about a published app that looks like a scam, is harmful, or breaks the terms.">
      <Suspense>
        <Reported searchParams={searchParams} />
      </Suspense>
      <p>
        Write to <ContactLine /> with the app&apos;s address and what is wrong. Don&apos;t send your private key or recovery phrase. GoodBuild will never ask for them.
      </p>
      <p>We can take a published page down. We can&apos;t change or remove its contract, because that lives on the blockchain.</p>
    </LegalPage>
  );
}
