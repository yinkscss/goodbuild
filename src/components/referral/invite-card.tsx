import Link from "next/link";

/** A single line on Home that points to the Referrals page (D155). The full invite tools live there. */
export function InviteFriendsCard() {
  return (
    <section aria-label="Invite friends" className="mt-12 flex flex-wrap items-center justify-between gap-3 rounded-card bg-tint px-6 py-4 shadow-card">
      <p className="text-sm">
        <span className="font-semibold">Invite a friend.</span> <span className="text-grey-600">You both get free credits.</span>
      </p>
      <Link href="/home/referrals" className="rounded-full bg-violet px-5 py-2 text-sm font-medium text-white outline-none focus-visible:shadow-focus">
        Get your link
      </Link>
    </section>
  );
}
