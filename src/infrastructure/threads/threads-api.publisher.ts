import type {
  CreateThreadsContainerInput,
  ThreadsPublisher
} from "../../domain/publication/threads-publisher";
import { ThreadsPublishError } from "../../domain/publication/threads-publisher";

interface ThreadsApiConfig {
  baseUrl: string;
  version: string;
  userId: string;
  accessToken: string;
}

export class ThreadsApiPublisher implements ThreadsPublisher {
  readonly dryRun = false;

  constructor(private readonly config: ThreadsApiConfig) {}

  async createTextContainer(input: CreateThreadsContainerInput): Promise<string> {
    const body = new URLSearchParams({
      media_type: "TEXT",
      text: input.text
    });
    if (input.replyToId) body.set("reply_to_id", input.replyToId);

    return await this.postForId(
      `${this.apiRoot()}/${encodeURIComponent(this.config.userId)}/threads`,
      body,
      false
    );
  }

  async publishContainer(containerId: string): Promise<string> {
    const body = new URLSearchParams({ creation_id: containerId });
    return await this.postForId(
      `${this.apiRoot()}/${encodeURIComponent(this.config.userId)}/threads_publish`,
      body,
      true
    );
  }

  private apiRoot(): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}/${this.config.version}`;
  }

  private async postForId(
    url: string,
    body: URLSearchParams,
    publishMayBeAmbiguous: boolean
  ): Promise<string> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        body,
        signal: AbortSignal.timeout(20_000)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Threads network error";
      throw new ThreadsPublishError(
        `Threads API не ответил: ${message}`,
        publishMayBeAmbiguous
      );
    }

    const payload = (await response.json().catch(() => null)) as
      | { id?: unknown; error?: { message?: unknown } }
      | null;
    if (!response.ok) {
      const apiMessage =
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : `HTTP ${response.status}`;
      throw new ThreadsPublishError(
        `Threads API вернул ошибку: ${apiMessage}`,
        publishMayBeAmbiguous && response.status >= 500
      );
    }
    if (typeof payload?.id !== "string" || !payload.id) {
      throw new ThreadsPublishError(
        "Threads API не вернул ID операции.",
        publishMayBeAmbiguous
      );
    }
    return payload.id;
  }
}
