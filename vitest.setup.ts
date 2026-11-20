import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { setV1HarnessForTests } from "@/server/agent/harness";

afterEach(() => cleanup());

// New builds use harness v2 in production (D152). Most runner tests script the v1 loop, which still runs
// turns saved before v2 shipped, so tests start on v1; the v2 tests switch it off.
setV1HarnessForTests(true);

// Vite imports images as URLs, not Next's StaticImageData; render a plain <img> in tests.
vi.mock("next/image", () => ({
  default: ({ src, alt, className }: { src: string | { src: string }; alt: string; className?: string }) =>
    createElement("img", { src: typeof src === "string" ? src : src.src, alt, className }),
}));
