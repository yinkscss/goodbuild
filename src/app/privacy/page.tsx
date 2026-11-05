import { ContactLine, LegalPage } from "@/components/legal/legal-page";

export const metadata = { title: "Privacy · GoodBuild", description: "What GoodBuild collects during the testnet beta and who it goes to." };

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Privacy" title="Privacy" intro="What GoodBuild keeps during the testnet beta, and who else sees it.">
      <h2>What we keep</h2>
      <ul>
        <li>Your wallet address, and that you confirmed you are 18 or over and not a US person.</li>
        <li>Your prompts, chat, uploaded files and the code generated for your projects.</li>
        <li>Your deployments and published apps, and how much AI each build used.</li>
      </ul>
      <h2>Who else sees it</h2>
      <ul>
        <li>AI providers (Anthropic and DeepSeek) receive your prompts, files and code to build your app.</li>
        <li>Magic handles email sign-in and your email wallet, so it receives your email address.</li>
        <li>WalletConnect, if you connect through it.</li>
        <li>Sourcify receives your contract&apos;s source code when it is verified.</li>
      </ul>
      <h2>What is public</h2>
      <p>Anything on a blockchain is public and permanent, including deployed contracts and your wallet address. Verified source code and published apps are public too.</p>
      <h2>Cookies</h2>
      <p>One cookie keeps you signed in, and another protects the sign-in step. We don&apos;t use advertising cookies.</p>
      <h2>Your data</h2>
      <p>
        To see or delete your data, write to <ContactLine />. We can&apos;t remove anything already on a blockchain.
      </p>
    </LegalPage>
  );
}
