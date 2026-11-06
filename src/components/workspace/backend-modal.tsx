"use client";

import * as React from "react";
import { ArrowRight, Database, Download, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DATA_RULES_PATH, describeRule, parseDataRules } from "@/lib/app-data";
import { inferKind, type ContractKind } from "@/lib/contract-kind";
import { cn } from "@/lib/utils";
import { AppDataRow } from "./app-data-row";

/** The helpers every starter app has. Using them anywhere else means the app saves data (D31). */
const HELPERS = new Set(["src/lib/db.ts", "src/lib/useDb.ts"]);
const USES_HELPER = /from\s+["'][^"']*lib\/(db|useDb)["']/;

export interface BackendState {
  on: boolean;
  collections: { name: string; who: string; publicFields: string[]; everyone: boolean; noSignIn: boolean }[];
}

/** Whether the app saves data, and what it saves, read from its own files. */
export function backendState(files: Record<string, string>): BackendState {
  const { rules } = parseDataRules(files[DATA_RULES_PATH]);
  const collections = Object.entries(rules).map(([name, rule]) => ({
    name,
    ...describeRule(rule),
    everyone: rule.read.includes("anyone"),
    noSignIn: rule.create === "anyone",
  }));
  const usesHelper = Object.entries(files).some(([path, src]) => path.startsWith("src/") && !HELPERS.has(path) && USES_HELPER.test(src));
  return { on: usesHelper || collections.length > 0, collections };
}

export interface BackendIdea {
  label: string;
  detail: string;
  prompt: string;
}

const idea = (label: string, detail: string, what: string): BackendIdea => ({
  label,
  detail,
  prompt: `Add saved data to this app (GoodBuild's built-in backend, with wallet sign-in): ${what} Keep everything that already works, and keep money and ownership in the contract.`,
});

/** Ideas that fit what each kind of app does. Only things the store supports: private per wallet, or public to read. */
const IDEAS: Partial<Record<ContractKind, BackendIdea[]>> = {
  savings: [
    idea("Member profiles", "Each member saves a name and phone number for the group", "let each member save a display name and phone number, private to them, and show their own profile once they sign in."),
    idea("Group notice board", "Members post short notes everyone can read", "add a notice board where signed-in members post short notes that everyone in the app can read, newest first."),
  ],
  tips: [
    idea("Thank-you wall", "Supporters leave a public message", "let supporters leave a short public thank-you message after tipping, shown as a wall of the latest messages."),
    idea("Supporter profiles", "Supporters save a display name", "let each supporter save a display name, private to them, and use it in their own view."),
  ],
  tickets: [
    idea("Attendee details", "Ticket holders save their name and notes", "let each ticket holder save their name and any notes for the event, private to them."),
    idea("Event updates", "Public updates for everyone", "add an event updates list that anyone can read, where signed-in people can post updates."),
  ],
  crowdfund: [
    idea("Backer comments", "Public comments on the campaign", "let signed-in backers leave public comments on the campaign, newest first."),
    idea("Campaign updates", "Public news from the organiser", "add a public updates feed for the campaign that anyone can read."),
  ],
  vote: [
    idea("Discussion", "People explain their choice in public", "let signed-in people post a short public comment on each proposal, newest first."),
    idea("Saved drafts", "Draft a proposal before submitting", "let each person save proposal drafts, private to them, before they submit on-chain."),
  ],
  site: [
    idea("Booking requests", "Customers book a time without a wallet, only you see who", "add a booking form anyone can use without signing in or a wallet: name, phone, day and time. Only I, the app's owner, can read names and phone numbers, everyone can see which day and time slots are taken, and a slot can't be booked twice. The form must say that the owner sees their name and phone."),
    idea("Guestbook", "Visitors sign a public guestbook", "add a guestbook where signed-in visitors leave a short public message."),
    idea("Saved favourites", "Visitors keep their own list", "let each visitor save favourites, private to them, and see them again next visit."),
  ],
};

