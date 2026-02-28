/**
 * 엑셀 파싱 + 유효성 검증
 * 서버(API Route)와 클라이언트(미리보기) 양쪽에서 사용.
 * Prisma 의존성 없음 — string 기반 타입 사용.
 */
import * as XLSX from "xlsx";

// ─────────────────────────────────────────
// 컬럼 헤더 별칭 맵핑 (다양한 표기 허용)
// ─────────────────────────────────────────
const COLUMN_ALIASES: Record<string, string> = {
  본부: "department",
  소속본부: "department",
  팀: "team",
  소속팀: "team",
  이름: "name",
  성명: "name",
  직책: "position",
  현재직급: "level",
  "현재직급(레벨)": "level",
  직급: "level",
  레벨: "level",
  현재레벨: "level",
  입사일자: "hireDate",
  입사일: "hireDate",
  연차: "yearsOfService",
  역량레벨: "competencyLevel",
  레벨업연도: "levelUpYear",
  포인트: "pointScore",
  학점: "creditScore",
  // 연도별 평가등급 (2022~2025)
  "2021평가등급": "grade2021",
  "2022평가등급": "grade2022",
  "2023평가등급": "grade2023",
  "2024평가등급": "grade2024",
  "2025평가등급": "grade2025",
};

// ─────────────────────────────────────────
// 공개 타입
// ─────────────────────────────────────────

export type ParsedLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5";

export interface ParsedEmployee {
  sheet: string;          // 시트명
  rowIndex: number;       // 파일 내 1-based 데이터 행 번호 (헤더 제외)
  department: string;
  team: string;
  name: string;
  position: string;
  level: ParsedLevel | null;
  hireDate: Date | null;
  hireDateStr: string;    // 표시용 "YYYY-MM-DD"
  yearsOfService: number;
  competencyLevel: string;
  levelUpYear: number | null;
  // 포인트/학점 점수 (선택)
  pointScore: number | null;
  creditScore: number | null;
  // 연도별 평가등급 (선택)
  grade2021: string | null;
  grade2022: string | null;
  grade2023: string | null;
  grade2024: string | null;
  grade2025: string | null;
  errors: string[];       // 빈 배열이면 유효한 행
}

// ─────────────────────────────────────────
// 내부 파싱 헬퍼
// ─────────────────────────────────────────

const VALID_LEVELS = new Set<string>(["L0", "L1", "L2", "L3", "L4", "L5"]);
const VALID_GRADES_2022_2024 = new Set(["S", "A", "B", "C"]);
const VALID_GRADES_2025 = new Set(["S", "O", "E", "G", "N", "U"]);

function parseLevel(raw: unknown): ParsedLevel | null {
  const s = String(raw ?? "").trim().toUpperCase();
  return VALID_LEVELS.has(s) ? (s as ParsedLevel) : null;
}

function parseDateValue(value: unknown): { date: Date | null; str: string } {
  if (value == null || value === "") return { date: null, str: "" };

  // SheetJS cellDates:true → Date 객체
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return { date: null, str: "" };
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return { date: value, str: `${y}-${m}-${d}` };
  }

  // 문자열 날짜 (YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD)
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[./]/g, "-");
    const match = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
      const [, y, mo, d] = match;
      const date = new Date(Number(y), Number(mo) - 1, Number(d));
      if (!isNaN(date.getTime())) {
        return {
          date,
          str: `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`,
        };
      }
    }
    return { date: null, str: value };
  }

  // Excel 시리얼 숫자 날짜 (1900-01-01 기준)
  if (typeof value === "number" && value > 0) {
    const MS_PER_DAY = 86400000;
    // Excel의 1900 윤년 버그 보정: 60 이전은 그대로, 이후 -1
    const adjusted = value > 59 ? value - 1 : value;
    const date = new Date(Date.UTC(1899, 11, 31) + adjusted * MS_PER_DAY);
    if (!isNaN(date.getTime()) && date.getUTCFullYear() > 1900) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, "0");
      const d = String(date.getUTCDate()).padStart(2, "0");
      return { date, str: `${y}-${m}-${d}` };
    }
  }

  return { date: null, str: String(value) };
}

function parseNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

function isRowBlank(row: Record<string, unknown>): boolean {
  return Object.values(row).every(
    (v) => v == null || String(v).trim() === ""
  );
}

// ─────────────────────────────────────────
// 메인 파싱 함수 (서버 + 클라이언트 공용)
// ─────────────────────────────────────────

