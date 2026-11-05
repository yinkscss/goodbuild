import { z } from "zod";

import { PROMPT_MAX_LENGTH } from "@/lib/prompt";

/** Request bodies shared by the API routes and their clients. */

export const verifyBody = z.object({
  message: z.string().min(1).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  walletKind: z.enum(["embedded", "external"]),
  /** Magic DID token (D22). Required for walletKind "embedded"; ignored for external wallets. */
  didToken: z.string().min(20).max(8000).optional(),
  attestation: z
    .object({
      ageOk: z.boolean(),
      notUsPerson: z.boolean(),
    })
    .optional(),
});
export type VerifyBody = z.infer<typeof verifyBody>;

export const createProjectBody = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_MAX_LENGTH),
  templateId: z.string().max(64).nullable().optional(),
  network: z.enum(["celo-sepolia", "celo"]).default("celo-sepolia"),
});
export type CreateProjectBody = z.infer<typeof createProjectBody>;
