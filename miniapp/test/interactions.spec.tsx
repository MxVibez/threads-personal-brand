import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

let root: Root;
let container: HTMLDivElement;
const capture = vi.fn();
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(el => el.textContent?.includes(text) || el.getAttribute("aria-label") === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}
function pointer(target: Element, type: string, x = 100, y = 100) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: "touch" } });
  target.dispatchEvent(event);
}
async function tap(target: Element) {
  await act(async () => {
    pointer(target, "pointerdown");
    pointer(target, "pointerup");
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Unexpected network request"))));
  vi.stubGlobal("scrollTo", vi.fn());
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: capture });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => false });
  capture.mockClear();
  container = document.createElement("div");
  container.id = "root";
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("touch interactions in the approval feed", () => {
  it.each([
    ["Посмотреть всю ветку", "Ветка целиком"],
    ["Почему система выбрала", "Почему тема в ленте"]
  ])("opens %s on the first tap without a request or swipe lock", async (label, heading) => {
    const control = button(label);
    control.focus();
    await tap(control);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(heading);
    expect(dialog.closest("#root")).toBeNull();
    expect(container.inert).toBe(true);
    expect(capture).not.toHaveBeenCalled();
    expect(document.querySelector(".is-settling, .is-dragging")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await tap(button("Закрыть"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.inert).toBe(false);
    expect(document.activeElement).toBe(control);
  });

  it("does not block buttons after a plain tap or vertical scroll on the card", async () => {
    const card = document.querySelector(".topic-card")!;
    await tap(card);
    await act(async () => {
      pointer(card, "pointerdown");
      pointer(card, "pointermove", 105, 170);
      pointer(card, "pointercancel", 105, 170);
    });
    expect(capture).not.toHaveBeenCalled();
    expect(card.className).toBe("topic-card");
    await tap(button("Посмотреть всю ветку"));
    expect(document.querySelectorAll(".full-thread-segment")).toHaveLength(4);
  });

  it("recognizes a fast horizontal swipe even before the next animation frame", async () => {
    const card = document.querySelector(".topic-card")!;
    await act(async () => {
      pointer(card, "pointerdown");
      pointer(card, "pointermove", 230, 104);
      pointer(card, "pointerup", 240, 104);
      vi.advanceTimersByTime(230);
    });
    expect(capture).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Когда поставить в план?");
  });

  it.each([
    ["h2", 130, "Когда поставить в план?"],
    ["h2", -130, "Почему не подходит?"],
    [".segment p", 130, "Когда поставить в план?"],
    [".segment p", -130, "Почему не подходит?"],
    ["img", 130, "Когда поставить в план?"],
    ["img", -130, "Почему не подходит?"]
  ] as const)("keeps a swipe from %s when implicit capture transfers to the card (%s)", async (selector, distance, heading) => {
    const card = document.querySelector(".topic-card")!;
    const text = card.querySelector(selector)!;
    await act(async () => {
      pointer(text, "pointerdown", 180, 150);
      pointer(text, "pointermove", 180 + Math.sign(distance) * 30, 151);
      // A touch starts with implicit capture on the text. Capturing on the
      // card releases that child; its lostpointercapture event bubbles.
      pointer(text, "lostpointercapture", 180 + Math.sign(distance) * 30, 151);
      pointer(card, "pointermove", 180 + distance, 154);
      pointer(card, "pointerup", 180 + distance, 154);
      vi.advanceTimersByTime(230);
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(heading);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still cancels if the card itself loses capture", async () => {
    const card = document.querySelector(".topic-card")!;
    await act(async () => {
      pointer(card, "pointerdown");
      pointer(card, "pointermove", 240, 103);
      pointer(card, "lostpointercapture", 240, 103);
      pointer(card, "pointerup", 250, 103);
      vi.advanceTimersByTime(230);
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(card.className).toBe("topic-card");
  });

  it("recovers after a native capture exception without leaving a swipe lock", async () => {
    const card = document.querySelector(".topic-card")!;
    capture.mockImplementationOnce(() => { throw new DOMException("Pointer ended", "NotFoundError"); });
    await act(async () => {
      pointer(card, "pointerdown");
      pointer(card, "pointermove", 240, 103);
      pointer(card, "pointerup", 240, 103);
    });
    expect(card.className).toBe("topic-card");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await tap(button("Посмотреть всю ветку"));
    expect(document.querySelectorAll(".full-thread-segment")).toHaveLength(4);
  });

  it("does not approve a short drag or start native text/image dragging", async () => {
    const card = document.querySelector(".topic-card")!;
    const nativeDrag = new Event("dragstart", { bubbles: true, cancelable: true });
    await act(async () => {
      card.querySelector("img")!.dispatchEvent(nativeDrag);
      pointer(card, "pointerdown");
      pointer(card, "pointermove", 135, 103);
      pointer(card, "pointerup", 135, 103);
      vi.advanceTimersByTime(230);
    });
    expect(nativeDrag.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(card.className).toBe("topic-card");
  });

  it("opens approval via button and evaluates 'now' at click time", async () => {
    await tap(button("Одобрить"));
    await act(async () => vi.advanceTimersByTime(230));
    const now = button("Опубликовать сейчас");
    await act(async () => vi.advanceTimersByTime(120_000));
    await tap(now);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain("Поставили в план: сейчас");
  });
});
