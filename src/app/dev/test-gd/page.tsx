import { notFound } from "next/navigation";

import { TestGdDeploy } from "./test-gd-deploy";

/** Development only: deploy GoodBuild's test G$ from your own wallet, with no key on disk (D24). */
export default function TestGdPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <TestGdDeploy />;
}
