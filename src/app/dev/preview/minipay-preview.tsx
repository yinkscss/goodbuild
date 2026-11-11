"use client";

import { MiniPayGuide } from "@/components/workspace/minipay-guide";
import type { PublishInfo } from "@/components/workspace/use-publish";

const FILES = { "src/goodbuild.json": '{"kits":["mini-app"]}', "src/App.tsx": "export default function App() { return <main />; }\n" };

/** The chat's MiniPay guide (D88): ?minipay=deploy | publish | ready. */
export function MiniPayPreview({ state }: { state: string }) {
  const info: PublishInfo = {
    slug: "rock-dodge",
    url: "https://rock-dodge.goodbuildit.xyz",
    domain: "goodbuildit.xyz",
    live: state === "ready",
    disabled: false,
    publishedVersion: state === "ready" ? 3 : null,
    currentVersion: 3,
    undeployed: state === "deploy" ? ["Scores"] : [],
    hasApp: true,
  };
  return (
    <main className="min-h-dvh bg-canvas p-4">
      <section className="mx-auto max-w-[460px] space-y-5 rounded-card bg-surface p-5 shadow-card">
        <p className="ml-auto w-fit rounded-block rounded-br-md bg-tint px-4 py-3 text-sm">Start building</p>
        <p className="text-sm">Rock Dodge is ready. It works inside MiniPay, and passes the MiniPay checks.</p>
        <MiniPayGuide
          key={state}
          projectId={`preview-${state}`}
          chainId={11142220}
          files={FILES}
          hasContracts={state === "deploy"}
          outdatedContracts={[]}
          publish={info}
          onPublish={() => undefined}
          onAsk={() => undefined}
          busy={false}
        />
      </section>
    </main>
  );
}
