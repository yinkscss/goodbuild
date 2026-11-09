"use client";

import * as React from "react";
import { ChevronDown, ImagePlus, LayoutTemplate, Sparkles, X } from "lucide-react";

import { ActionButton, Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NetworkToggle } from "@/components/prompt/network-toggle";
import { DEFAULT_NETWORK, type NetworkId } from "@/config/networks";
import { getPageTemplate } from "@/config/page-template-data";
import { TEMPLATE_EXAMPLE } from "@/config/page-templates";
import { TemplateSlides } from "@/components/landing/template-slides";
import { TEMPLATES, getTemplate, type StarterTemplate } from "@/config/templates";
import {
  PROMPT_MAX_LENGTH,
  PROMPT_MIN_ROWS,
  canSubmitPrompt,
  isSubmitShortcut,
  normalisePrompt,
  rowsForContent,
} from "@/lib/prompt";
import { cn } from "@/lib/utils";

export interface PromptSubmission {
  prompt: string;
  templateId: string | null;
  network: NetworkId;
  attachment: File | null;
}

export interface PromptBoxHandle {
  /** Fill the prompt from a template (used by empty-state chips) and focus it. */
  fill: (template: StarterTemplate) => void;
  focus: () => void;
}

export interface PromptBoxProps {
  ref?: React.Ref<PromptBoxHandle>;
  /** "inside" (landing) or "below" the card (home, mockup b). */
  chipsPlacement?: "inside" | "below";
  /** Replaces the credits hint, e.g. "Free during the testnet beta". */
  hint?: React.ReactNode;
  /** Example chips shown under the textarea. */
  chips?: StarterTemplate[];
  /** Right-hand hint, e.g. "120 G$". */
  creditsLabel?: string;
  /** Called with a normalised prompt. Return a promise to show a pending state. */
  onSubmit: (submission: PromptSubmission) => void | Promise<void>;
  /** Wired in M4 (agent). Without it the Enhance button is disabled. */
  onEnhance?: (prompt: string) => Promise<string>;
  mainnetEnabled?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  initialValue?: string;
  submitLabel?: string;
  className?: string;
  /** Line under the toolbar (e.g. "Prompt saved, sign in to send"). */
  status?: React.ReactNode;
}

const LINE_HEIGHT_PX = 28; // 18px text, leading-7
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * The hero prompt box (DESIGN_SYSTEM §3): auto-growing 18px textarea (2 to 8 rows),
 * attach, template picker, network toggle, Enhance, example chips, credits hint and
 * the violet Build it button. Cmd/Ctrl+Enter submits.
 */
