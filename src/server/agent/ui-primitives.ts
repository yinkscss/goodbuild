/**
 * Ten more UI pieces for every generated app (D89): dialog, sheet, tabs, select, dropdown menu,
 * tooltip, toast, accordion, avatar and switch. Before these the starter had eight (button, card,
 * input, textarea, label, badge, skeleton, notice), so every modal, tab bar and menu was written
 * by hand by the builder, differently each time and usually without the keyboard and screen-reader
 * behaviour that makes one usable.
 *
 * No package. The names follow shadcn/ui where the shape is the same (Dialog, DialogContent, Tabs,
 * TabsTrigger, Accordion...), because that is what the builder already expects to write. Where the
 * browser does the job better than script, the browser does it:
 * - Dialog and Sheet are the native <dialog> opened with showModal(): the browser traps focus, makes
 *   the page behind inert, closes on Escape and gives focus back, on every phone these apps meet.
 * - Select is the native <select>, styled. On a phone that is the system picker, which no custom
 *   list beats, and it is a different API from shadcn's on purpose.
 *
 * The source below is plain strings on purpose: no backticks and no ${ in it.
 */

const UI_CSS = `/* GoodBuild UI pieces: the small movements of dialogs, sheets, menus and toasts. */
@keyframes ui-pop {
  from {
    opacity: 0;
    transform: translate3d(0, 8px, 0) scale(0.98);
  }
}
@keyframes ui-fade {
  from {
    opacity: 0;
  }
}
@keyframes ui-from-right {
  from {
    transform: translate3d(100%, 0, 0);
  }
}
@keyframes ui-from-left {
  from {
    transform: translate3d(-100%, 0, 0);
  }
}
@keyframes ui-from-bottom {
  from {
    transform: translate3d(0, 100%, 0);
  }
}
@keyframes ui-from-top {
  from {
    transform: translate3d(0, -100%, 0);
  }
}
.ui-pop {
  animation: ui-pop 0.18s ease-out;
}
.ui-fade {
  animation: ui-fade 0.15s ease-out;
}
.ui-from-right {
  animation: ui-from-right 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
.ui-from-left {
  animation: ui-from-left 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
.ui-from-bottom {
  animation: ui-from-bottom 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
.ui-from-top {
  animation: ui-from-top 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
dialog.ui-modal::backdrop {
  background: rgb(0 0 0 / 0.5);
  animation: ui-fade 0.15s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .ui-pop,
  .ui-fade,
  .ui-from-right,
  .ui-from-left,
  .ui-from-bottom,
  .ui-from-top,
  dialog.ui-modal::backdrop {
    animation: none;
  }
}
`;

