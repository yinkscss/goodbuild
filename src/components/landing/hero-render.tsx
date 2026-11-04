"use client";

import * as React from "react";
import Image from "next/image";

import heroRender from "../../../public/assets/hero-b.jpg";
import { approach, tiltFromPointer } from "@/lib/tilt";

const heroMask = "radial-gradient(closest-side, #000 70%, transparent 100%)";
const MAX_TILT_DEG = 6;

/**
 * The hero render (design/landing/assets/hero-b.jpg), animated:
 * - an 8s idle float (drift, slight rotation, breathing scale) in CSS;
 * - a soft violet glow behind it that breathes with the float;
 * - a gentle 3D tilt toward the cursor on fine pointers (desktop).
 * Everything is off under prefers-reduced-motion; the tilt is skipped on touch.
 */
export function HeroRender() {
  const tiltRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = tiltRef.current;
    const card = el?.closest("section");
    if (!el || !card) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (calm.matches || !fine.matches) return;

    const target = { rx: 0, ry: 0 };
    const current = { rx: 0, ry: 0 };
    let frame = 0;

    const tick = () => {
      current.rx = approach(current.rx, target.rx);
      current.ry = approach(current.ry, target.ry);
      el.style.transform = `perspective(900px) rotateX(${current.rx}deg) rotateY(${current.ry}deg)`;
      frame = current.rx === target.rx && current.ry === target.ry ? 0 : requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      Object.assign(target, tiltFromPointer(e.clientX, e.clientY, card.getBoundingClientRect(), MAX_TILT_DEG));
      kick();
    };
    const onLeave = () => {
      target.rx = 0;
      target.ry = 0;
      kick();
    };

    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    return () => {
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute inset-[18%] rounded-full bg-violet/35 blur-3xl animate-glow motion-reduce:animate-none"
      />
      {/* The blend sits on the transformed wrapper: a transform makes a new stacking context,
          so multiplying the image itself would only blend with the wrapper and show the JPG's white. */}
      <div ref={tiltRef} className="relative mix-blend-multiply will-change-transform">
        <Image
          src={heroRender}
          alt=""
          priority
          sizes="(min-width: 1024px) 575px, 90vw"
          className="h-[320px] w-auto animate-float motion-reduce:animate-none sm:h-[400px] lg:h-[430px]"
          style={{ WebkitMaskImage: heroMask, maskImage: heroMask }}
        />
      </div>
    </div>
  );
}
