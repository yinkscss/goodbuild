import type { CreateProjectBody } from "@/lib/api-schemas";

export class ProjectRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "ProjectRequestError";
  }
}

/** POST /api/projects. Throws ProjectRequestError with the server's code (401 → re-auth). */
export async function createProject(
  body: CreateProjectBody,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; name: string }> {
  const res = await fetchImpl("/api/projects", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const code = await res
      .json()
      .then((b: { error?: string }) => b.error ?? `http_${res.status}`)
      .catch(() => `http_${res.status}`);
    throw new ProjectRequestError(code, res.status);
  }
  return res.json();
}
