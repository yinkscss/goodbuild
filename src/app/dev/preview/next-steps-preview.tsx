"use client";

import { DeployProvider } from "@/components/deploy/deploy-trigger";
import { LogoChip, PublishNextStep } from "@/components/workspace/next-steps";
import type { PublishInfo } from "@/components/workspace/use-publish";
import type { AssetInfo } from "@/server/agent/assets";

const LOGO: AssetInfo & { pending: boolean } = {
  id: "a1",
  name: "brand.png",
  kind: "logo",
  mime: "image/png",
  size: 1,
  width: 64,
  height: 64,
  palette: [],
  description: "",
  pending: true,
};

/** The chat's next steps after a working build (D176): ?next=logo | logo-added | publish | publish-contract. */
export function NextStepsPreview({ state }: { state: string }) {
  const contract = state === "publish-contract";
  const info: PublishInfo = {
    slug: "study-buddy",
    url: "https://study-buddy.goodbuildit.xyz",
    domain: "goodbuildit.xyz",
    live: false,
    disabled: false,
    addressLocked: false,
    publishedVersion: null,
    currentVersion: 1,
    undeployed: contract ? ["StudyPool"] : [],
    hasApp: true,
  };
  const logo = state === "logo" || state === "logo-added";
  return (
    <DeployProvider projectId="preview" chainId={11142220} hasContracts={contract} deployed={[]} busy={false} onDeployed={() => undefined} onFix={() => undefined}>
      <main className="min-h-dvh bg-canvas p-4">
        <section className="mx-auto max-w-[460px] space-y-5 rounded-card bg-surface p-5 shadow-card">
          <p className="ml-auto w-fit rounded-block rounded-br-md bg-tint px-4 py-3 text-sm">Start building</p>
          <p className="text-sm">Study Buddy is ready. Add a subject, set a goal and tick off sessions as you go.</p>
          {logo && (
            <LogoChip
              key={state}
              projectId={`preview-${state}`}
              assets={state === "logo-added" ? [LOGO] : []}
              onUpload={async () => undefined}
              uploading={false}
              onUse={() => undefined}
              disabled={false}
            />
          )}
          {!logo && <PublishNextStep info={info} onPublish={() => undefined} />}
        </section>
      </main>
    </DeployProvider>
  );
}
