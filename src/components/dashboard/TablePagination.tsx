import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Classic numbered pagination for the dashboard tables (replaces the old
// "Show more (X remaining)" buttons). Zero-based `page`; renders nothing for
// a single page. Number windowing: first, last, current ±1, ellipses between.
interface TablePaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** e.g. "1–15 of 1,861 competitors" — shown at the left edge. */
  totalLabel?: string;
  className?: string;
}

const pageWindow = (page: number, pageCount: number): Array<number | "…"> => {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i);
  const pages = new Set<number>([0, pageCount - 1, page - 1, page, page + 1]);
  const sorted = Array.from(pages)
    .filter((p) => p >= 0 && p < pageCount)
    .sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  let prev = -1;
  for (const p of sorted) {
    if (prev >= 0 && p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
};

export const TablePagination = ({ page, pageCount, onPageChange, totalLabel, className }: TablePaginationProps) => {
  if (pageCount <= 1) return null;
  return (
    <div className={cn("flex items-center justify-between gap-3 pt-3 flex-wrap", className)}>
      <span className="text-xs text-gray-400">{totalLabel}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-gray-500"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        {pageWindow(page, pageCount).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-xs text-gray-400 select-none">…</span>
          ) : (
            <Button
              key={p}
              variant={p === page ? "outline" : "ghost"}
              size="sm"
              className={cn(
                "h-7 min-w-7 px-1.5 text-xs tabular-nums",
                p === page ? "border-gray-300 text-gray-900 font-semibold" : "text-gray-500",
              )}
              onClick={() => onPageChange(p)}
              aria-current={p === page ? "page" : undefined}
            >
              {p + 1}
            </Button>
          ),
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-gray-500"
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};
