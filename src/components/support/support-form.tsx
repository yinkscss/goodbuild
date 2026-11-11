"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MAX_MESSAGE_LENGTH, TOPIC_OPTIONS } from "./topics";

const field = "mt-1.5 w-full rounded-[16px] bg-surface px-4 py-3 text-base text-ink shadow-card outline-none placeholder:text-grey-400 focus-visible:shadow-focus";

export function SupportForm({ telegramUrl }: { telegramUrl: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), topic: form.get("topic"), message: form.get("message"), website: form.get("website") }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setState("idle");
        return;
      }
      setTicket(data.id);
      setState("sent");
    } catch {
      setError("We couldn't reach GoodBuild. Check your connection and try again.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div role="status" className="rounded-[16px] bg-tint p-6">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <CheckCircle2 className="size-5 text-success" aria-hidden /> Ticket sent
        </p>
        <p className="mt-2">
          Your ticket number is <b className="font-semibold text-ink">{ticket}</b>. We&apos;ll reply to the email you gave. For a faster answer, you can also{" "}
          <a className="text-violet hover:underline" href={telegramUrl} target="_blank" rel="noreferrer">message us on Telegram</a>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <label className="block text-sm font-medium text-ink">
        Your email
        <input name="email" type="email" required autoComplete="email" maxLength={254} placeholder="you@example.com" className={field} />
        <span className="mt-1 block text-xs font-normal text-grey-600">We reply here.</span>
      </label>
      <label className="block text-sm font-medium text-ink">
        What is it about?
        <select name="topic" defaultValue="question" className={field}>
          {TOPIC_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-ink">
        Tell us what happened
        <textarea name="message" required minLength={10} maxLength={MAX_MESSAGE_LENGTH} rows={6} placeholder="What were you trying to do, and what did you see instead? If it's about an app, paste its link." className={field} />
      </label>
      {/* Hidden from people. Bots fill it, and their ticket is dropped. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Send ticket"}
      </Button>
    </form>
  );
}
