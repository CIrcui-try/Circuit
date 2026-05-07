import type { PointerEvent as ReactPointerEvent } from "react";
import { useLayoutStore } from "../../stores/layoutStore";

type Direction = "sidebar" | "props" | "log";

export function ResizeHandle({ direction }: { direction: Direction }) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = useLayoutStore.getState();
    const initial =
      direction === "sidebar"
        ? start.sidebarWidth
        : direction === "props"
          ? start.propsWidth
          : start.logHeight;

    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = direction === "log" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      const store = useLayoutStore.getState();
      if (direction === "sidebar") {
        store.setSidebarWidth(initial + (ev.clientX - startX));
      } else if (direction === "props") {
        store.setPropsWidth(initial - (ev.clientX - startX));
      } else {
        store.setLogHeight(initial - (ev.clientY - startY));
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      role="separator"
      aria-orientation={direction === "log" ? "horizontal" : "vertical"}
      className={`resize-handle resize-handle--${direction}`}
      data-testid={`resize-handle-${direction}`}
      onPointerDown={onPointerDown}
    />
  );
}
