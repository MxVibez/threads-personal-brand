import { useEffect, useRef, type DragEvent, type PointerEvent } from "react";

type Direction = "approve" | "reject";

export function useSwipeCard(onApprove: () => void, onReject: () => void) {
  const cardRef = useRef<HTMLElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; horizontal: boolean } | null>(null);
  const dragX = useRef(0);
  const frame = useRef<number | null>(null);
  const timer = useRef<number | null>(null);

  function cancelFrame() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }

  function paint(value: number) {
    const element = cardRef.current;
    if (!element) return;
    element.style.setProperty("--card-drag-x", `${value}px`);
    element.style.setProperty("--card-tilt", `${value / 32}deg`);
    element.style.setProperty("--approve-opacity", String(Math.max(0, value / 92)));
    element.style.setProperty("--reject-opacity", String(Math.max(0, -value / 92)));
  }

  function reset() {
    cancelFrame();
    dragX.current = 0;
    paint(0);
    cardRef.current?.classList.remove("is-dragging", "is-settling");
  }

  function settle(target: number, after?: () => void) {
    cancelFrame();
    const element = cardRef.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      reset();
      after?.();
      return;
    }
    element.classList.add("is-settling");
    element.classList.remove("is-dragging");
    frame.current = requestAnimationFrame(() => {
      paint(target);
      frame.current = null;
    });
    timer.current = window.setTimeout(() => {
      timer.current = null;
      reset();
      after?.();
    }, 220);
  }

  function decide(direction: Direction) {
    if (timer.current !== null) return;
    settle(Math.max(window.innerWidth, 420) * (direction === "approve" ? 1 : -1),
      direction === "approve" ? onApprove : onReject);
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (timer.current !== null || gesture.current || event.isPrimary === false || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select, [data-no-swipe]")) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false };
    dragX.current = 0;
    // Capture only after horizontal intent is clear. A tap or scroll must keep native clicks.
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const x = event.clientX - current.x;
    const y = event.clientY - current.y;
    if (!current.horizontal) {
      if (Math.max(Math.abs(x), Math.abs(y)) < 10) return;
      if (Math.abs(y) >= Math.abs(x)) {
        gesture.current = null;
        return;
      }
      current.horizontal = true;
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // The native pointer may have ended while WebView was dispatching events.
        gesture.current = null;
        reset();
        return;
      }
      event.currentTarget.classList.add("is-dragging");
    }
    dragX.current = Math.max(-170, Math.min(170, x));
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        paint(dragX.current);
        frame.current = null;
      });
    }
  }

  function finish(event: PointerEvent<HTMLElement>, cancelled: boolean) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!current.horizontal) return;
    if (!cancelled) dragX.current = Math.max(-170, Math.min(170, event.clientX - current.x));
    if (!cancelled && Math.abs(dragX.current) > 92) {
      decide(dragX.current > 0 ? "approve" : "reject");
    } else {
      settle(0);
    }
  }

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  return {
    cardRef,
    decide,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
      onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
        // Touch starts with implicit capture on the tapped child (text/image).
        // Its capture loss bubbles when we transfer capture to this card. Only
        // losing the card's own capture should cancel the active swipe.
        if (event.target === event.currentTarget) finish(event, true);
      },
      onDragStart: (event: DragEvent<HTMLElement>) => event.preventDefault()
    }
  };
}
