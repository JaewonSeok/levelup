"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ErrorBoundary]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-gray-50">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-gray-800">
          페이지를 불러올 수 없습니다
        </h2>
        <p className="text-sm text-gray-500">
          일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
        </p>
        {error.digest && (
          <p className="text-xs text-gray-400">오류 코드: {error.digest}</p>
        )}
      </div>
      <Button onClick={reset}>다시 시도</Button>
    </div>
  );
}
