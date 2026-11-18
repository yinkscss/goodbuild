import { expect, it } from "vitest";

import { maskEmail } from "./community";

it("masks the name part of an email and keeps the domain", () => {
  expect(maskEmail("olayinka@gmail.com")).toBe("o•••••a@gmail.com");
  expect(maskEmail("ab@x.io")).toBe("a•••@x.io");
  expect(maskEmail("nope")).toBe("•••••");
});
