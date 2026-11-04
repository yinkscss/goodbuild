import { Suspense } from "react";
import { notFound } from "next/navigation";

import { AuthPreview } from "./auth-preview";

/**
 * Development-only design preview of the auth UI with a mocked adapter, so the
 * connect modal and wallet states can be reviewed without a Privy app id.
 * Try ?state=modal | code | connecting | error | connected | wrong-network. 404s in production.
 */
export default function PreviewPage({ searchParams }: PageProps<"/dev/preview">) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense>
      <Preview searchParams={searchParams} />
    </Suspense>
  );
}

async function Preview({ searchParams }: { searchParams: PageProps<"/dev/preview">["searchParams"] }) {
  const { state } = await searchParams;
  return <AuthPreview state={typeof state === "string" ? state : "modal"} />;
}
