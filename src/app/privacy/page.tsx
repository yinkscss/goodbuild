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
        <li>Cloudflare sits in front of GoodBuild and its published apps, so it handles every request, including your IP address.</li>
      </ul>
      <h2>What is public</h2>
      <p>Anything on a blockchain is public and permanent, including deployed contracts and your wallet address. Verified source code and published apps are public too.</p>
      <h2>When you use an app published on GoodBuild</h2>
      <p>Apps on GoodBuild addresses are made by their creators. Some save data for you after you connect your wallet. For those apps:</p>
      <ul>
        <li>
          <strong>What is stored:</strong> your wallet address, what you save in the app, and when you saved it. GoodBuild stores it on its own server, separately for each app.
        </li>
        <li>
          <strong>Who can see it:</strong> you, and the app itself while you are signed in to it. The app&apos;s code can use what you saved, so only save what you&apos;re happy to share with that app. Some apps have public parts, such as posts, which anyone can read. The app&apos;s creator sees totals only, not your private records. People who run GoodBuild can access the server.
        </li>
        <li>
          <strong>Your IP address</strong> is used for a short time to stop abuse, for example too many requests in a minute, and is not saved with your data.
        </li>
        <li>
          <strong>How long it&apos;s kept:</strong> until you, the app&apos;s creator or GoodBuild deletes it. Deleted data can stay in our backups for up to 7 days.
        </li>
        <li>
          <strong>Deleting it:</strong> use the app&apos;s delete option if it has one, or write to <ContactLine /> with the app&apos;s address and your wallet address.
        </li>
      </ul>
      <p>The app preview inside GoodBuild keeps test data in your browser only, and none of it reaches our server.</p>
      <h2>Cookies</h2>
      <p>One cookie keeps you signed in, and another protects the sign-in step. If you sign in to a published app, that app gets its own cookie, which lasts up to 7 days and works only on that app. We don&apos;t use advertising cookies.</p>
      <h2>Your data</h2>
      <p>
        To see or delete your data, write to <ContactLine />. We can&apos;t remove anything already on a blockchain.
      </p>
    </LegalPage>
  );
}