const DIALOG = `import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import "./ui.css";

interface ModalState {
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
}

const ModalContext = React.createContext<ModalState | null>(null);

export function useModal(part: string): ModalState {
  const state = React.useContext(ModalContext);
  if (!state) throw new Error(part + " must be inside <Dialog> or <Sheet>.");
  return state;
}

export interface ModalRootProps {
  /** Controlled: pass open and onOpenChange. Leave both out and the trigger opens it. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

/** A window over the page for one focused task: confirm, a short form, details. Not for a whole page. */
export function Dialog({ open, defaultOpen = false, onOpenChange, children }: ModalRootProps) {
  const [inner, setInner] = React.useState(defaultOpen);
  const isOpen = open ?? inner;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (open === undefined) setInner(next);
      onOpenChange?.(next);
    },
    [open, onOpenChange],
  );
  const id = React.useId();
  const state = React.useMemo(() => ({ open: isOpen, setOpen, titleId: id + "title", descriptionId: id + "description" }), [isOpen, setOpen, id]);
  return <ModalContext.Provider value={state}>{children}</ModalContext.Provider>;
}

type TriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Use the child (a Button, say) as the trigger instead of wrapping it in another button. */
  asChild?: boolean;
};

/** Opens (or with close, closes) the dialog it is inside. */
function ModalButton({ asChild, children, onClick, to, part, ...props }: TriggerProps & { to: boolean; part: string }) {
  const { open, setOpen } = useModal(part);
  const expanded = to ? { "aria-haspopup": "dialog" as const, "aria-expanded": open } : {};
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: (event: React.MouseEvent<HTMLElement>) => void }>;
    return React.cloneElement(child, {
      ...expanded,
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        child.props.onClick?.(event);
        if (!event.defaultPrevented) setOpen(to);
      },
    });
  }
  return (
    <button
      type="button"
      {...expanded}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(to);
      }}
    >
      {children}
    </button>
  );
}

export function DialogTrigger(props: TriggerProps) {
  return <ModalButton {...props} to={true} part="DialogTrigger" />;
}

export function DialogClose(props: TriggerProps) {
  return <ModalButton {...props} to={false} part="DialogClose" />;
}

/**
 * The surface both Dialog and Sheet draw on: the browser's own modal <dialog>. It keeps focus inside,
 * closes on Escape or a tap outside, stops the page behind from scrolling, and gives focus back.
 */
export function ModalSurface({ className, children, showClose = true, part = "DialogContent" }: { className?: string; children: React.ReactNode; showClose?: boolean; part?: string }) {
  const { open, setOpen, titleId, descriptionId } = useModal(part);
  const ref = React.useRef<HTMLDialogElement>(null);
  const pressedOutside = React.useRef(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!open) {
      if (el.open) el.close();
      return;
    }
    if (!el.open) {
      try {
        el.showModal();
      } catch {
        // A very old browser: show it in place, without the backdrop.
        el.setAttribute("open", "");
      }
    }
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      // Escape: the browser asks to close. Say so to whoever holds the state.
      onCancel={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
      onClose={() => {
        if (open) setOpen(false);
      }}
      // A tap on the dimmed page lands on the dialog element itself, never on what is inside it. Both the
      // press and the release must be out there, so dragging to select text inside doesn't close it.
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedOutside.current) setOpen(false);
      }}
      className={cn("ui-modal fixed inset-0 overflow-y-auto border border-border bg-card p-0 text-foreground shadow-xl outline-none", className)}
    >
      {open ? (
        <div className="relative flex min-h-full flex-col gap-4 p-6">
          {children}
          {showClose ? (
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute right-3 top-3 grid size-9 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40">
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

/** What the dialog shows. Give it a DialogTitle: screen readers announce the dialog by it. */
export function DialogContent({ className, children, showClose }: { className?: string; children: React.ReactNode; showClose?: boolean }) {
  return (
    <ModalSurface showClose={showClose} className={cn("ui-pop m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-md rounded-xl", className)}>
      {children}
    </ModalSurface>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 pr-8", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useModal("DialogTitle");
  return <h2 id={titleId} className={cn("text-lg font-semibold leading-tight", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useModal("DialogDescription");
  return <p id={descriptionId} className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

/** The buttons at the bottom: stacked on a phone with the main one first, in a row on wider screens. */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}
`;

const SHEET = `import * as React from "react";
import { cn } from "../../lib/utils";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, ModalSurface, type ModalRootProps } from "./dialog";

const sides = {
  right: "ui-from-right m-0 ml-auto h-full max-h-none w-[min(24rem,88vw)] max-w-none",
  left: "ui-from-left m-0 mr-auto h-full max-h-none w-[min(24rem,88vw)] max-w-none",
  bottom: "ui-from-bottom m-0 mt-auto max-h-[85vh] w-full max-w-none rounded-t-2xl",
  top: "ui-from-top m-0 mb-auto max-h-[85vh] w-full max-w-none rounded-b-2xl",
};

/**
 * A panel that slides in from an edge: the menu on a phone (side="left" or "right"), filters, a
 * cart, or an action sheet a thumb can reach (side="bottom"). Same parts and behaviour as Dialog.
 */
export function Sheet(props: ModalRootProps) {
  return <Dialog {...props} />;
}

export function SheetContent({ side = "right", className, children, showClose }: { side?: keyof typeof sides; className?: string; children: React.ReactNode; showClose?: boolean }) {
  return (
    <ModalSurface part="SheetContent" showClose={showClose} className={cn(sides[side], className)}>
      {children}
    </ModalSurface>
  );
}

export const SheetTrigger = DialogTrigger;
export const SheetClose = DialogClose;
export const SheetHeader = DialogHeader;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;
export const SheetFooter = DialogFooter;
`;