const GENERAL: BackendIdea[] = [
  idea("Email sign-in", "Visitors sign in with a code sent to their email, no wallet", "let visitors sign in with a 6-digit code sent to their email, as well as with a wallet. Turn on email sign-in in the data rules, add a clear sign-in screen with the email and code steps, and keep each person's saved things private to them."),
  idea("Contact form", "Visitors send a message without signing in, only you read it", "add a contact form anyone can send without signing in or a wallet. Only I, the app's owner, can read the messages, and the form says so. Store name, email or phone, and the message."),
  idea("Profiles", "Each person saves their own details", "let each person save a display name and short bio, private to them, and show it once they sign in."),
  idea("Public posts", "People post things everyone can read", "let signed-in people post short entries that everyone can read, newest first, and delete their own."),
];

const DECIDE: BackendIdea = idea("Let the builder decide", "It adds saved data where it helps this app", "decide what this app should remember between visits, add it where it helps most, and tell me what you added.");

/** Two ideas for this app, two general ones, and "let the builder decide". No typing needed. */
export function backendIdeas(project: { name: string; templateId?: string | null }): BackendIdea[] {
  const kind = inferKind({ templateId: project.templateId, text: project.name });
  return [...[...(IDEAS[kind] ?? []).slice(0, 2), ...GENERAL].slice(0, 5), DECIDE];
}

