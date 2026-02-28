export interface GradeCriteriaItem {
  grade: string;
  yearRange: string;
  points: number;
}

export function getNextLevel(currentLevel: string | null): string | null {
  if (!currentLevel) return null;
  const order = ["L0", "L1", "L2", "L3", "L4", "L5"];
  const idx = order.indexOf(currentLevel);
  if (idx === -1 || idx >= order.length - 1) return null;
  return order[idx + 1];
}

/**
 * 등급 → 포인트 변환.
 * 빈 등급·"-"·"NI" → 기본값 2 (엑셀 IFERROR와 동일).
 */
export function gradeToPoints(
  grade: string,
  year: number,
  gradeCriteria: GradeCriteriaItem[]
): number {
  if (!grade || grade === "-" || grade.trim() === "" || grade.trim().toUpperCase() === "NI") return 2;
  const g = grade.trim().toUpperCase();
  for (const gc of gradeCriteria) {
    if (gc.grade !== g) continue;
    const range = gc.yearRange;
    if (range === String(year)) return gc.points;
    const parts = range.split("-");
    if (parts.length === 2) {
      const from = Number(parts[0]);
      const to = Number(parts[1]);
      if (!isNaN(from) && !isNaN(to) && year >= from && year <= to) return gc.points;
    }
  }
  return 2;
}

/**
 * 등급 기준 포인트 윈도우 합산.
 * grades: { [year]: grade } 형태의 연도별 등급 맵.
 * baseYear: 현재 연도(예: 2026) → 창은 baseYear-1부터 역순으로 tenureRange년.
 */
export function calculatePointSum(
  grades: Record<number, string>,
  gradeCriteria: GradeCriteriaItem[],
  baseYear: number,
  yearsOfService: number
): number {
  const tenureRange = Math.min(yearsOfService, 5);
  let pointSum = 0;
  for (let i = 0; i < tenureRange; i++) {
    const year = baseYear - 1 - i; // 2025, 2024, 2023, ...
    if (year < 2021) break;
    pointSum += gradeToPoints(grades[year] ?? "", year, gradeCriteria);
  }
  return pointSum;
}

/**
 * 최종 포인트 계산: 등급 window 합 + Point.merit/penalty + BonusPenalty adjustment.
 * 포인트 관리 페이지와 레벨업 심사 페이지에서 공통 사용.
 * fallback(GradeCriteria 미설정) 케이스는 DB cumulative + adjustment를 직접 사용할 것.
 */
export function calculateFinalPoints(
  grades: Record<number, string>,
  gradeCriteria: GradeCriteriaItem[],
  baseYear: number,
  yearsOfService: number,
  totalMerit: number,
  totalPenalty: number,
  adjustment: number
): number {
  return calculatePointSum(grades, gradeCriteria, baseYear, yearsOfService)
    + totalMerit - totalPenalty + adjustment;
}

/**
 * 학점 점수 조회 (baseYear-1년도 Credit.score).
 * 학점은 2025년부터 도입 — baseYear=2026 → 2025년 값.
 */
export function getCreditScore(
  credits: Array<{ year: number; score: number }>,
  baseYear: number
): number {
  return credits.find((c) => c.year === baseYear - 1)?.score ?? 0;
}
