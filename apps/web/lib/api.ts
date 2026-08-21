export type User = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  email_verified: boolean;
  status: "pending_verification" | "active" | "suspended";
  role: "user" | "admin";
  created_at: string;
};

export type UserSession = {
  id: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  user_agent: string | null;
  current: boolean;
};

export type AIModel = {
  id: string;
  key: string;
  provider: string;
  external_model_id: string;
  display_name: string;
  supports_tools: boolean;
};

export type CatalogItem = {
  id: string;
  slug: string;
  name: string;
  description: string;
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  memory_enabled: boolean;
  ai_model: AIModel;
  skills: CatalogItem[];
  tools: CatalogItem[];
  created_at: string;
  updated_at: string;
};

export type ProjectInput = {
  name: string;
  description?: string;
  ai_model_id: string;
  system_prompt?: string;
  memory_enabled: boolean;
  skill_ids: string[];
  tool_ids: string[];
};

export type Conversation = {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  provider: string | null;
  model_key: string | null;
  created_at: string;
};

export type ConversationDetail = Conversation & { messages: ConversationMessage[] };

export type RetrievedChunk = {
  title: string;
  ordinal: number;
  score: number;
  content: string;
};

export type ConversationMessageWithSources = ConversationMessage & { sources: RetrievedChunk[] };

export type WorkspaceDocument = {
  id: string;
  project_id: string;
  title: string;
  source_kind: string;
  char_count: number;
  chunk_count: number;
  created_at: string;
  updated_at: string;
};

export type ProductRelease = {
  id: string;
  project_id: string;
  version: string;
  title: string;
  summary: string;
  status: "planned" | "rolling_out" | "released" | "rolled_back";
  released_at: string;
  created_at: string;
  updated_at: string;
};

export type FeedbackSignal = {
  id: string;
  project_id: string;
  release_id: string | null;
  source: "review" | "support" | "interview" | "survey" | "other";
  external_ref: string | null;
  content: string;
  sentiment: "negative" | "neutral" | "positive";
  topic: string | null;
  occurred_at: string;
  created_at: string;
  updated_at: string;
};

export type MetricSnapshot = {
  id: string;
  project_id: string;
  metric_key: string;
  label: string;
  value: number;
  unit: string | null;
  segment: string;
  measured_at: string;
  created_at: string;
  updated_at: string;
};

export type ProductContextSummary = {
  releases: number;
  feedback_signals: number;
  metric_snapshots: number;
  negative_feedback: number;
  unlinked_feedback: number;
};

type ApiErrorPayload = { detail?: string };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly captchaRequired = false,
  ) {
    super(message);
  }
}

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const apiPrefix = "/api/v1";

let csrfTokenCache: string | undefined;

async function getCsrfToken(): Promise<string> {
  if (csrfTokenCache) return csrfTokenCache;

  const response = await fetch(`${apiBaseUrl}${apiPrefix}/auth/csrf`, {
    credentials: "include",
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) csrfTokenCache = undefined;
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new ApiError(payload.detail ?? "Unable to establish a secure session", response.status);
  }
  const payload = (await response.json()) as { csrf_token: string };
  csrfTokenCache = payload.csrf_token;
  return payload.csrf_token;
}