const TABS = `import * as React from "react";
import { cn } from "../../lib/utils";

interface TabsState {
  value: string;
  setValue: (value: string) => void;
  id: string;
}

const TabsContext = React.createContext<TabsState | null>(null);

function useTabs(part: string): TabsState {
  const state = React.useContext(TabsContext);
  if (!state) throw new Error(part + " must be inside <Tabs>.");
  return state;
}

/** Views of one thing that share a place on the page: Buy / Sell, Overview / Activity. Not for pages (use routes). */
export function Tabs({
  value,
  defaultValue = "",
  onValueChange,
  className,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [inner, setInner] = React.useState(defaultValue);
  const current = value ?? inner;
  const id = React.useId();
  const setValue = React.useCallback(
    (next: string) => {
      if (value === undefined) setInner(next);
      onValueChange?.(next);
    },
    [value, onValueChange],
  );
  const state = React.useMemo(() => ({ value: current, setValue, id }), [current, setValue, id]);
  return (
    <TabsContext.Provider value={state}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

/** The row of tabs. Left and Right arrows move between them, Home and End jump to the ends. */
export function TabsList({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
    if (!tabs.length) return;
    event.preventDefault();
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (at + step + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  };
  return (
    <div role="tablist" onKeyDown={onKeyDown} className={cn("inline-flex h-10 max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1", className)} {...props}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, className, children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const tabs = useTabs("TabsTrigger");
  const active = tabs.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={tabs.id + "tab" + value}
      aria-selected={active}
      aria-controls={tabs.id + "panel" + value}
      tabIndex={active ? 0 : -1}
      data-state={active ? "active" : "inactive"}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) tabs.setValue(value);
      }}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** What one tab shows. Only the chosen tab's content is on the page. */
export function TabsContent({ value, className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const tabs = useTabs("TabsContent");
  if (tabs.value !== value) return null;
  return (
    <div role="tabpanel" id={tabs.id + "panel" + value} aria-labelledby={tabs.id + "tab" + value} tabIndex={0} className={cn("mt-4 outline-none", className)} {...props}>
      {children}
    </div>
  );
}
`;

const SELECT = `import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * A choice from a list: the browser's own <select>, styled. On a phone it opens the system picker.
 * Use it like a select: <Select value={v} onChange={(e) => setV(e.target.value)}><option value="a">A</option></Select>.
 * Pair it with a Label (htmlFor / id).
 */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <span className="relative block">
      <select
        ref={ref}
        className={cn("h-9 w-full appearance-none rounded-md border border-border bg-background pl-3 pr-9 text-sm outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </span>
  );
});
`;

