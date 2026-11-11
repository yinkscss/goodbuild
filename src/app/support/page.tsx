import { Suspense } from "react";
import { connection } from "next/server";

import { LegalPage } from "@/components/legal/legal-page";
import { SupportForm } from "@/components/support/support-form";
import { CONTACT_EMAIL, SUPPORT_TELEGRAM_URL } from "@/config/site-links";
import { supportConfigured } from "@/server/support/ticket";

export const metadata = { title: "Support · GoodBuild", description: "Send GoodBuild a support ticket, or message us on Telegram." };

/** Read per request (not at build), so setting the keys on the server switches the form on without a rebuild. */
async function SupportBody() {
  await connection();
  const form = supportConfigured();
  return (
    <>
      {form && <SupportForm telegramUrl={SUPPORT_TELEGRAM_URL} />}
      <p>
        {form ? "Prefer chat? " : "Message us and we'll help: "}
        <a className="text-violet hover:underline" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noreferrer">Message us on Telegram</a>
        {CONTACT_EMAIL && (
          <>
            {" "}or write to <a className="text-violet hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </>
        )}
        .
      </p>
    </>
  );
}

export default function SupportPage() {
  return (
    <LegalPage draft={false} eyebrow="Support" title="Support" intro="Stuck, confused or something broke? Send us a ticket and a real person will reply.">
      <Suspense fallback={<div className="skeleton h-[320px] rounded-card motion-reduce:animate-none" />}>
        <SupportBody />
      </Suspense>
      <p>Never send your private key or recovery phrase. GoodBuild will never ask for them.</p>
    </LegalPage>
  );
}