async function performRequest<T>(
  path: string,
  options: RequestInit,
  requiresCsrf: boolean,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (requiresCsrf) {
    const csrfToken = await getCsrfToken();
    headers.set("X-CSRF-Token", decodeURIComponent(csrfToken));
  }

  const response = await fetch(`${apiBaseUrl}${apiPrefix}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new ApiError(
      payload.detail ?? "Request failed",
      response.status,
      response.headers.get("x-captcha-required") === "true",
    );
  }
  return response.json() as Promise<T>;
}

let backendSessionRepair: Promise<boolean> | null = null;

/**
 * Asks this app's server to re-open the backend session from the Supabase one.
 * Concurrent callers share a single attempt so a page that fires several
 * requests at once does not stampede the endpoint.
 */
function repairBackendSession(): Promise<boolean> {
  backendSessionRepair ??= fetch("/auth/backend-session", { method: "POST" })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      backendSessionRepair = null;
    });
  return backendSessionRepair;
}

/**
 * Supabase owns the sign-in; this backend keeps its own, shorter-lived session
 * cookie. When that cookie is missing or expired but the Supabase session is
 * still good, the first denied call re-establishes it and runs again, so a
 * returning visitor never sees a spurious trip back to the login screen.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  requiresCsrf = false,
): Promise<T> {
  try {
    return await performRequest<T>(path, options, requiresCsrf);
  } catch (error) {
    const unauthorized = error instanceof ApiError && error.status === 401;
    if (!unauthorized || typeof window === "undefined") throw error;

    csrfTokenCache = undefined;
    if (!(await repairBackendSession())) throw error;
    return performRequest<T>(path, options, requiresCsrf);
  }
}

export const authApi = {
  getCurrentUser: () => apiRequest<User>("/auth/me"),
  getCaptchaStatus: () =>
    apiRequest<{ provider: "turnstile" | null; site_key: string | null }>("/auth/captcha/status"),
  /**
   * Signs out of Supabase and of this backend in one step. The route handler
   * ends both, so no cookie is left behind on either side.
   */
  logout: async () => {
    try {
      await fetch("/auth/signout", { method: "POST" });
    } finally {
      csrfTokenCache = undefined;
    }
  },
  getSessions: () => apiRequest<UserSession[]>("/auth/sessions"),
  revokeSession: (sessionId: string) =>
    apiRequest<{ message: string }>(`/auth/sessions/${sessionId}/revoke`, { method: "POST" }, true),
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.toString();
}

export const luraApi = {
  getModels: () => apiRequest<AIModel[]>("/catalog/models"),
  getSkills: () => apiRequest<CatalogItem[]>("/catalog/skills"),
  getTools: () => apiRequest<CatalogItem[]>("/catalog/tools"),
  getProjects: () => apiRequest<Project[]>("/projects"),
  getProject: (projectId: string) => apiRequest<Project>(`/projects/${projectId}`),
  /** Returns the single workspace, creating it on first visit. Needs CSRF because it may write. */
  getWorkspace: () => apiRequest<Project>("/projects/default", {}, true),
  createProject: (input: ProjectInput) =>
    apiRequest<Project>("/projects", { method: "POST", body: JSON.stringify(input) }, true),
  deleteProject: (projectId: string) =>
    apiRequest<{ message: string }>(`/projects/${projectId}`, { method: "DELETE" }, true),
  getConversations: (projectId: string) => apiRequest<Conversation[]>(`/projects/${projectId}/conversations`),
  createConversation: (projectId: string, title = "New conversation") =>
    apiRequest<Conversation>(`/projects/${projectId}/conversations`, { method: "POST", body: JSON.stringify({ title }) }, true),
  getConversation: (conversationId: string) => apiRequest<ConversationDetail>(`/conversations/${conversationId}`),
  sendMessage: (conversationId: string, content: string) =>
    apiRequest<ConversationMessageWithSources>(`/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ content }) }, true),
  getDocuments: (projectId: string) =>
    apiRequest<WorkspaceDocument[]>(`/projects/${projectId}/documents`),
  createDocument: (projectId: string, input: { title: string; content: string; source_kind?: string }) =>
    apiRequest<WorkspaceDocument>(`/projects/${projectId}/documents`, { method: "POST", body: JSON.stringify(input) }, true),
  deleteDocument: (documentId: string) =>
    apiRequest<{ message: string }>(`/documents/${documentId}`, { method: "DELETE" }, true),
  deleteConversation: (conversationId: string) =>
    apiRequest<{ message: string }>(`/conversations/${conversationId}`, { method: "DELETE" }, true),
  getProductContextSummary: (projectId: string) =>
    apiRequest<ProductContextSummary>(`/projects/${projectId}/context/summary`),
  getReleases: (projectId: string, limit = 200) =>
    apiRequest<ProductRelease[]>(`/projects/${projectId}/releases?${buildQuery({ limit })}`),
  createRelease: (projectId: string, input: Omit<ProductRelease, "id" | "project_id" | "created_at" | "updated_at">) =>
    apiRequest<ProductRelease>(`/projects/${projectId}/releases`, { method: "POST", body: JSON.stringify(input) }, true),
  getFeedback: (projectId: string, options: { releaseId?: string; limit?: number } = {}) =>
    apiRequest<FeedbackSignal[]>(
      `/projects/${projectId}/feedback?${buildQuery({ release_id: options.releaseId, limit: options.limit ?? 500 })}`,
    ),
  createFeedback: (projectId: string, input: Omit<FeedbackSignal, "id" | "project_id" | "created_at" | "updated_at">) =>
    apiRequest<FeedbackSignal>(`/projects/${projectId}/feedback`, { method: "POST", body: JSON.stringify(input) }, true),
  getMetricSnapshots: (projectId: string, options: { metricKey?: string; limit?: number } = {}) =>
    apiRequest<MetricSnapshot[]>(
      `/projects/${projectId}/metrics?${buildQuery({ metric_key: options.metricKey, limit: options.limit ?? 500 })}`,
    ),
  createMetricSnapshot: (projectId: string, input: Omit<MetricSnapshot, "id" | "project_id" | "created_at" | "updated_at">) =>
    apiRequest<MetricSnapshot>(`/projects/${projectId}/metrics`, { method: "POST", body: JSON.stringify(input) }, true),
};

export function getSafeNextPath(nextPath: string | null | undefined): string {
  if (!nextPath || !nextPath.startsWith("/")) return "/workspace";

  try {
    let decoded = nextPath;
    for (let depth = 0; depth < 3; depth += 1) {
      const nextDecoded = decodeURIComponent(decoded);
      if (nextDecoded === decoded) break;
      decoded = nextDecoded;
    }
    if (decoded.startsWith("//") || decoded.includes("\\") || /[\u0000-\u001F\u007F]/u.test(decoded)) {
      return "/workspace";
    }

    const baseOrigin = "https://lura.internal";
    const resolved = new URL(nextPath, baseOrigin);
    if (resolved.origin !== baseOrigin) return "/workspace";
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return "/workspace";
  }
}

export function getLoginPath(nextPath: string | null | undefined): string {
  const safeNextPath = getSafeNextPath(nextPath);
  return safeNextPath === "/workspace" ? "/login" : `/login?next=${encodeURIComponent(safeNextPath)}`;
}
