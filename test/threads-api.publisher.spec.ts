import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadsApiPublisher } from "../src/infrastructure/threads/threads-api.publisher";

afterEach(() => vi.unstubAllGlobals());

function publisher() {
  return new ThreadsApiPublisher({
    baseUrl: "https://graph.threads.net/",
    version: "v1.0",
    userId: "user-1",
    accessToken: "server-token"
  });
}

describe("ThreadsApiPublisher", () => {
  it("creates a text container with a server-side bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { id: "container-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const id = await publisher().createTextContainer({
      publicationJobId: "job-1",
      segmentPosition: 0,
      text: "Контрольная публикация",
      replyToId: null
    });

    expect(id).toBe("container-1");
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.threads.net/v1.0/user-1/threads");
    expect(options.headers).toMatchObject({ authorization: "Bearer server-token" });
    expect(String(options.body)).toContain("media_type=TEXT");
    expect(String(options.body)).toContain("text=");
  });

  it("marks a server-side publish failure as ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500, {
      error: { message: "Temporary failure" }
    })));

    await expect(publisher().publishContainer("container-1"))
      .rejects.toMatchObject({ ambiguous: true });
  });

  it("allows a retry after an explicit client-side rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(400, {
      error: { message: "Invalid container" }
    })));

    await expect(publisher().publishContainer("container-1"))
      .rejects.toMatchObject({ ambiguous: false });
  });
});

function response(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as Response;
}
