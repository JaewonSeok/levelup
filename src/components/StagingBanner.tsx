/**
 * StagingBanner — 검수용 환경에서만 표시되는 경고 배너
 * NEXT_PUBLIC_APP_ENV=staging 일 때만 렌더링됩니다.
 */
export function StagingBanner() {
  if (process.env.NEXT_PUBLIC_APP_ENV !== "staging") return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 w-full bg-amber-400 text-amber-950 py-2 px-4 text-sm font-semibold text-center shadow-sm"
    >
      ⚠️ 검수용 환경 — 실제 데이터가 아닙니다. 이 환경의 모든 데이터는 가상입니다.
    </div>
  );
}
