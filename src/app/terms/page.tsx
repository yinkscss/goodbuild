import { ContactLine, LegalPage } from "@/components/legal/legal-page";

export const metadata = { title: "Terms · GoodBuild", description: "The terms for using GoodBuild during the testnet beta." };

export default function TermsPage() {
  return (
    <LegalPage eyebrow="Terms" title="Terms of use" intro="The rules for using GoodBuild during the testnet beta.">
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
      <h2>Testnet beta</h2>
      <p>The service is provided as it is, can change or stop, and may lose data. Testnet tokens have no value.</p>
      <h2>Contact</h2>
      <p>
        Reach us at <ContactLine />.
      </p>
    </LegalPage>
  );
}
