/** Shared by the form and the server (src/server/support/ticket.ts), so the two can't drift apart. No server-only code here. */
export const MAX_MESSAGE_LENGTH = 2000;
export const TOPIC_OPTIONS = [
  { value: "question", label: "A question" },
  { value: "problem", label: "Something isn't working" },
  { value: "payment", label: "Credits or payment" },
  { value: "report", label: "Report an app" },
  { value: "other", label: "Something else" },
] as const;
export type Topic = (typeof TOPIC_OPTIONS)[number]["value"];
