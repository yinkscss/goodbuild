// @vitest-environment node
import { chromium, type Browser } from "playwright-core";
import { describe, expect, it } from "vitest";

import { buildPublishedApp } from "@/server/publish/build";
import { starterFiles } from "./template";

// Skipped without the browser, like run-check.test.ts; CI has it.
const hasBrowser =
  Boolean(process.env.CI) ||
  (await chromium
    .launch({ headless: true })
    .then((b) => b.close().then(() => true))
    .catch(() => false));

// The shape a tester hit: the page decides what to show from its own useDbSession(), and a separate
// card holds the sign-in button. Each call used to keep its own copy, so signing in never changed the page.
const APP = `import { useDbSession } from "./lib/useDb";
function SignInCard() {
  const s = useDbSession();
  return <button onClick={() => void s.signIn()}>Sign in with wallet</button>;
}
function Header() {
  const s = useDbSession();
  return s.signedIn ? <button onClick={() => void s.signOut()}>Sign out</button> : null;
}
export default function App() {
  const session = useDbSession();
  if (session.loading) return <p>Loading</p>;
  return <main><Header />{session.signedIn ? <h1>Your receipts</h1> : <SignInCard />}</main>;
}
`;

describe.skipIf(!hasBrowser)("useDbSession in a real browser", () => {
  it("shares one sign-in across components, in and out", async () => {
    const built = await buildPublishedApp({ files: { ...starterFiles(), "src/App.tsx": APP }, assets: [], title: "t", hasUndeployedContracts: false, forCheck: true });
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.route("http://app.test/**", (route) => {
        const path = new URL(route.request().url()).pathname.replace(/^\//, "") || "index.html";
        const f = built.find((x) => x.path === path) ?? built.find((x) => x.path === "index.html")!;
        return route.fulfill({ status: 200, contentType: f.mime, body: Buffer.from(f.bytes) });
      });
      await page.goto("http://app.test/");
      await page.getByText("Sign in with wallet").click();
      await expect(page.getByText("Your receipts").waitFor({ timeout: 5000 })).resolves.toBeUndefined();
      await page.getByText("Sign out").click();
      await expect(page.getByText("Sign in with wallet").waitFor({ timeout: 5000 })).resolves.toBeUndefined();
    } finally {
      await browser?.close();
    }
  }, 60_000);
});
