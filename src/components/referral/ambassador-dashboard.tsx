"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Referral = { id: string; joinedAt: string; verifiedAt: string | null; voteAt: string | null; qualifiedAt: string | null; amountG: number | null; wallet?: string; root?: string; voteHash?: string };
type Payout = { id: string; wallet: string; amountG: number; status: string; createdAt: string; paidAt: string | null; overdue?: boolean; reason: string | null; txHash: string | null };
type Dashboard = { enabled: boolean; wallet: string; counts: { joined: number; verified: number; qualified: number }; availableG: number; requestedG: number; paidG: number; referrals: Referral[]; hasMore: boolean; payouts: Payout[] };
type Admin = { ambassadors?: { userId: string; wallet: string; qualified: number; earnedG: number }[]; queue?: Payout[]; detail?: Dashboard; audit?: { action: string; detail: string; at: string; actorId: string }[] };
const button = "rounded-full bg-violet px-5 py-2 text-sm font-medium text-white disabled:opacity-50";
const input = "min-w-0 rounded-block border border-grey-200 bg-surface px-3 py-2 text-sm";
const date = (s: string) => new Date(s).toLocaleString();
const money = (n: number) => `${n.toLocaleString()} G$`;
async function json(url: string, body?: unknown) {
  const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? "Could not load this page. Try again.");
  return data;
}
function History({ payouts }: { payouts: Payout[] }) {
  return <div className="space-y-3">{payouts.length === 0 && <p>No payout requests yet.</p>}{payouts.map(p => <article key={p.id} className="rounded-block border border-grey-200 p-4">
    <p className="font-semibold">{money(p.amountG)} · {p.status}</p><p className="text-sm">Requested {date(p.createdAt)}</p>
    <p className="break-all text-sm">Wallet: {p.wallet}</p>
    {["requested", "processing"].includes(p.status) && <p className="text-sm">Payment target: {date(new Date(new Date(p.createdAt).getTime() + 86400000).toISOString())}{p.overdue ? " · Overdue" : ""}</p>}
    {p.reason && <p className="text-sm">{p.reason}</p>}{p.txHash && <Link className="text-violet underline" href={`https://celoscan.io/tx/${p.txHash}`} target="_blank" rel="noreferrer">View payment on Celo</Link>}
  </article>)}</div>;
}
function Referrals({ rows, admin }: { rows: Referral[]; admin: boolean }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Person", "Joined", "Verified", "Vote confirmed", "Reward"].map(t => <th key={t} className="p-3">{t}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.id} className="border-t border-grey-200"><td className="p-3"><span className="break-all">{admin ? r.wallet : r.id}</span>{admin && r.root && <p className="break-all text-xs">Identity: {r.root}</p>}</td><td className="p-3">{date(r.joinedAt)}</td><td className="p-3">{r.verifiedAt ? date(r.verifiedAt) : "Pending"}</td><td className="p-3">{r.voteAt ? date(r.voteAt) : "Pending"}{admin && r.voteHash && <Link href={`https://celoscan.io/tx/${r.voteHash}`} className="block text-violet underline">Vote evidence</Link>}</td><td className="p-3">{r.qualifiedAt ? money(r.amountG ?? 0) : "Not qualified"}</td></tr>)}</tbody></table>{!rows.length && <p className="p-3">No referrals yet.</p>}</div>;
}
export function AmbassadorDashboard({ admin = false }: { admin?: boolean }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [adminData, setAdminData] = useState<Admin | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState("");
  const [wallet, setWallet] = useState("");
  const [filter, setFilter] = useState("");
  const [confirming, setConfirming] = useState(false);
  const load = useCallback(async () => {
    try {
      if (admin) {
        const query = new URLSearchParams({ page: String(page), ...(selected ? { userId: selected } : {}), ...(filter ? { wallet: filter } : {}) });
        const result: Admin = await json(`/api/ambassador/admin?${query}`);
        setAdminData(result); setData(result.detail ?? null);
      } else setData(await json(`/api/ambassador?page=${page}`));
      setError("");
    } catch (e) { setError((e as Error).message); }
  }, [admin, selected, filter, page]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  async function action(body: unknown) {
    setBusy(true); setError("");
    try { await json(admin ? "/api/ambassador/admin" : "/api/ambassador", body); setConfirming(false); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="mt-6 space-y-6">
    {error && <p role="alert" className="text-danger">{error}</p>}
    {admin && <><form className="flex gap-3" onSubmit={e => { e.preventDefault(); setSelected(""); setPage(0); setFilter(wallet.trim()); }}><input aria-label="Ambassador wallet" className={`${input} flex-1`} placeholder="Search ambassador wallet" value={wallet} onChange={e => setWallet(e.target.value)} /><button className={button}>Search</button></form>
    {selected && <button className="text-violet underline" onClick={() => { setSelected(""); setPage(0); }}>Back to ambassadors</button>}
    {adminData?.ambassadors?.map(a => <button key={a.userId} onClick={() => { setSelected(a.userId); setPage(0); }} className="block w-full break-all rounded-block border border-grey-200 p-4 text-left">{a.wallet}<span className="block">{a.qualified} qualified · {money(a.earnedG)} earned</span></button>)}
    {adminData?.queue && <section><h2 className="mb-3 text-lg font-bold">Pending payouts</h2><History payouts={adminData.queue} />{adminData.queue.map(p => <AdminActions key={p.id} payout={p} busy={busy} submit={action} />)}</section>}</>}
    {data && <>
      {!data.enabled && <p>Ambassador rewards have not launched yet.</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Object.entries({ Joined: data.counts.joined, Verified: data.counts.verified, Qualified: data.counts.qualified, "Available G$": data.availableG, "Awaiting payout G$": data.requestedG, "Paid G$": data.paidG }).map(([label,value]) => <div key={label} className="rounded-card bg-tint p-4"><p className="text-sm">{label}</p><p className="mt-2 text-2xl font-bold">{value.toLocaleString()}</p></div>)}</div>
      {!admin && <section className="rounded-card bg-surface p-5 shadow-card"><h2 className="text-lg font-bold">Request payout</h2><p className="my-3 text-sm">Earn 5,000 G$ per qualified referral. Request payment from 25,000 G$ (five people), any day. Payments are sent within 24 hours.</p><p className="mb-3 break-all text-sm">Receiving wallet: {data.wallet}</p>
        {confirming ? <div><p className="mb-3">Request your full available balance of {money(data.availableG)} to this wallet?</p><button disabled={busy} className={button} onClick={() => void action({})}>Confirm request</button><button className="ml-4" onClick={() => setConfirming(false)}>Cancel</button></div> : <button className={button} disabled={busy || data.availableG < 25000 || data.requestedG > 0} onClick={() => setConfirming(true)}>Request {money(data.availableG)}</button>}
      </section>}
      <section><h2 className="mb-3 text-lg font-bold">People you brought in</h2><Referrals rows={data.referrals} admin={admin} /></section>
      <section><h2 className="mb-3 text-lg font-bold">Payout history</h2><History payouts={data.payouts} />{admin && data.payouts.filter(p => ["requested","processing"].includes(p.status)).map(p => <AdminActions key={p.id} payout={p} busy={busy} submit={action} />)}</section>
    </>}
    {adminData?.audit && <details><summary>Admin action history</summary>{adminData.audit.map((a,i) => <p key={i} className="my-2 break-all text-xs">{date(a.at)} · {a.action} · {a.actorId} · {a.detail}</p>)}</details>}
    <div className="flex gap-4"><button disabled={page === 0 || busy} onClick={() => setPage(p => p-1)}>Previous</button><span>Page {page+1}</span><button disabled={busy || (data ? !data.hasMore && data.payouts.length < 25 : !adminData || ((adminData.ambassadors?.length ?? 0) < 25 && (adminData.queue?.length ?? 0) < 25))} onClick={() => setPage(p => p+1)}>Next</button><button className="text-violet" onClick={() => void load()}>Refresh</button></div>
  </div>;
}
function AdminActions({ payout: p, busy, submit }: { payout: Payout; busy: boolean; submit: (b: unknown) => Promise<void> }) {
  const [reason, setReason] = useState(""); const [hash, setHash] = useState("");
  return <div className="my-3 space-y-3 rounded-block bg-tint p-4"><p className="break-all text-sm">Request {p.id}</p><input className={`${input} w-full`} aria-label={`Reason for ${p.id}`} placeholder="Reason / reconciliation notes" value={reason} onChange={e => setReason(e.target.value)} />
    {p.status === "requested" ? <div className="flex gap-3"><button className={button} disabled={busy} onClick={() => void submit({ id:p.id, action:"process" })}>Start payment</button><button disabled={busy || !reason.trim()} onClick={() => void submit({ id:p.id, action:"reject", reason })}>Reject request</button></div> : <><p className="text-sm">Send the exact amount on Celo, then enter its transaction hash. Wait for 30 blocks before confirming.</p><input className={`${input} w-full`} aria-label={`Transaction hash for ${p.id}`} placeholder="0x…" value={hash} onChange={e => setHash(e.target.value)} /><div className="flex flex-wrap gap-3"><button className={button} disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(hash)} onClick={() => void submit({ id:p.id, action:"confirm", hash })}>Verify payment</button><button disabled={busy || !reason.trim()} onClick={() => { if (window.confirm("Only return to review after checking that no payment succeeded or is pending. Have you reconciled all transfers?")) void submit({ id:p.id, action:"reconcile", reason }); }}>Return to review after reconciliation</button></div></>}
  </div>;
}
