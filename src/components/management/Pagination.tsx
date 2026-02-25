"use client";

import { Button } from "@/components/ui/button";

interface PaginationProps {
  page: number;
  totalPages: number;
  loading?: boolean;
  onPageChange: (p: number) => void;
}

export function Pagination({
  page,
  totalPages,
  loading = false,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pageNumbers = Array.from(
    { length: Math.min(5, totalPages) },
    (_, i) => start + i
  );

  return (
    <div className="flex justify-center items-center gap-1 mt-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(1)}
        disabled={page <= 1 || loading}
        className="px-2"
      >
        ««
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1 || loading}
        className="px-2"
      >
        «
      </Button>

      {pageNumbers.map((p) => (
        <Button
          key={p}
          variant={p === page ? "default" : "outline"}
          size="sm"
          onClick={() => onPageChange(p)}
          disabled={loading}
          className="w-8 px-0"
        >
          {p}
        </Button>
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages || loading}
        className="px-2"
      >
        »
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(totalPages)}
        disabled={page >= totalPages || loading}
        className="px-2"
      >
        »»
      </Button>
    </div>
  );
}