const DROPDOWN_MENU = `import * as React from "react";
import { cn } from "../../lib/utils";
import "./ui.css";

interface MenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
  id: string;
  root: React.RefObject<HTMLSpanElement>;
}

const MenuContext = React.createContext<MenuState | null>(null);

function useMenu(part: string): MenuState {
  const state = React.useContext(MenuContext);
  if (!state) throw new Error(part + " must be inside <DropdownMenu>.");
  return state;
}

const focusTrigger = (root: React.RefObject<HTMLSpanElement>) => root.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();

/** A short list of actions behind one button: Edit, Share, Disconnect. For a choice of value use Select. */
export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const root = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const state = React.useMemo(() => ({ open, setOpen, id, root }), [open, id]);
  return (
    <MenuContext.Provider value={state}>
      <span ref={root} className="relative inline-block">
        {children}
      </span>
    </MenuContext.Provider>
  );
}

export function DropdownMenuTrigger({ asChild, children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const { open, setOpen, id } = useMenu("DropdownMenuTrigger");
  const aria = { "aria-haspopup": "menu" as const, "aria-expanded": open, "aria-controls": open ? id : undefined };
  const keys = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown" && !open) {
      event.preventDefault();
      setOpen(true);
    }
  };
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: (event: React.MouseEvent<HTMLElement>) => void; onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void }>;
    return React.cloneElement(child, {
      ...aria,
      onKeyDown: keys,
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        child.props.onClick?.(event);
        if (!event.defaultPrevented) setOpen(!open);
      },
    });
  }
  return (
    <button
      type="button"
      {...aria}
      {...props}
      onKeyDown={keys}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(!open);
      }}
    >
      {children}
    </button>
  );
}

/** The list. Up and Down arrows move through it, Escape closes it and returns to the button. */
export function DropdownMenuContent({ align = "end", className, children }: { align?: "start" | "end"; className?: string; children: React.ReactNode }) {
  const { open, setOpen, id, root } = useMenu("DropdownMenuContent");
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open]);
  if (!open) return null;
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      focusTrigger(root);
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (items.length && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }
  };
  return (
    <div
      ref={ref}
      id={id}
      role="menu"
      onKeyDown={onKeyDown}
      className={cn("ui-fade absolute top-full z-50 mt-1 min-w-[10rem] rounded-lg border border-border bg-card p-1 text-foreground shadow-lg", align === "end" ? "right-0" : "left-0", className)}
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({ onSelect, className, children, ...props }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> & { onSelect?: () => void }) {
  const { setOpen, root } = useMenu("DropdownMenuItem");
  return (
    <button
      type="button"
      role="menuitem"
      {...props}
      onClick={() => {
        setOpen(false);
        focusTrigger(root);
        onSelect?.();
      }}
      className={cn("flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-none hover:bg-muted focus:bg-muted disabled:opacity-50", className)}
    >
      {children}
    </button>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-2.5 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />;
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn("my-1 h-px bg-border", className)} />;
}
`;

const TOOLTIP = `import * as React from "react";
import { cn } from "../../lib/utils";
import "./ui.css";

const sides = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

/**
 * A short hint for the thing it wraps, shown on hover and on keyboard focus:
 * <Tooltip content="Copy address"><button>...</button></Tooltip>. Phones have no hover, so never put
 * something a person needs only in a tooltip, and give an icon-only button an aria-label as well.
 */
export function Tooltip({ content, side = "top", className, children }: { content: React.ReactNode; side?: keyof typeof sides; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const child = React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": open ? id : undefined }) : children;
  return (
    <span
      className="relative inline-flex"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      {child}
      {open ? (
        <span id={id} role="tooltip" className={cn("ui-fade pointer-events-none absolute z-50 w-max max-w-[14rem] rounded-md bg-foreground px-2 py-1 text-xs text-background shadow", sides[side], className)}>
          {content}
        </span>
      ) : null}
    </span>
  );
}
`;

