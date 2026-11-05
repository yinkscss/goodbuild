import { Suspense } from "react";
import { notFound } from "next/navigation";

import { AuthPreview } from "./auth-preview";
import { DeployPreview } from "./deploy-preview";

/**
 * Development-only design preview of the auth UI with a mocked adapter, so the
 * connect modal and wallet states can be reviewed without a Magic key.
 * Try ?state=modal | code | connecting | error | connected | wrong-network.
 * Deploy modal (M5): ?deploy=ready | preparing | signing | broadcasting | second | opcode | failed | manifest | done. 404s in production.
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
  const { state, deploy } = await searchParams;
  if (typeof deploy === "string") return <DeployPreview state={deploy} />;
  return <AuthPreview state={typeof state === "string" ? state : "modal"} />;
}
