"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/** shadcn/ui Dialog, styled per DESIGN_SYSTEM: radius 24, shadow-pop, no borders. */
const Dialog = DialogPrimitive.Root;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-violet-ink/25 backdrop-blur-[3px]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 overflow-x-hidden overflow-y-auto overscroll-contain rounded-card bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop outline-none [overflow-wrap:anywhere] sm:max-h-[calc(100dvh-32px)] sm:w-[calc(100vw-32px)] sm:max-w-[calc(100vw-32px)] sm:p-7",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-4 right-4 grid size-8 place-items-center rounded-full bg-canvas text-grey-600 transition-colors duration-200 ease-gb outline-none hover:bg-tint hover:text-violet focus-visible:shadow-focus sm:top-7 sm:right-7"
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogContent, DialogTitle, DialogDescription };
