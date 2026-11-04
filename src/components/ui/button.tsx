import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Button, restyled to DESIGN_SYSTEM §3:
 * - primary: black pill for top-level commits (Connect wallet, Sign & deploy)
 * - secondary: white pill with shadow-card
 * - ghost: text-only violet
 * - chip / chipSelected: tint pills
 * No outline buttons with grey borders.
 * The violet "Build it" button with the pink arrow disc is <ActionButton>.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-[background-color,color,box-shadow,opacity] duration-200 ease-gb outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-ink text-white hover:bg-ink/85",
        secondary: "bg-surface text-ink shadow-card hover:bg-tint",
        ghost: "text-violet hover:bg-tint",
        quiet: "bg-canvas text-grey-600 hover:bg-tint hover:text-violet",
        chip: "bg-tint text-violet hover:bg-violet-soft",
        chipSelected: "bg-violet text-white",
      },
      size: {
        default: "px-6 py-3 text-sm",
        sm: "px-3.5 py-2 text-xs",
        chip: "px-3.5 py-1.5 text-[13px]",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

/** The one violet action pill per view, with the pink 32px arrow disc. */
function ActionButton({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      data-slot="action-button"
      className={cn(
        "inline-flex items-center gap-2 rounded-full bg-violet py-2 pr-2 pl-5 text-[15px] font-medium text-white transition-[opacity,box-shadow] duration-200 ease-gb outline-none hover:bg-violet/92 focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      {...props}
    >
      {children}
      <span className="grid size-8 place-items-center rounded-full bg-pink text-violet-ink">
        <ArrowRight className="size-3.5" strokeWidth={2.6} aria-hidden />
      </span>
    </button>
  );
}

export { Button, ActionButton, buttonVariants };
