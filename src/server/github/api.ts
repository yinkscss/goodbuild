import "server-only";

/** A thin client for the few GitHub REST calls we make (D93). No SDK: five endpoints don't need one. */
const API = "https://api.github.com";

export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function githubConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GoodBuild",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new GithubApiError(res.status, detail?.message ?? `GitHub answered ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Trade the one-time code from the redirect for an access token. */
export async function exchangeCode(code: string): Promise<{ token: string; scope: string }> {
  const config = githubConfig();
  if (!config) throw new GithubApiError(503, "GitHub isn't set up on this server.");
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "GoodBuild" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => null)) as { access_token?: string; scope?: string; error?: string } | null;
  if (!res.ok || !data?.access_token) throw new GithubApiError(400, data?.error ?? "GitHub didn't accept the sign-in.");
  return { token: data.access_token, scope: data.scope ?? "" };
}

/** Best effort: tell GitHub the token is no longer wanted. */
export async function revokeToken(token: string): Promise<void> {
  const config = githubConfig();
  if (!config) return;
  await fetch(`${API}/applications/${config.clientId}/token`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "GoodBuild",
    },
    body: JSON.stringify({ access_token: token }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
}

export const getViewer = (token: string) => call<{ id: number; login: string }>(token, "GET", "/user");

export const createRepo = (token: string, input: { name: string; description: string }) =>
  call<{ full_name: string; default_branch: string; html_url: string }>(token, "POST", "/user/repos", {
    name: input.name,
    description: input.description,
    private: false,
    auto_init: true,
  });

export interface BranchHead {
  commitSha: string;
}

/** The branch's head commit, or null when the branch (or the repository) isn't there. */
export async function getBranchHead(token: string, fullName: string, branch: string): Promise<BranchHead | null> {
  try {
    const ref = await call<{ object: { sha: string } }>(token, "GET", `/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`);
    return { commitSha: ref.object.sha };
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 404) return null;
    throw error;
  }
}

export interface TreeEntry {
  path: string;
  mode: "100644";
  type: "blob";
  content: string;
}

export const createTree = (token: string, fullName: string, tree: TreeEntry[]) =>
  call<{ sha: string }>(token, "POST", `/repos/${fullName}/git/trees`, { tree });

export const createCommit = (token: string, fullName: string, input: { message: string; tree: string; parent: string }) =>
  call<{ sha: string }>(token, "POST", `/repos/${fullName}/git/commits`, { message: input.message, tree: input.tree, parents: [input.parent] });

/** Fast-forward only: GitHub refuses (422) when the commit doesn't descend from the branch head. */
export const moveBranch = (token: string, fullName: string, branch: string, sha: string) =>
  call<unknown>(token, "PATCH", `/repos/${fullName}/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: false });