const TOAST = `import * as React from "react";
import { createRoot } from "react-dom/client";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import "./ui.css";

type Tone = "default" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  description?: string;
  tone: Tone;
}

export interface ToastOptions {
  description?: string;
  /** Milliseconds before it goes away by itself. 0 keeps it until it is closed. Default 4000. */
  duration?: number;
}

let items: ToastItem[] = [];
let nextId = 1;
let mounted = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function dismiss(id?: number) {
  items = id === undefined ? [] : items.filter((item) => item.id !== id);
  emit();
}

function show(message: string, options: ToastOptions = {}, tone: Tone = "default"): number {
  // No <Toaster /> on the page: put one there, so a toast is never silently lost.
  if (!mounted && typeof document !== "undefined") {
    const host = document.createElement("div");
    document.body.appendChild(host);
    createRoot(host).render(<Toaster />);
    mounted++;
  }
  const item = { id: nextId++, message, description: options.description, tone };
  // Three at most: more than that is noise.
  items = [...items.slice(-2), item];
  emit();
  const duration = options.duration ?? 4000;
  if (duration > 0) window.setTimeout(() => dismiss(item.id), duration);
  return item.id;
}

/**
 * A message that appears for a few seconds and goes: "Copied", "Saved", "Vote sent".
 * toast("Copied"), toast.success("Saved"), toast.error("Couldn't save", { description: "Try again." }).
 * For something the person must read or act on (a failed transaction, a form error) use a Notice
 * on the page instead: a toast is gone before a slow reader has read it.
 */
export const toast = Object.assign((message: string, options?: ToastOptions) => show(message, options), {
  success: (message: string, options?: ToastOptions) => show(message, options, "success"),
  error: (message: string, options?: ToastOptions) => show(message, options, "error"),
  dismiss,
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Where toasts appear. Optional: toast() adds one to the page if there is none. */
export function Toaster({ className }: { className?: string }) {
  const list = React.useSyncExternalStore(subscribe, () => items, () => items);
  React.useEffect(() => {
    mounted++;
    return () => {
      mounted--;
    };
  }, []);
  return (
    // At the top on a phone: the bottom corner there belongs to a published app's "Built with GoodBuild"
    // badge and to the thumb. Bottom right on wider screens.
    <div role="region" aria-label="Notifications" aria-live="polite" className={cn("pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-4 sm:bottom-0 sm:top-auto sm:items-end", className)}>
      {list.map((item) => (
        <div key={item.id} role={item.tone === "error" ? "alert" : "status"} className="ui-pop pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-border bg-card p-3 pr-2 text-sm text-foreground shadow-lg">
          {item.tone === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : null}
          {item.tone === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden /> : null}
          <div className="min-w-0 flex-1">
            <p className="font-medium">{item.message}</p>
            {item.description ? <p className="mt-0.5 text-muted-foreground">{item.description}</p> : null}
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(item.id)} className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
`;

const ACCORDION = `import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

interface AccordionState {
  open: string[];
  toggle: (value: string) => void;
}

const AccordionContext = React.createContext<AccordionState | null>(null);
const ItemContext = React.createContext<{ value: string; open: boolean; id: string } | null>(null);

function useItem(part: string) {
  const accordion = React.useContext(AccordionContext);
  const item = React.useContext(ItemContext);
  if (!accordion || !item) throw new Error(part + " must be inside <AccordionItem> inside <Accordion>.");
  return { ...item, toggle: accordion.toggle };
}

/**
 * Sections that open and close: an FAQ, details most people skip. type="single" keeps one open at a
 * time (the default), "multiple" lets several stay open. defaultValue is the value (or values) open at first.
 */
export function Accordion({
  type = "single",
  collapsible = true,
  defaultValue,
  className,
  children,
}: {
  type?: "single" | "multiple";
  /** With type="single": whether the open one can be closed again. */
  collapsible?: boolean;
  defaultValue?: string | string[];
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState<string[]>(() => (defaultValue === undefined ? [] : Array.isArray(defaultValue) ? defaultValue : [defaultValue]));
  const toggle = React.useCallback(
    (value: string) =>
      setOpen((now) => {
        const isOpen = now.includes(value);
        if (type === "multiple") return isOpen ? now.filter((v) => v !== value) : [...now, value];
        return isOpen ? (collapsible ? [] : now) : [value];
      }),
    [type, collapsible],
  );
  const state = React.useMemo(() => ({ open, toggle }), [open, toggle]);
  return (
    <AccordionContext.Provider value={state}>
      <div className={className}>{children}</div>
    </AccordionContext.Provider>
  );
}

export function AccordionItem({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) {
  const accordion = React.useContext(AccordionContext);
  const id = React.useId();
  const item = React.useMemo(() => ({ value, open: accordion?.open.includes(value) ?? false, id }), [value, accordion, id]);
  return (
    <ItemContext.Provider value={item}>
      <div className={cn("border-b border-border", className)}>{children}</div>
    </ItemContext.Provider>
  );
}

export function AccordionTrigger({ className, children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const item = useItem("AccordionTrigger");
  return (
    <h3 className="flex">
      <button
        type="button"
        id={item.id + "trigger"}
        aria-expanded={item.open}
        aria-controls={item.id + "panel"}
        {...props}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) item.toggle(item.value);
        }}
        className={cn("flex min-h-11 flex-1 items-center justify-between gap-4 py-3 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40", className)}
      >
        {children}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", item.open && "rotate-180")} aria-hidden />
      </button>
    </h3>
  );
}

export function AccordionContent({ className, children }: { className?: string; children: React.ReactNode }) {
  const item = useItem("AccordionContent");
  return (
    // Closed content is invisible, not just short, so a link inside it can't be reached by Tab.
    <div
      id={item.id + "panel"}
      role="region"
      aria-labelledby={item.id + "trigger"}
      className={cn("grid transition-[grid-template-rows,visibility] duration-200 motion-reduce:transition-none", item.open ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]")}
    >
      <div className="overflow-hidden">
        <div className={cn("pb-4 text-sm text-muted-foreground", className)}>{children}</div>
      </div>
    </div>
  );
}
`;

