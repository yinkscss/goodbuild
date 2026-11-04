"use client";

import * as React from "react";
import { ArrowUp, ImageIcon, ImagePlus, Loader2, X } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatMicroUsd } from "@/lib/pricing";
import type { AssetInfo, AssetKind } from "@/server/agent/assets";
import { isSubmitShortcut } from "@/lib/prompt";
import type { TurnMode, TurnRecord } from "@/lib/turn-types";
import { cn } from "@/lib/utils";
import { TurnView } from "./turn-view";
import type { UseWorkspace } from "./use-workspace";

const FIX_PROMPT = "Fix the remaining errors from the last build.";

/** Left pane of the workspace (mockup c): the conversation and the composer. */
export function ChatPanel({ ws, assetUrls = {} }: { ws: UseWorkspace; assetUrls?: Record<string, string> }) {
  const { state, live, queue, running, send } = ws;
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [state.messages.length, live?.text, live?.record.steps.length, live?.record.log.length]);

  const liveMessageId = live?.messageId;
  // Chips only on the newest assistant turn, and not while another turn runs or waits.
  const lastAssistantId = [...state.messages].reverse().find((m) => m.role === "assistant")?.id;
  const suggest = (prompt: string) => send(prompt, "build");
  const canSuggest = !running && queue.length === 0;
  return (
    <section aria-label="Chat" className="flex min-h-0 flex-col rounded-card bg-surface shadow-card">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5" aria-live="polite">
        {state.messages.map((m) => {
          if (m.id === liveMessageId) return null;
          if (m.role === "user") {
            return (
              <div key={m.id} className="flex flex-col items-end gap-1">
                <p className="max-w-[85%] rounded-block rounded-br-md bg-tint px-4 py-3 text-sm whitespace-pre-wrap">{m.content}</p>
                {(m.meta as { mode?: TurnMode } | null)?.mode === "plan" && <span className="text-[11px] text-grey-400">Plan mode</span>}
              </div>
            );
          }
          if (m.role === "system") {
            return (
              <p key={m.id} className="text-center text-xs text-grey-600">
                {m.content}
              </p>
            );
          }
          const record = m.meta as TurnRecord | null;
          if (!record || record.kind !== "turn") return <p key={m.id} className="text-sm">{m.content}</p>;
          if (m.status === "streaming") {
            return (
              <p key={m.id} className="flex items-center gap-2 text-sm text-grey-600">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Building in another tab… this updates when it finishes.
              </p>
            );
          }
          return (
            <TurnView
              key={m.id}
              text={m.content}
              record={record}
              live={false}
              onFix={() => send(FIX_PROMPT, "build")}
              fixDisabled={running}
              onSuggest={!live && canSuggest && m.id === lastAssistantId ? suggest : undefined}
            />
          );
        })}
        {live && (
          <TurnView
            text={live.text}
            record={live.record}
            live={live.phase === "running"}
            onFix={() => send(FIX_PROMPT, "build")}
            fixDisabled={live.phase === "running"}
            onSuggest={live.phase === "done" && queue.length === 0 ? suggest : undefined}
          />
        )}
        {queue.map((q) => (
          <div key={q.id} className="flex flex-col items-end gap-1 opacity-60">
            <p className="max-w-[85%] rounded-block rounded-br-md bg-tint px-4 py-3 text-sm whitespace-pre-wrap">{q.prompt}</p>
            <span className="text-[11px] text-grey-400">Queued, runs after the current build</span>
          </div>
        ))}
        {ws.error && (
          <p className="flex items-start gap-2 rounded-block bg-canvas px-4 py-3 text-sm" role="alert">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
            {ws.error}
          </p>
        )}
        <div ref={endRef} />
      </div>
      <Composer
        assets={state.assets}
        assetUrls={assetUrls}
        onUpload={ws.upload}
        onRemove={ws.removeAsset}
        uploading={ws.uploading}
        running={running}
        estimate={state.estimate}
        onSend={send}
        placeholder={
          state.messages.length ? 'Ask for a change… e.g. "let members vote to skip a week"' : "Describe the dApp you want to build…"
        }
      />
    </section>
  );
}

const KIND_LABEL: Record<AssetKind, string> = { logo: "Logo", image: "Image", reference: "Design reference" };
const KIND_HELP: Record<AssetKind, string> = {
  logo: "Shown in the header and as the favicon; colours come from it",
  image: "A photo or illustration to use on the site",
  reference: "A screenshot or mockup to match (not shown in the app)",
};

