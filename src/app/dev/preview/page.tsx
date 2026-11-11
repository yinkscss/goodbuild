import { Suspense } from "react";
import { notFound } from "next/navigation";

import { AuthPreview } from "./auth-preview";
import { DeployPreview } from "./deploy-preview";
import { MiniPayPreview } from "./minipay-preview";

/**
 * Development-only design preview of the auth UI with a mocked adapter, so the
 * connect modal and wallet states can be reviewed without a Magic key.
 * Try ?state=modal | code | connecting | error | connected | wrong-network.
 * MiniPay guide (D88): ?minipay=deploy | publish | ready.
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
  const { state, deploy, minipay } = await searchParams;
  if (typeof deploy === "string") return <DeployPreview state={deploy} />;
  if (typeof minipay === "string") return <MiniPayPreview state={minipay} />;
  return <AuthPreview state={typeof state === "string" ? state : "modal"} />;
}