const AVATAR = `import * as React from "react";
import { cn } from "../../lib/utils";

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

function initialsOf(name?: string, address?: string): string {
  if (name?.trim()) {
    const words = name.trim().split(/\\s+/);
    return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
  }
  return address ? address.slice(2, 4).toUpperCase() : "";
}

/**
 * A round picture of a person or a wallet. With src it shows the image; without one (or if it fails
 * to load) it shows initials from name, or a colour made from address, the same every time for the
 * same wallet: <Avatar address={account} /> or <Avatar name="Ada Obi" src={url} size={48} />.
 */
export function Avatar({ src, name, address, size = 40, className }: { src?: string; name?: string; address?: string; size?: number; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  const seed = hash((address ?? name ?? "").toLowerCase());
  const hue = seed % 360;
  const label = name ?? (address ? address.slice(0, 6) + "…" + address.slice(-4) : "Avatar");
  const showImage = Boolean(src) && !failed;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-medium text-white", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: showImage ? undefined : "linear-gradient(135deg, hsl(" + hue + " 70% 52%), hsl(" + ((hue + 50) % 360) + " 70% 40%))",
      }}
    >
      {showImage ? <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} /> : initialsOf(name, address)}
    </span>
  );
}
`;

const SWITCH = `import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * An on/off setting that takes effect at once: <Switch checked={on} onCheckedChange={setOn} aria-label="Show closed votes" />.
 * Give it a visible Label (htmlFor / id) or an aria-label. For a choice sent with a form, use a checkbox.
 */
export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  className,
  onClick,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & { checked?: boolean; defaultChecked?: boolean; onCheckedChange?: (checked: boolean) => void }) {
  const [inner, setInner] = React.useState(defaultChecked);
  const on = checked ?? inner;
  return (
    <button
      type="button"
      {...props}
      role="switch"
      aria-checked={on}
      data-state={on ? "checked" : "unchecked"}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (checked === undefined) setInner(!on);
        onCheckedChange?.(!on);
      }}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
        on ? "bg-primary" : "bg-border",
        className,
      )}
    >
      <span className={cn("inline-block size-5 rounded-full bg-background shadow transition-transform", on ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}
`;

/** The ten pieces, by the path each has in a project. */
export const UI_PRIMITIVES: Record<string, string> = {
  "src/components/ui/ui.css": UI_CSS,
  "src/components/ui/dialog.tsx": DIALOG,
  "src/components/ui/sheet.tsx": SHEET,
  "src/components/ui/tabs.tsx": TABS,
  "src/components/ui/select.tsx": SELECT,
  "src/components/ui/dropdown-menu.tsx": DROPDOWN_MENU,
  "src/components/ui/tooltip.tsx": TOOLTIP,
  "src/components/ui/toast.tsx": TOAST,
  "src/components/ui/accordion.tsx": ACCORDION,
  "src/components/ui/avatar.tsx": AVATAR,
  "src/components/ui/switch.tsx": SWITCH,
};

/** Their names, for the builder's prompt. */
export const UI_PRIMITIVE_NAMES = ["dialog", "sheet", "tabs", "select", "dropdown-menu", "tooltip", "toast", "accordion", "avatar", "switch"];

