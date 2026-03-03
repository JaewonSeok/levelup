// src/lib/aiScoring.ts
// 승진 적합도 AI 스코어링 — 순수 연산 (서버/클라이언트 모두 safe)

export interface GradeInfo {
  year: number;
  grade: string;
  points: number;
}

export interface ScoringInput {
  grades: GradeInfo[];          // 연도별 평가등급+점수
  finalPoints: number;          // 최종 포인트
  requiredPoints: number;       // 다음 레벨 기준 포인트
  creditScore: number;          // 학점
  requiredCredits: number;      // 다음 레벨 기준 학점
  yearsOfService: number;       // 연차
  minTenure: number;            // 기준 체류연수
  sameLevelAvgPoints: number;   // 동일 레벨 평균 포인트
  sameLevelAvgCredits: number;  // 동일 레벨 평균 학점
}

export interface AiScoreResult {
  totalScore: number;
  trendScore: number;
  pointsExcessScore: number;
  creditsExcessScore: number;
  stabilityScore: number;
  maturityScore: number;
  grade: string; // S/A/B/C/D
  details: string[];
}

export function calculateAiScore(input: ScoringInput): AiScoreResult {
  // === 1. 성과 추세 점수 (30%) ===
  const recentGrades = [...input.grades]
    .sort((a, b) => a.year - b.year)
    .slice(-3);

  let trendScore = 50;
  if (recentGrades.length >= 2) {
    const n = recentGrades.length;
    const xMean = (n - 1) / 2;
    const yMean = recentGrades.reduce((s, g) => s + g.points, 0) / n;
    let num = 0, den = 0;
    recentGrades.forEach((g, i) => {
      num += (i - xMean) * (g.points - yMean);
      den += (i - xMean) ** 2;
    });
    const slope = den !== 0 ? num / den : 0;
    // slope: -4(급하락)~+4(급상승). 정규화: -4→0, 0→50, +4→100
    trendScore = Math.max(0, Math.min(100, 50 + slope * 12.5));
  }

  // === 2. 포인트 초과율 점수 (25%) ===
  let pointsExcessScore = 50;
  if (input.requiredPoints > 0) {
    const excessRate = (input.finalPoints - input.requiredPoints) / input.requiredPoints;
    // -100%→0, 0%→50, +30%이상→100
    pointsExcessScore = Math.max(0, Math.min(100, 50 + excessRate * 166));
  }

  // === 3. 학점 초과율 점수 (20%) ===
  let creditsExcessScore = 50;
  if (input.requiredCredits > 0) {
    const excessRate = (input.creditScore - input.requiredCredits) / input.requiredCredits;
    creditsExcessScore = Math.max(0, Math.min(100, 50 + excessRate * 166));
  } else {
    creditsExcessScore = input.creditScore > 0 ? 80 : 50;
  }

  // === 4. 평가 안정성 점수 (15%) ===
  let stabilityScore = 50;
  if (input.grades.length >= 2) {
    const pts = input.grades.map((g) => g.points);
    const mean = pts.reduce((s, p) => s + p, 0) / pts.length;
    const variance = pts.reduce((s, p) => s + (p - mean) ** 2, 0) / pts.length;
    const stdDev = Math.sqrt(variance);
    // stdDev 0→100, 2→0
    stabilityScore = Math.max(0, Math.min(100, 100 - stdDev * 50));
  }

  // === 5. 체류 성숙도 점수 (10%) ===
  let maturityScore = 50;
  if (input.minTenure > 0) {
    const ratio = input.yearsOfService / input.minTenure;
    if (ratio >= 1.0 && ratio <= 1.5) {
      maturityScore = 70 + (ratio - 1.0) * 40; // 1.0→70, 1.5→90
    } else if (ratio > 1.5) {
      maturityScore = Math.max(40, 90 - (ratio - 1.5) * 30); // 체류 과다 시 감점
    } else {
      maturityScore = Math.max(20, ratio * 60); // 미달
    }
    maturityScore = Math.min(100, maturityScore);
  }

  // === 가중 합산 ===
  const totalScore = Math.round(
    trendScore * 0.30 +
    pointsExcessScore * 0.25 +
    creditsExcessScore * 0.20 +
    stabilityScore * 0.15 +
    maturityScore * 0.10
  );

  // === 등급 ===
  let grade = "C";
  if (totalScore >= 90) grade = "S";
  else if (totalScore >= 75) grade = "A";
  else if (totalScore >= 60) grade = "B";
  else if (totalScore >= 40) grade = "C";
  else grade = "D";

  // === 상세 설명 ===
  const details: string[] = [];
  if (trendScore >= 70) details.push("성과 상승 추세");
  else if (trendScore <= 30) details.push("성과 하락 추세 주의");

  if (pointsExcessScore >= 70) details.push("포인트 여유 충족");
  if (creditsExcessScore >= 70) details.push("학점 여유 충족");
  if (stabilityScore >= 70) details.push("안정적 성과 유지");
  else if (stabilityScore <= 30) details.push("성과 편차 큼");

  if (input.finalPoints > input.sameLevelAvgPoints && input.sameLevelAvgPoints > 0) {
    details.push("동일 레벨 평균 상회");
  }

  return {
    totalScore,
    trendScore: Math.round(trendScore),
    pointsExcessScore: Math.round(pointsExcessScore),
    creditsExcessScore: Math.round(creditsExcessScore),
    stabilityScore: Math.round(stabilityScore),
    maturityScore: Math.round(maturityScore),
    grade,
    details,
  };
}
