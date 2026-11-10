import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SendGateProvider } from "@/components/auth/send-gate";
import { SITE_URL } from "@/config/site-url";

// Self-hosted variable fonts (OFL), vendored from @fontsource-variable so builds
// don't depend on Google Fonts being reachable.
const unbounded = localFont({
  src: "../fonts/unbounded-latin-wght-normal.woff2",
  variable: "--font-unbounded",
  weight: "200 900",
  display: "swap",
});

const inter = localFont({
  src: "../fonts/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

const jetbrains = localFont({
  src: "../fonts/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jetbrains",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  keywords: ["AI app builder", "free AI app builder", "MiniPay app", "build a dApp", "Celo", "smart contract generator", "vibe coding", "no-code blockchain", "G$ GoodDollar", "GoodBuild"],
  openGraph: { siteName: "GoodBuild", type: "website" },
  title: "GoodBuild: describe a dApp, sign it, ship it on Celo",
  description:
    "GoodBuild writes the Solidity contract and React front end for your dApp. You deploy it to Celo by signing from your own wallet.",
};

export const viewport: Viewport = {
  themeColor: "#F5F5F5",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${unbounded.variable} ${inter.variable} ${jetbrains.variable} antialiased`}
    >
      <body className="min-h-dvh" suppressHydrationWarning>
        <Providers>
          <SendGateProvider>{children}</SendGateProvider>
        </Providers>
      </body>
    </html>
  );
}
