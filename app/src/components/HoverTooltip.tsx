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
  testId?: string;
};

const TOOLTIP_GAP = 6;
const TOOLTIP_MAX_WIDTH = 320;
const TOOLTIP_VIEWPORT_MARGIN = 8;

export function HoverTooltip({
  children,
  className,
  content,
  testId,
}: HoverTooltipProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxLeft = Math.max(
      TOOLTIP_VIEWPORT_MARGIN,
      window.innerWidth - TOOLTIP_MAX_WIDTH - TOOLTIP_VIEWPORT_MARGIN,
    );
    const left = Math.min(Math.max(rect.left, TOOLTIP_VIEWPORT_MARGIN), maxLeft);
    setPosition({ top: rect.bottom + TOOLTIP_GAP, left });
  }, []);

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

  return (
    <div
      ref={anchorRef}
      className={className}
      onBlur={() => setOpen(false)}
      onFocus={() => {
        updatePosition();
        setOpen(true);
      }}
      onMouseEnter={() => {
        updatePosition();
        setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open
        ? createPortal(
            <div
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