/** How to use them: the `ui-components` guide. */
export const UI_GUIDE = `More UI pieces, already in src/components/ui/. Import them (relative path) and compose them; never hand-write a modal, a slide-in panel, tabs, a dropdown, a toast or an on/off switch, and never add a UI package (Radix, Headless UI, shadcn's CLI and sonner are not installed).
- dialog.tsx: a window over the page for one focused task. <Dialog open={open} onOpenChange={setOpen}> (or leave both out and let a trigger open it), <DialogTrigger asChild><Button>Tip</Button></DialogTrigger>, <DialogContent> holding <DialogHeader><DialogTitle>Send a tip</DialogTitle><DialogDescription>...</DialogDescription></DialogHeader>, the body, and <DialogFooter> with the buttons (<DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>). Always give it a DialogTitle. It closes on Escape, on a tap outside and on its own close button, and returns focus. Close it yourself with setOpen(false) after a successful action. Don't put a wallet transaction's whole flow in a dialog that closes itself: keep the pending and result Notice visible.
- sheet.tsx: the same parts as dialog (Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, SheetClose), sliding in from an edge: <SheetContent side="left"> for the menu on a phone (in place of a hand-written menu panel: put the NavLinks in it and close it on navigation), side="right" for filters or a cart, side="bottom" for an action sheet a thumb can reach.
- tabs.tsx: <Tabs defaultValue="buy"> (or value and onValueChange), <TabsList><TabsTrigger value="buy">Buy</TabsTrigger><TabsTrigger value="sell">Sell</TabsTrigger></TabsList>, <TabsContent value="buy">...</TabsContent>. For views of one thing on one page. Pages are routes, not tabs. Only the chosen tab's content is mounted, so keep state that must survive a switch above Tabs.
- select.tsx: the browser's own select, styled, NOT shadcn's Select: <Label htmlFor="token">Token</Label><Select id="token" value={token} onChange={(e) => setToken(e.target.value)}><option value="gd">G$</option><option value="cusd">cUSD</option></Select>. There is no SelectTrigger, SelectContent or SelectItem. On a phone it opens the system picker.
- dropdown-menu.tsx: a few actions behind one button: <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" aria-label="More"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Circle</DropdownMenuLabel><DropdownMenuItem onSelect={share}>Share</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={leave} className="text-danger">Leave</DropdownMenuItem></DropdownMenuContent></DropdownMenu>. It opens under its button and is clipped by a parent with overflow-hidden, so don't put one inside a scrolling or clipped box.
- tooltip.tsx: <Tooltip content="Copy address"><button aria-label="Copy address">...</button></Tooltip>, with side="top" | "bottom" | "left" | "right". Hover and keyboard focus only: phones have no hover, so nothing a person needs may live only in a tooltip.
- toast.tsx: toast("Copied"), toast.success("Saved"), toast.error("Couldn't save", { description: "Try again." }) from anywhere; no setup is needed (a <Toaster /> is added for you, or place one yourself). For a passing confirmation only. Anything the person must read or act on (a transaction that failed, a form error, "Deploy the contract to go live") stays a Notice on the page, as the ui-states guide says: after a contract write, show the success Notice, and a toast as well only if it helps.
- accordion.tsx: <Accordion type="single" defaultValue="a"> (or type="multiple"), <AccordionItem value="a"><AccordionTrigger>How do I join?</AccordionTrigger><AccordionContent>...</AccordionContent></AccordionItem>. Use it for an FAQ in place of <details>.
- avatar.tsx: <Avatar address={account} /> draws a colour made from the wallet address, the same every time for that wallet; <Avatar name="Ada Obi" src={url} size={48} /> shows the image and falls back to initials. Use it in leaderboards, member lists, comments and the header next to shortAddress.
- switch.tsx: <Switch id="closed" checked={showClosed} onCheckedChange={setShowClosed} /> with a <Label htmlFor="closed">, for a setting that takes effect at once.
- All of them take className and use the theme tokens, so restyle with classes (rounded-2xl, max-w-lg on DialogContent), not by editing the files. Keyboard and screen-reader behaviour is built in: don't add your own key handlers, focus traps or aria attributes on top.`;
