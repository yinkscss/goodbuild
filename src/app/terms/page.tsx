import { ContactLine, LegalPage } from "@/components/legal/legal-page";

export const metadata = { title: "Terms · GoodBuild", description: "The terms for using GoodBuild." };

export default function TermsPage() {
  return (
    <LegalPage eyebrow="Terms" title="Terms of use" intro="The rules for using GoodBuild.">
      <h2>Who can use GoodBuild</h2>
      <p>You must be 18 or over and not a US person. GoodBuild isn&apos;t available in some regions.</p>
      <h2>What you can build</h2>
      <ul>
        <li>No sports betting apps.</li>
        <li>Nothing illegal, and nothing that deceives people or takes their money or data.</li>
        <li>Nothing aimed at people under 18 or at US persons.</li>
      </ul>
      <h2>Generated code is unaudited</h2>
      <p>AI writes the contracts and apps, and nobody at GoodBuild reviews them. They can contain mistakes that lose funds. Check anything you deploy, and you are responsible for what you deploy and publish.</p>
      <h2>Your wallet and your contracts</h2>
      <p>GoodBuild never holds your private keys. Your wallet signs each deploy and pays its network fee. Blockchain transactions can&apos;t be undone, and GoodBuild can&apos;t change or remove a deployed contract.</p>
      <h2>Published apps</h2>
      <p>Published apps are public and made by their creators, not by GoodBuild. We can take down an app that breaks these terms. That removes its page, not its contracts.</p>
      <h2>Data your published app saves</h2>
      <p>A published app can save data for its visitors. Some parts need them to sign in, with their wallet or with a code sent to their email, and forms such as bookings or contact messages can be sent without signing in. GoodBuild stores that data for you. If your app saves visitors&apos; data:</p>
      <ul>
        <li>You are responsible for what your app asks for and how it uses it. Tell visitors what you save and why.</li>
        <li>Don&apos;t collect passwords, card or bank details, government ID numbers, health information, or anything about people under 18.</li>
        <li>Only collect what the app needs. Don&apos;t sell visitors&apos; data or use it to deceive them.</li>
        <li>You can read what visitors send to you, such as bookings and messages, in the Backend window, only where your app&apos;s rules make you a reader and the form tells visitors so. You can&apos;t read visitors&apos; private records. You can delete entries, or all of your app&apos;s data.</li>
        <li>Keep what visitors send you private. Use it only for the reason they sent it.</li>
        <li>Each app has limits on how much it can store. We can refuse writes over those limits.</li>
        <li>If we take down your app, its data stays for review, and we can delete it. Data is also deleted if your project is deleted.</li>
      </ul>
      <p>Saved data can be lost. Don&apos;t use a published app as the only copy of anything important.</p>
      <h2>No guarantees</h2>
      <p>The service is provided as it is, can change or stop, and may lose data. Testnet tokens have no value.</p>
      <h2>Contact</h2>
      <p>
        Reach us at <ContactLine />.
      </p>
    </LegalPage>
  );
}
