import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type HoverTooltipProps = {
  children: ReactNode;
  className?: string;
  content: string;
  delayMs?: number;
  testId?: string;
};

const TOOLTIP_GAP = 6;
const TOOLTIP_MAX_WIDTH = 320;
const TOOLTIP_VIEWPORT_MARGIN = 8;

export function HoverTooltip({
  children,
  className,
  content,
  delayMs = 0,
  testId,
}: HoverTooltipProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const measuredWidth = tooltipRef.current?.offsetWidth ?? 0;
    const estimatedWidth = Math.min(
      TOOLTIP_MAX_WIDTH,
      Math.max(48, content.length * 7 + 18),
    );
    const tooltipWidth = measuredWidth > 0 ? measuredWidth : estimatedWidth;
    const maxLeft = Math.max(
      TOOLTIP_VIEWPORT_MARGIN,
      window.innerWidth - tooltipWidth - TOOLTIP_VIEWPORT_MARGIN,
    );
    const centeredLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
    const left = Math.min(
      Math.max(centeredLeft, TOOLTIP_VIEWPORT_MARGIN),
      maxLeft,
    );
    setPosition({ top: rect.bottom + TOOLTIP_GAP, left });
  }, [content]);

  const clearTooltipTimer = useCallback(() => {
    if (timeoutRef.current === null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const showTooltip = useCallback((delay: number) => {
    clearTooltipTimer();
    updatePosition();
    if (delay <= 0) {
      setOpen(true);
      return;
    }
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      updatePosition();
      setOpen(true);
    }, delay);
  }, [clearTooltipTimer, updatePosition]);

  const hideTooltip = useCallback(() => {
    clearTooltipTimer();
    setOpen(false);
  }, [clearTooltipTimer]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  useLayoutEffect(() => clearTooltipTimer, [clearTooltipTimer]);

  return (
    <div
      ref={anchorRef}
      className={className}
      onBlur={hideTooltip}
      onFocus={() => showTooltip(0)}
      onMouseEnter={() => showTooltip(delayMs)}
      onMouseLeave={hideTooltip}
    >
      {children}
      {open
        ? createPortal(
            <div
              ref={tooltipRef}
              className="hover-tooltip"
              data-testid={testId}
              role="tooltip"
              style={{ position: "fixed", ...position }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
