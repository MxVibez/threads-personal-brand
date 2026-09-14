export interface DraftApiDto {
  id: string;
  version: number;
  title: string;
  status: string;
  segments: string[];
  sources: Array<{ label: string; url: string; meta?: string }>;
  analysis: {
    format?: string;
    signal?: string;
    mentions?: number;
    freshness?: string;
    goal?: string;
    discussionPotential?: string;
    risk?: string;
    audience?: string;
    insight?: string;
    evidence?: string[];
  };
  createdAt: string;
}

export interface BootstrapResponse {
  user: {
    telegramId: string;
    displayName: string;
    username?: string;
    isOwner?: boolean;
  };
  drafts: DraftApiDto[];
  settings: ExpertSettingsDto;
  mode: "dry-run" | "live";
}

export interface ResultsResponse {
  counts: {
    waiting: number;
    approved: number;
    rejected: number;
    published: number;
    failed: number;
  };
  integrations: Array<{
    id: "telegram" | "apify" | "threads" | "ai";
    name: string;
    state: "working" | "setup" | "test";
    summary: string;
    detail: string;
    nextStep?: string;
  }>;
  insights: ThreadsInsightsDto;
}

export interface PlannedPublicationDto {
  id: string;
  draftId: string;
  title: string;
  scheduledAt: string;
  status: "PENDING" | "PROCESSING" | "PUBLISHED" | "FAILED" | "PARTIAL_FAILED" | "NEEDS_REVIEW" | "CANCELLED";
}

export interface ThreadsInsightsDto {
  available: boolean;
  periodDays: number;
  totals: {
    views: number;
    followersGained: number;
    interactions: number;
    engagementRate: number;
  };
  timeline: Array<{ label: string; views: number }>;
  topPosts: Array<{
    id: string;
    text: string;
    views: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    permalink?: string;
  }>;
  themes: Array<{ label: string; averageViews: number; posts: number }>;
}

export type ExpertTimezone =
  | "Europe/Moscow"
  | "Asia/Krasnoyarsk";

export interface ExpertSettingsDto {
  timezone: ExpertTimezone;
  dailyPublications: number;
  voice: {
    description: string;
    avoid: string;
    examples: string[];
  };
}

export class MiniAppApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "MiniAppApiError";
  }
}

async function request<T>(
  path: string,
  initData: string,
  options: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(new Error("timeout")), 15_000);
  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(`/api/miniapp${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        authorization: `tma ${initData}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { message?: unknown }
        | null;
      const message = response.status === 401
        ? "Сессия Telegram истекла. Закройте пульт и откройте его снова из бота."
        : response.status >= 500
          ? "Сервер временно не отвечает. Попробуйте ещё раз."
          : typeof body?.message === "string"
            ? body.message
            : "Сервер временно не отвечает. Попробуйте ещё раз.";
      throw new MiniAppApiError(message, response.status);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (options.signal?.aborted || error instanceof MiniAppApiError) throw error;
    throw new MiniAppApiError(
      controller.signal.aborted
        ? "Сервер не ответил за 15 секунд. Проверьте соединение и повторите действие."
        : "Не удалось связаться с сервером. Проверьте соединение и повторите действие.",
      0
    );
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export function loadBootstrap(
  initData: string,
  signal?: AbortSignal
): Promise<BootstrapResponse> {
  return request<BootstrapResponse>("/bootstrap", initData, { signal });
}

export function loadResults(initData: string): Promise<ResultsResponse> {
  return request("/results", initData);
}

export function loadPlan(initData: string): Promise<{ publications: PlannedPublicationDto[] }> {
  return request("/plan", initData);
}

export function cancelPlannedPublication(
  initData: string,
  publicationJobId: string
): Promise<{ ok: true }> {
  return request(`/publications/${encodeURIComponent(publicationJobId)}/cancel`, initData, {
    method: "POST"
  });
}

export function loadExpertSettings(initData: string): Promise<ExpertSettingsDto> {
  return request("/settings", initData);
}

export function saveExpertSettings(
  initData: string,
  settings: ExpertSettingsDto
): Promise<ExpertSettingsDto> {
  return request("/settings", initData, {
    method: "POST",
    body: JSON.stringify(settings)
  });
}

export function approveDraft(
  initData: string,
  input: { draftId: string; expectedVersion: number; scheduledAt: string }
): Promise<{
  ok: true;
  alreadyApproved: boolean;
  publicationJobId: string;
  scheduledAt: string;
}> {
  return request(`/drafts/${encodeURIComponent(input.draftId)}/approve`, initData, {
    method: "POST",
    body: JSON.stringify({
      expectedVersion: input.expectedVersion,
      scheduledAt: input.scheduledAt
    })
  });
}

export function rejectDraft(
  initData: string,
  input: { draftId: string; expectedVersion: number; reason: string }
): Promise<{ ok: true }> {
  return request(`/drafts/${encodeURIComponent(input.draftId)}/reject`, initData, {
    method: "POST",
    body: JSON.stringify({
      expectedVersion: input.expectedVersion,
      reason: input.reason
    })
  });
}
