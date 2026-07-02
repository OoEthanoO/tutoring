"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MenuItem, MenuKey } from "@/components/DashboardMenus";

const PANEL_WIDTH = 192; // w-48

type NavDropdownProps = {
  label: string;
  items: MenuItem[];
  activeKey: MenuKey;
  onSelect: (key: MenuKey) => void;
};

/**
 * A labeled dropdown group in the dashboard tab bar. The panel is portaled to
 * document.body with position: fixed — the sticky bar's backdrop-filter would
 * otherwise become the containing block for fixed descendants and misplace the
 * panel, and the nav's overflow-x-auto would clip an absolute one.
 */
export default function NavDropdown({ label, items, activeKey, onSelect }: NavDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const hasActiveChild = items.some((item) => item.key === activeKey);

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const left = Math.min(Math.max(rect.left, 8), window.innerWidth - PANEL_WIDTH - 8);
    setPanelPosition({ top: rect.bottom + 4, left });
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      // The panel is portaled to document.body, so check both containers.
      if (wrapperRef.current?.contains(target)) {
        return;
      }
      if (panelRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    // A fixed-position panel detaches visually from the sticky bar on scroll or
    // resize, so close it instead of tracking.
    const handleClose = () => setIsOpen(false);

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleClose, { passive: true });
    window.addEventListener("resize", handleClose);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleClose);
      window.removeEventListener("resize", handleClose);
    };
  }, [isOpen]);

  return (
    <div ref={wrapperRef} className="flex">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => (isOpen ? setIsOpen(false) : openPanel())}
        className={
          hasActiveChild
            ? "flex items-center gap-1 whitespace-nowrap border-b-2 border-[var(--foreground)] px-4 py-3 text-xs font-bold text-[var(--foreground)] transition-colors"
            : "flex items-center gap-1 whitespace-nowrap border-b-2 border-transparent px-4 py-3 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
        }
      >
        {label}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      {isOpen && panelPosition
        ? createPortal(
        <div
          ref={panelRef}
          role="menu"
          style={{ position: "fixed", top: panelPosition.top, left: panelPosition.left }}
          className="z-40 w-48 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg"
        >
          {items.map((item) => {
            const isActive = item.key === activeKey;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                aria-current={isActive ? "page" : undefined}
                onClick={() => {
                  onSelect(item.key);
                  setIsOpen(false);
                }}
                className={
                  isActive
                    ? "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-[var(--foreground)] transition hover:bg-[var(--border)]"
                    : "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--foreground)] transition hover:bg-[var(--border)]"
                }
              >
                {isActive ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--foreground)]" />
                ) : null}
                {item.label}
              </button>
            );
          })}
        </div>,
        document.body
      )
        : null}
    </div>
  );
}
