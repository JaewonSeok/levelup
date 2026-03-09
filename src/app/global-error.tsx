"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalErrorBoundary]", error);
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 font-sans">
          <h2 className="text-xl font-semibold text-gray-800">
            시스템 오류가 발생했습니다
          </h2>
          <p className="text-sm text-gray-500">
            잠시 후 다시 시도해주세요.
          </p>
          <button
            onClick={reset}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
