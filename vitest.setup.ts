import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

// Vite imports images as URLs, not Next's StaticImageData; render a plain <img> in tests.
vi.mock("next/image", () => ({
  default: ({ src, alt, className }: { src: string | { src: string }; alt: string; className?: string }) =>
    createElement("img", { src: typeof src === "string" ? src : src.src, alt, className }),
}));
