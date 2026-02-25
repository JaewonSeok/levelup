import {
  Role,
  Level,
  EmploymentType,
  ConfirmationStatus,
  type User,
  type Point,
  type Credit,
  type Candidate,
  type Review,
  type Opinion,
  type Confirmation,
  type LevelCriteria,
  type UploadHistory,
} from "@prisma/client";

// Re-export Prisma enums & types
export {
  Role,
  Level,
  EmploymentType,
  ConfirmationStatus,
  type User,
  type Point,
  type Credit,
  type Candidate,
  type Review,
  type Opinion,
  type Confirmation,
  type LevelCriteria,
  type UploadHistory,
};

// ─────────────────────────────────────────
// 엑셀 업로드
// ─────────────────────────────────────────

/** 엑셀 템플릿 행 데이터 (SheetJS 파싱 결과) */
export interface ExcelEmployeeRow {
  본부: string;
  팀: string;
  이름: string;
  직책?: string;
  "현재 직급(레벨)": string; // "L1" ~ "L5"
  입사일자: string | number;
  연차: number;
  역량레벨?: string; // "L3-07" 형식
  레벨업연도?: number;
}

/** 업로드 검증 결과 */
export interface UploadValidationResult {
  valid: ExcelEmployeeRow[];
  errors: { row: number; message: string }[];
}

// ─────────────────────────────────────────
// 포인트 관리 화면
// ─────────────────────────────────────────

/** 포인트 화면용 집계 데이터.
 *  yearData: { [year: number]: { score, merit, penalty } }
 *  연도 컬럼은 yearsOfService 수만큼 동적 생성.
 */
export interface UserPointRow {
  userId: string;
  name: string;
  department: string;
  team: string;
  level: Level;
  competencyLevel: string | null;
  yearsOfService: number;
  yearData: Record<number, { score: number; merit: number; penalty: number }>;
  totalMerit: number;    // Σmerit (해당 레벨 전체)
  totalPenalty: number;  // Σpenalty (해당 레벨 전체)
  cumulative: number;    // Σscore + totalMerit - totalPenalty
  isMet: boolean;        // 포인트 충족 여부
}

// ─────────────────────────────────────────
// 학점 관리 화면
// ─────────────────────────────────────────

/** 학점 화면용 집계 데이터.
 *  yearData: { [year: number]: score }
 */
export interface UserCreditRow {
  userId: string;
  name: string;
  department: string;
  team: string;
  level: Level;
  competencyLevel: string | null;
  yearsOfService: number;
  hireDate: Date | null;
  yearData: Record<number, number>; // year → score
  cumulative: number;
  isMet: boolean;
}

// ─────────────────────────────────────────
// 대상자 관리 화면
// ─────────────────────────────────────────

/** 대상자 목록 행 */
export interface CandidateRow {
  candidateId: string;
  userId: string;
  name: string;
  department: string;
  team: string;
  level: Level;
  competencyLevel: string | null;
  yearsOfService: number;
  hireDate: Date | null;
  pointCumulative: number;
  creditCumulative: number;
  pointMet: boolean;
  creditMet: boolean;
  isReviewTarget: boolean;
  savedAt: Date | null; // null = 미저장, non-null = 저장됨
}

// ─────────────────────────────────────────
// 심사 화면
// ─────────────────────────────────────────

/** 심사 메인 목록 행.
 *  포인트/학점은 "현재/기준" 형식으로 표시 (예: 13/12).
 */
export interface ReviewRow {
  candidateId: string;
  reviewId: string | null;
  userId: string;
  name: string;
  department: string;
  team: string;
  level: Level;
  yearsOfService: number;
  hireDate: Date | null;
  pointCumulative: number;
  requiredPoints: number;  // LevelCriteria.requiredPoints
  creditCumulative: number;
  requiredCredits: number; // LevelCriteria.requiredCredits
  competencyScore: number | null;
  competencyEval: number | null;
  opinionFilled: boolean;  // 소속본부장 의견 저장 여부
  recommendation: boolean | null;
}

// ─────────────────────────────────────────
// 확정 화면
// ─────────────────────────────────────────

/** 확정 목록 행 */
export interface ConfirmationRow {
  candidateId: string;
  confirmationId: string | null;
  userId: string;
  name: string;
  department: string;
  team: string;
  level: Level;
  yearsOfService: number;
  hireDate: Date | null;
  pointCumulative: number;
  requiredPoints: number;
  creditCumulative: number;
  requiredCredits: number;
  competencyScore: number | null;
  recommendation: boolean | null;
  status: ConfirmationStatus;
}

/** 확정 화면 상단 요약 통계 (레벨별) */
export interface ConfirmationSummary {
  level: Level;
  totalCandidates: number;
  recommended: number;
  notRecommended: number;
  confirmed: number;
  confirmationRate: number; // 확정 / 전체 대상자 * 100
}