export function parseExcelFile(buffer: ArrayBuffer): ParsedEmployee[] {
  const uint8 = new Uint8Array(buffer);
  const workbook = XLSX.read(uint8, { type: "array", cellDates: true });

  const results: ParsedEmployee[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      raw: true,    // 숫자/날짜 원형 유지 (cellDates와 함께 사용)
      defval: null, // 빈 셀 → null
    });

    if (rows.length === 0) continue;

    // 헤더 키 → 필드명 맵 구성 (첫 번째 행의 키 기준)
    const headerKeys = Object.keys(rows[0]);
    const fieldMap: Record<string, string> = {};
    for (const key of headerKeys) {
      const alias = COLUMN_ALIASES[key.trim()];
      if (alias) fieldMap[key] = alias;
    }

    // 필수 컬럼 누락 체크
    const foundFields = new Set(Object.values(fieldMap));
    const requiredFields = ["department", "team", "name", "level", "hireDate", "yearsOfService"];
    const missingFields = requiredFields.filter((f) => !foundFields.has(f));
    if (missingFields.length > 0) {
      // 필수 컬럼이 하나도 없으면 이 시트는 건너뜀 (안내 시트 등)
      if (missingFields.length === requiredFields.length) continue;
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isRowBlank(row)) continue;

      // 필드명 기준으로 값 추출
      const mapped: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        const field = fieldMap[key];
        if (field) mapped[field] = value;
      }

      const errors: string[] = [];

      // ── 필수 필드 ────────────────────────────────
      const department = String(mapped.department ?? "").trim();
      const team = String(mapped.team ?? "").trim();
      const name = String(mapped.name ?? "").trim();

      if (!department) errors.push("본부 필수");
      if (!team) errors.push("팀 필수");
      if (!name) errors.push("이름 필수");

      const level = parseLevel(mapped.level);
      if (!mapped.level) {
        errors.push("현재레벨 필수");
      } else if (!level) {
        errors.push(`레벨 오류 (L1~L5): "${mapped.level}"`);
      }

      const { date: hireDate, str: hireDateStr } = parseDateValue(mapped.hireDate);
      if (!mapped.hireDate) {
        errors.push("입사일자 필수");
      } else if (!hireDate) {
        errors.push(`입사일자 형식 오류 (YYYY-MM-DD): "${mapped.hireDate}"`);
      }

      const yearsRaw = mapped.yearsOfService;
      const yearsOfService = Number(yearsRaw);
      if (yearsRaw == null || yearsRaw === "") {
        errors.push("연차 필수");
      } else if (isNaN(yearsOfService) || yearsOfService < 0) {
        errors.push(`연차 오류 (0 이상의 정수): "${yearsRaw}"`);
      }

      // ── 선택 필드 ────────────────────────────────
      const position = String(mapped.position ?? "").trim();
      const competencyLevel = String(mapped.competencyLevel ?? "").trim();

      // 역량레벨 형식 검증: L{1-5}-{2자리 숫자} (예: L3-07)
      if (competencyLevel && !/^L[1-5]-\d{2}$/.test(competencyLevel)) {
        errors.push(`역량레벨 형식 오류 (예: L3-07): "${competencyLevel}"`);
      }

      let levelUpYear: number | null = null;
      if (mapped.levelUpYear != null && mapped.levelUpYear !== "") {
        const n = Number(mapped.levelUpYear);
        if (isNaN(n) || n < 2000 || n > 2100) {
          errors.push(`레벨업연도 오류 (2000~2100): "${mapped.levelUpYear}"`);
        } else {
          levelUpYear = n;
        }
      }

      // 포인트/학점 점수 (선택)
      const pointScore = parseNumberOrNull(mapped.pointScore);
      const creditScore = parseNumberOrNull(mapped.creditScore);

      // 연도별 평가등급 (선택) — 유효성 검증 포함
      // 일부 시스템에서 "N" → "NI" 등으로 표기하는 경우를 위한 별칭 맵
      const GRADE_ALIASES: Record<string, string> = { NI: "N" };
      const parseGradeField = (raw: unknown, validSet: Set<string>, label: string): string | null => {
        if (raw == null || raw === "") return null;
        const s = String(raw).trim().toUpperCase();
        if (!s || s === "-") return null; // 빈칸·"-"는 평가 없음(정상)
        if (validSet.has(s)) return s;
        // 별칭 처리 (예: NI → N)
        const aliased = GRADE_ALIASES[s];
        if (aliased && validSet.has(aliased)) return aliased;
        errors.push(`${label} 평가등급 오류 (${Array.from(validSet).join("/")}): "${s}"`);
        return null;
      };
      const grade2021 = parseGradeField(mapped.grade2021, VALID_GRADES_2022_2024, "2021년");
      const grade2022 = parseGradeField(mapped.grade2022, VALID_GRADES_2022_2024, "2022년");
      const grade2023 = parseGradeField(mapped.grade2023, VALID_GRADES_2022_2024, "2023년");
      const grade2024 = parseGradeField(mapped.grade2024, VALID_GRADES_2022_2024, "2024년");
      const grade2025 = parseGradeField(mapped.grade2025, VALID_GRADES_2025, "2025년");

      results.push({
        sheet: sheetName,
        rowIndex: i + 2, // 헤더가 행1, 데이터는 행2부터
        department,
        team,
        name,
        position,
        level,
        hireDate,
        hireDateStr,
        yearsOfService: isNaN(yearsOfService) ? 0 : Math.max(0, Math.floor(yearsOfService)),
        competencyLevel,
        levelUpYear,
        pointScore,
        creditScore,
        grade2021,
        grade2022,
        grade2023,
        grade2024,
        grade2025,
        errors,
      });
    }
  }

  return results;
}