export function PromptBox({
  ref,
  chipsPlacement = "inside",
  hint,
  chips = [],
  creditsLabel,
  onSubmit,
  onEnhance,
  mainnetEnabled = false,
  disabled = false,
  disabledReason,
  initialValue = "",
  submitLabel = "Build it",
  className,
  status,
}: PromptBoxProps) {
  const id = React.useId();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [value, setValue] = React.useState(initialValue);
  const [rows, setRows] = React.useState(PROMPT_MIN_ROWS);
  const [templateId, setTemplateId] = React.useState<string | null>(null);
  const [picked, setNetwork] = React.useState<NetworkId>(DEFAULT_NETWORK);
  // Mainnet is the default, but a wallet it is not open to builds on Sepolia.
  const network: NetworkId = picked === "celo" && !mainnetEnabled ? "celo-sepolia" : picked;
  const [attachment, setAttachment] = React.useState<File | null>(null);
  const [attachError, setAttachError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [enhancing, setEnhancing] = React.useState(false);

  const sendable = canSubmitPrompt(value, disabled || pending);

  // Auto-grow: measure with rows reset to the minimum, then pick 2..8.
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.rows = PROMPT_MIN_ROWS;
    const next = rowsForContent(el.scrollHeight, LINE_HEIGHT_PX);
    el.rows = next; // keep the DOM in sync even when state doesn't change
    setRows(next);
  }, [value]);

  async function submit() {
    if (!canSubmitPrompt(value, disabled || pending)) return;
    setPending(true);
    try {
      await onSubmit({ prompt: normalisePrompt(value), templateId, network, attachment });
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isSubmitShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, isComposing: e.nativeEvent.isComposing })) {
      e.preventDefault();
      void submit();
    }
  }

  function fillFromTemplate(t: StarterTemplate) {
    setTemplateId(t.id);
    // A gallery template is attached, not typed in: its brief stays behind the scenes and the person
    // writes their own request. A dApp starter fills a ready-made prompt they can edit.
    if (getPageTemplate(t.id)) setValue((v) => (v.trim() ? v : ""));
    else setValue(t.examplePrompt);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setAttachError("Attach an image or a sketch (PNG, JPG, WebP).");
    if (file.size > MAX_ATTACHMENT_BYTES) return setAttachError("That image is over 5 MB.");
    setAttachError(null);
    setAttachment(file);
  }

  async function enhance() {
    if (!onEnhance || !value.trim()) return;
    setEnhancing(true);
    try {
      setValue(await onEnhance(value));
    } finally {
      setEnhancing(false);
    }
  }

  React.useImperativeHandle(ref, () => ({ fill: fillFromTemplate, focus: () => textareaRef.current?.focus() }));

  const selectedTemplate = templateId ? getTemplate(templateId) : undefined;
  const pageTemplate = getPageTemplate(templateId);
  const placeholder = pageTemplate ? `Say what you want to build with this template, ${TEMPLATE_EXAMPLE[pageTemplate.category]}` : "Describe the dApp you want to build…";
  const [previewing, setPreviewing] = React.useState(false);
  const empty = value.length === 0;

  function chipRow(spacing: string) {
    if (chips.length === 0) return null;
    return (
      <div className={cn("flex flex-wrap gap-2", spacing)} role="group" aria-label="Example prompts">
        {chips.map((chip) => (
          <Button
            key={chip.id}
            type="button"
            size="chip"
            variant={templateId === chip.id && value === chip.examplePrompt ? "chipSelected" : "chip"}
            onClick={() => fillFromTemplate(chip)}
          >
            {chip.label}
          </Button>
        ))}
      </div>
    );
  }

  const card = (
    <form
      className={cn("rounded-card bg-surface p-5 shadow-card md:p-6", chipsPlacement === "inside" && className)}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {pageTemplate && (
        <div
          className="mb-4 flex items-center gap-4 rounded-block bg-canvas p-2 pr-3"
          onPointerEnter={() => setPreviewing(true)}
          onPointerLeave={() => setPreviewing(false)}
        >
          <TemplateSlides template={pageTemplate} playing={previewing} sizes="160px" className="w-40 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Template</p>
            <p className="truncate text-base font-semibold">{pageTemplate.label}</p>
            <p className="text-xs text-grey-600">The design is attached. Write what you want and change anything you like, nothing is sent until you press {submitLabel}.</p>
          </div>
          <button
            type="button"
            onClick={() => setTemplateId(null)}
            className="grid size-7 shrink-0 place-items-center rounded-full text-grey-600 hover:bg-tint hover:text-violet"
            aria-label={`Remove the ${pageTemplate.label} template`}
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      <label htmlFor={`${id}-prompt`} className="sr-only">
        {pageTemplate ? `Describe what you want to build with the ${pageTemplate.label} template` : "Describe the dApp you want to build"}
      </label>
      <div className="relative">
        {empty && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 flex items-center text-[18px] leading-7 text-grey-400"
          >
            <span className="mr-1 inline-block h-5 w-[2px] rounded-full bg-violet animate-caret motion-reduce:animate-none" />
            {placeholder}
          </span>
        )}
        <textarea
          ref={textareaRef}
          id={`${id}-prompt`}
          rows={rows}
          value={value}
          maxLength={PROMPT_MAX_LENGTH}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby={`${id}-hint`}
          className="block w-full resize-none bg-transparent text-[18px] leading-7 text-ink outline-none placeholder:text-transparent focus-visible:shadow-none"
        />
      </div>

      {(attachment || attachError) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {attachment && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas py-1 pr-1 pl-3 text-grey-600">
              <ImagePlus className="size-3.5" aria-hidden />
              <span className="max-w-[14rem] truncate">{attachment.name}</span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="grid size-5 place-items-center rounded-full hover:bg-tint hover:text-violet"
                aria-label={`Remove ${attachment.name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          )}
          {attachError && <span className="text-danger">{attachError}</span>}
        </div>
      )}

      {chipsPlacement === "inside" && chipRow("mt-3")}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} tabIndex={-1} />
          <Button
            type="button"
            variant="quiet"
            size="icon"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach an image or sketch"
            title="Attach an image or sketch"
          >
            <ImagePlus />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="quiet" size="sm" aria-label="Choose a template">
                <LayoutTemplate className="size-3.5" />
                <span className="max-w-[9rem] truncate">{selectedTemplate ? selectedTemplate.label : "Template"}</span>
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Start from a template</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={templateId ?? ""}
                onValueChange={(v) => {
                  const t = getTemplate(v);
                  if (t) fillFromTemplate(t);
                }}
              >
                {TEMPLATES.map((t) => (
                  <DropdownMenuRadioItem key={t.id} value={t.id}>
                    <span>
                      <span className="block font-medium">{t.label}</span>
                      <span className="block text-xs text-grey-600">{t.description}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <NetworkToggle value={network} onChange={setNetwork} mainnetEnabled={mainnetEnabled} />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={enhance}
            disabled={!onEnhance || !value.trim() || enhancing}
            title={onEnhance ? "Rewrite this prompt with more detail" : "Enhance is available once you're signed in"}
          >
            <Sparkles className="size-3.5" />
            {enhancing ? "Enhancing…" : "Enhance prompt"}
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <span id={`${id}-hint`} className="hidden text-xs text-grey-400 sm:inline">
            {disabled && disabledReason ? (
              <span className="text-warning">{disabledReason}</span>
            ) : hint ? (
              hint
            ) : (
              <>
                {creditsLabel && (
                  <>
                    credits: <b className="font-semibold text-ink/70">{creditsLabel}</b>
                    <span className="mx-1.5">·</span>
                  </>
                )}
                <kbd className="font-sans">⌘/Ctrl ↵</kbd>
              </>
            )}
          </span>
          <ActionButton type="submit" disabled={!sendable} aria-busy={pending}>
            {pending ? "Sending…" : submitLabel}
          </ActionButton>
        </div>
      </div>

      {status && <div className="mt-3 text-xs text-grey-600" role="status">{status}</div>}
    </form>
  );

  if (chipsPlacement === "inside") return card;
  return (
    <div className={className}>
      {card}
      {chipRow("mt-4")}
    </div>
  );
}