/** Uploaded files as chips above the composer, with the attach menu (DESIGN_SYSTEM §3 prompt box). */
function AssetBar({
  assets,
  assetUrls,
  onRemove,
}: {
  assets: AssetInfo[];
  assetUrls: Record<string, string>;
  onRemove: (id: string) => void;
}) {
  if (!assets.length) return null;
  return (
    <ul className="mb-3 flex flex-wrap gap-2" aria-label="Uploaded files">
      {assets.map((a) => (
        <li key={a.id} className="flex items-center gap-2 rounded-full bg-tint py-1 pr-1.5 pl-1 text-[13px] font-medium text-violet" title={a.description || a.name}>
          {assetUrls[a.name] ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL thumbnail
            <img src={assetUrls[a.name]} alt="" className="size-6 rounded-full bg-surface object-cover" />
          ) : (
            <ImageIcon className="size-4" aria-hidden />
          )}
          <span className="max-w-[9rem] truncate">{a.name}</span>
          <span className="text-[11px] font-normal text-grey-600">{KIND_LABEL[a.kind]}</span>
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            aria-label={`Remove ${a.name}`}
            className="grid size-5 place-items-center rounded-full text-grey-600 outline-none hover:bg-surface hover:text-violet focus-visible:shadow-focus"
          >
            <X className="size-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function AttachMenu({ onUpload, uploading }: { onUpload: (file: File, kind: AssetKind) => void; uploading: boolean }) {
  const input = React.useRef<HTMLInputElement>(null);
  const kind = React.useRef<AssetKind>("image");
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file, kind.current);
          e.target.value = "";
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Attach an image"
            title="Attach a logo, image or design reference"
            className="grid size-8 place-items-center rounded-full bg-surface text-grey-600 outline-none hover:text-violet focus-visible:shadow-focus disabled:opacity-55"
            disabled={uploading}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Attach</DropdownMenuLabel>
          {(["logo", "image", "reference"] as const).map((k) => (
            <DropdownMenuItem
              key={k}
              onSelect={() => {
                kind.current = k;
                // Let the menu close before the file dialog opens.
                setTimeout(() => input.current?.click(), 0);
              }}
            >
              <span className="min-w-0">
                <span className="block font-medium">{KIND_LABEL[k]}</span>
                <span className="block text-xs text-grey-600">{KIND_HELP[k]}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <p className="px-3 py-2 text-[11px] text-grey-600">PNG, JPEG, WebP or SVG, up to 5 MB.</p>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function Composer({
  assets,
  assetUrls,
  onUpload,
  onRemove,
  uploading,
  running,
  estimate,
  onSend,
  placeholder,
}: {
  assets: AssetInfo[];
  assetUrls: Record<string, string>;
  onUpload: (file: File, kind: AssetKind) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  uploading: boolean;
  running: boolean;
  estimate: { buildMicro: number; planMicro: number };
  onSend: (prompt: string, mode: TurnMode) => void;
  placeholder: string;
}) {
  const [value, setValue] = React.useState("");
  const [mode, setMode] = React.useState<TurnMode>("build");
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 6 * 22 + 8)}px`;
  }, [value]);

  function submit() {
    if (!value.trim()) return;
    onSend(value, mode);
    setValue("");
  }

  const est = mode === "plan" ? estimate.planMicro : estimate.buildMicro;
  return (
    <form
      className="m-4 mt-0 rounded-block bg-canvas p-3 focus-within:shadow-focus"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <AssetBar assets={assets} assetUrls={assetUrls} onRemove={(id) => void onRemove(id)} />
      <label htmlFor="composer" className="sr-only">
        Message GoodBuild
      </label>
      <textarea
        id="composer"
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, isComposing: e.nativeEvent.isComposing })) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="block w-full resize-none bg-transparent px-1 text-sm leading-[22px] outline-none placeholder:text-grey-400 focus-visible:shadow-none"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
        <AttachMenu onUpload={(f, k) => void onUpload(f, k)} uploading={uploading} />
        <div className="flex rounded-full bg-surface p-1 text-xs font-medium" role="radiogroup" aria-label="Mode">
          {(["build", "plan"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              title={m === "plan" ? "Plan mode answers and drafts a plan without changing files" : "Build mode changes your app"}
              className={cn(
                "rounded-full px-3 py-1 capitalize outline-none focus-visible:shadow-focus",
                mode === m ? "bg-violet text-white" : "text-grey-600 hover:text-violet",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-grey-400" title="Estimated charge for this request: AI cost + 25% (free during the testnet beta)">
            ≈ {formatMicroUsd(est)} {running ? "· runs after this build" : ""}
          </span>
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label={running ? "Queue message" : "Send"}
            className="grid size-9 place-items-center rounded-full bg-violet text-white outline-none hover:bg-violet/92 focus-visible:shadow-focus disabled:opacity-55"
          >
            <ArrowUp className="size-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </form>
  );
}
