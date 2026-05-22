import { useState, useEffect, useRef, useCallback } from "react";

// Single-row, horizontally scrollable underline-tab group. The scrollbar is
// hidden and edge gradients fade in only on the side that has more content,
// signalling scrollability without dimming the tabs at rest.
export const ScrollablePills = ({
  options,
  selected,
  onSelect,
}: {
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateEdges, options.length]);

  return (
    <div className="relative max-w-full">
      <div
        ref={scrollRef}
        onScroll={updateEdges}
        className="flex w-full overflow-x-auto border-b border-gray-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            className={`flex-shrink-0 whitespace-nowrap px-3 py-2 -mb-px border-b-2 text-sm font-medium transition-colors ${
              selected === opt.value
                ? 'border-gray-700 text-gray-700'
                : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {edges.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white to-transparent" />
      )}
      {edges.right && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent" />
      )}
    </div>
  );
};
