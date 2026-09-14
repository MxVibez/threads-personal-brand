import { afterEach, expect, it, vi } from "vitest";
import { loadBootstrap, approveDraft } from "../src/api";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("ends a hanging request and does not automatically retry a mutation", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn((_url, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(options.signal?.reason));
  }));
  vi.stubGlobal("fetch", fetcher);
  const result = approveDraft("test", { draftId: "draft", expectedVersion: 1, scheduledAt: new Date().toISOString() });
  const assertion = expect(result).rejects.toThrow("15 секунд");
  await vi.advanceTimersByTimeAsync(15_000);
  await assertion;
  expect(fetcher).toHaveBeenCalledOnce();
});

it("does not display internal server errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "postgres secret" }), { status: 500 })));
  await expect(loadBootstrap("test")).rejects.toThrow("Сервер временно не отвечает");
});

it("cancels an obsolete read and releases its timer", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  })));
  const controller = new AbortController();
  const result = loadBootstrap("test", controller.signal);
  const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});