export function BackendButton({ on, disabled, onOpen, compact, className }: { on: boolean; disabled: boolean; onOpen: () => void; compact?: boolean; className?: string }) {
  return (
    <Button variant="secondary" className={className} aria-label="Backend" disabled={disabled} title="Save data for the people who use your app, and see what they sent" onClick={onOpen}>
      <span className="relative inline-flex">
        <Database className="size-4" aria-hidden />
        {on && <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-pink" aria-hidden />}
      </span>
      <span className={compact ? "hidden 2xl:inline" : undefined}>Backend</span>
    </Button>
  );
}

export function BackendModal({
  open,
  onOpenChange,
  projectId,
  project,
  files,
  published,
  busy,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  project: { name: string; templateId?: string | null };
  files: Record<string, string>;
  published: boolean;
  busy: boolean;
  onSend: (prompt: string) => void;
}) {
  const state = backendState(files);
  const ideas = backendIdeas(project);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[560px]">
        <p className="eyebrow pr-10">Backend</p>
        <DialogTitle className="display mt-2 pr-10 text-[28px] font-extrabold">{state.on ? "Your app saves data" : "Add a backend"}</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-grey-600">
          Built in, with nothing to set up. Personal areas use wallet sign-in, forms can work without one, and each app&apos;s data is kept apart from every other app.
        </DialogDescription>

        {state.on && (
          <div className="mt-5 rounded-block bg-canvas p-4">
            <p className="text-[11px] font-semibold tracking-[.18em] text-violet uppercase">What it saves</p>
            {state.collections.length ? (
              <ul className="mt-2 space-y-2">
                {state.collections.map((c) => (
                  <li key={c.name} className="flex items-start gap-3">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", c.everyone ? "bg-pink" : "bg-violet")} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium break-words">{c.name}</span>
                      <span className="block text-xs text-grey-600">
                        {c.who}
                        {c.publicFields.length > 0 && `. Everyone sees: ${c.publicFields.join(", ")}`}
                        {c.noSignIn && ". No sign-in needed to send"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-grey-600">Private records: each person sees only what they saved.</p>
            )}
            <p className="mt-3 text-xs text-grey-600">
              {published ? "Live on your published app." : "In the preview, data stays in this browser. Publish your app to save it for real."}
            </p>
            {published && <AppDataRow projectId={projectId} />}
          </div>
        )}
        {state.on && <Submissions projectId={projectId} />}

        <p className="mt-5 text-sm font-medium">{state.on ? "Add more" : "Pick what your app should remember"}</p>
        <div className="mt-2 space-y-2" role="group" aria-label="Backend ideas">
          {ideas.map((i) => (
            <button
              key={i.label}
              type="button"
              disabled={busy}
              onClick={() => {
                onSend(i.prompt);
                onOpenChange(false);
              }}
              className="flex w-full items-center gap-3 rounded-block bg-canvas p-3 text-left outline-none transition-colors duration-200 ease-gb hover:bg-tint focus-visible:shadow-focus disabled:opacity-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{i.label}</span>
                <span className="block text-xs text-grey-600">{i.detail}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-violet" aria-hidden />
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-grey-600">{busy ? "Wait for the current build to finish." : "Picking one starts a build. Money and ownership stay in your contract."}</p>
      </DialogContent>
    </Dialog>
  );
}

interface OwnerPage {
  collections: string[];
  collection?: string;
  records: { key: string; owner: string | null; value: unknown; createdAt: string }[];
}

/** Text only: entries come from strangers, and this runs on GoodBuild's own origin. */
function entryText(value: unknown): { label: string; text: string }[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).map(([label, v]) => ({ label, text: typeof v === "object" ? JSON.stringify(v) : String(v) }));
  }
  return [{ label: "value", text: JSON.stringify(value) }];
}

/** What visitors sent to the published app, for collections its owner may read (D34). */
export function Submissions({ projectId }: { projectId: string }) {
  const [page, setPage] = React.useState<OwnerPage | null>(null);
  const [collection, setCollection] = React.useState<string | undefined>();
  const [error, setError] = React.useState(false);

  const load = React.useCallback(
    (name?: string) => {
      const query = name ? `?collection=${encodeURIComponent(name)}` : "";
      void fetch(`/api/projects/${projectId}/app-data/records${query}`)
        .then((r) => (r.ok ? (r.json() as Promise<OwnerPage>) : Promise.reject(new Error(String(r.status)))))
        .then((p) => {
          setPage(p);
          setError(false);
        })
        .catch(() => setError(true));
    },
    [projectId],
  );
  React.useEffect(() => load(collection), [load, collection]);

  if (error) return <p className="mt-4 text-xs text-grey-600">Couldn&apos;t load what visitors sent. Try again in a moment.</p>;
  if (!page || page.collections.length === 0) return null;
  const current = page.collection ?? page.collections[0];

  async function remove(owner: string | null, key: string) {
    if (!owner || !window.confirm("Delete this entry? It can't be undone.")) return;
    const query = new URLSearchParams({ collection: current, owner, key });
    await fetch(`/api/projects/${projectId}/app-data/records?${query}`, { method: "DELETE" });
    load(current);
  }

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">What visitors sent</p>
        <a className="inline-flex items-center gap-1.5 text-xs font-medium text-violet hover:underline" href={`/api/projects/${projectId}/app-data/records?collection=${encodeURIComponent(current)}&format=csv`}>
          <Download className="size-3.5" aria-hidden />
          Download CSV
        </a>
      </div>
      {page.collections.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Collections">
          {page.collections.map((name) => (
            <Button key={name} role="tab" aria-selected={name === current} size="chip" variant={name === current ? "chipSelected" : "chip"} onClick={() => setCollection(name)}>
              {name}
            </Button>
          ))}
        </div>
      )}
      {page.records.length === 0 ? (
        <p className="mt-2 text-xs text-grey-600">Nothing yet. Entries appear here once your published app gets some.</p>
      ) : (
        <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
          {page.records.map((r) => (
            <li key={`${r.owner}/${r.key}`} className="flex items-start gap-3 rounded-block bg-canvas p-3">
              <dl className="min-w-0 flex-1 space-y-0.5 text-sm">
                {entryText(r.value).map(({ label, text }) => (
                  <div key={label} className="flex gap-2">
                    <dt className="shrink-0 text-grey-600">{label}</dt>
                    <dd className="min-w-0 break-words">{text}</dd>
                  </div>
                ))}
                <div className="text-xs text-grey-400">{new Date(r.createdAt).toLocaleString()}</div>
              </dl>
              <Button variant="ghost" size="icon" aria-label="Delete this entry" onClick={() => void remove(r.owner, r.key)}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
