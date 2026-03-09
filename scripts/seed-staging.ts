/**
 * seed-staging.ts — 정보보안 검수용 Staging 더미 데이터 시드 스크립트
 *
 * ⚠️  이 스크립트는 반드시 .env.staging 파일이 있어야 실행됩니다.
 * ⚠️  실행 전 스테이징 DB URL이 운영 DB와 다른지 반드시 확인하세요.
 *
 * 실행 방법:
 *   npx tsx scripts/seed-staging.ts
 *   또는
 *   npm run db:seed:staging
 */

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

// ─── .env.staging 로드 (반드시 PrismaClient 인스턴스 생성 전에 실행) ────────
const envPath = resolve(process.cwd(), ".env.staging");
const envResult = dotenvConfig({ path: envPath });
if (envResult.error) {
  console.error(`\n❌ .env.staging 파일을 찾을 수 없습니다.`);
  console.error(`   경로: ${envPath}`);
  console.error(`   .env.staging 파일을 먼저 생성하세요. (docs/STAGING-SETUP.md 참고)\n`);
  process.exit(1);
}

import { PrismaClient, Role, Level, EmploymentType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ══════════════════════════════════════════════════════════════════════════════
// 상수 정의
// ══════════════════════════════════════════════════════════════════════════════

const YEARS = [2021, 2022, 2023, 2024, 2025];

const GRADE_POINTS: Record<string, Record<string, number>> = {
  "2022-2024": { S: 4, A: 3, B: 2, C: 1 },
  "2025": { S: 4, O: 3, E: 2.5, G: 2, N: 1.5, U: 1 },
};

const DEFAULT_GRADE_CRITERIA = [
  { grade: "S", yearRange: "2022-2024", points: 4 },
  { grade: "A", yearRange: "2022-2024", points: 3 },
  { grade: "B", yearRange: "2022-2024", points: 2 },
  { grade: "C", yearRange: "2022-2024", points: 1 },
  { grade: "S", yearRange: "2025", points: 4 },
  { grade: "O", yearRange: "2025", points: 3 },
  { grade: "E", yearRange: "2025", points: 2.5 },
  { grade: "G", yearRange: "2025", points: 2 },
  { grade: "N", yearRange: "2025", points: 1.5 },
  { grade: "U", yearRange: "2025", points: 1 },
];

const DEFAULT_LEVEL_CRITERIA = [
  { level: Level.L0, year: 2026, requiredPoints: 4,  requiredCredits: 0,  minTenure: 2 },
  { level: Level.L1, year: 2026, requiredPoints: 4,  requiredCredits: 8,  minTenure: 2 },
  { level: Level.L2, year: 2026, requiredPoints: 4,  requiredCredits: 20, minTenure: 3 },
  { level: Level.L3, year: 2026, requiredPoints: 11, requiredCredits: 15, minTenure: 4 },
  { level: Level.L4, year: 2026, requiredPoints: 15, requiredCredits: 25, minTenure: 5 },
  { level: Level.L5, year: 2026, requiredPoints: 20, requiredCredits: 30, minTenure: 6 },
];

// ══════════════════════════════════════════════════════════════════════════════
// 한국어 가상 이름 생성
// ══════════════════════════════════════════════════════════════════════════════

const SURNAMES = [
  "강", "고", "권", "김", "남", "노", "류", "문", "박", "배",
  "백", "서", "석", "성", "송", "신", "안", "양", "오", "우",
  "윤", "이", "임", "장", "전", "정", "조", "주", "차", "채",
  "최", "한", "허", "홍", "황",
]; // 35개

const GIVEN_NAMES = [
  "가연", "가은", "건우", "경민", "경훈", "규민", "기현", "나연", "다빈", "다은",
  "다현", "도현", "도훈", "동현", "민경", "민기", "민서", "민수", "민재", "민준",
  "병준", "보영", "서연", "서영", "서윤", "서진", "서현", "서호", "세영", "세진",
  "소연", "소윤", "소희", "수민", "수연", "수영", "수진", "수현", "승민", "승우",
  "승현", "아름", "여진", "연수", "연우", "영민", "영수", "영아", "영진", "예린",
]; // 50개 — 35×50 = 1750 조합으로 150명 중복 없음

/** index → 자연스러운 한국어 가상 이름 (고유값 보장) */
function generateName(index: number): string {
  const surnameIdx = index % SURNAMES.length;
  const givenIdx = Math.floor(index / SURNAMES.length) % GIVEN_NAMES.length;
  return SURNAMES[surnameIdx] + GIVEN_NAMES[givenIdx];
}

// ══════════════════════════════════════════════════════════════════════════════
// 부서/팀 구조 (가상 조직)
// ══════════════════════════════════════════════════════════════════════════════

const DEPT_STRUCTURE = [
  { dept: "A사업본부",    teams: ["A1팀", "A2팀", "A3팀"] },
  { dept: "B사업본부",    teams: ["B1팀", "B2팀", "B3팀"] },
  { dept: "C사업본부",    teams: ["C1팀", "C2팀"] },
  { dept: "경영지원본부", teams: ["인사팀", "재무팀", "총무팀"] },
  { dept: "기술연구본부", teams: ["연구1팀", "연구2팀", "기술지원팀"] },
  { dept: "고객성공본부", teams: ["CS1팀", "CS2팀"] },
];

// ══════════════════════════════════════════════════════════════════════════════
// 결정론적 의사난수 생성기 (같은 seed → 항상 같은 데이터)
// ══════════════════════════════════════════════════════════════════════════════

class SeededRandom {
  private seed: number;
  constructor(seed: number) { this.seed = seed; }

  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) & 0xffffffff;
    return (this.seed >>> 0) / 0xffffffff;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 등급 분포 (실제 분포와 유사하게 구성)
// ══════════════════════════════════════════════════════════════════════════════

// S≈6%, A≈22%, B≈44%, C≈28%
const GRADES_OLD = [
  "S", "S",
  "A", "A", "A", "A",
  "B", "B", "B", "B", "B", "B", "B", "B",
  "C", "C", "C", "C", "C",
];

// S=5%, O=16%, E=32%, G=26%, N=16%, U=5%
const GRADES_2025 = [
  "S",
  "O", "O", "O",
  "E", "E", "E", "E", "E", "E",
  "G", "G", "G", "G", "G",
  "N", "N", "N",
  "U",
];

// ══════════════════════════════════════════════════════════════════════════════
// 레벨별 설정 (총 150명)
// ══════════════════════════════════════════════════════════════════════════════

interface LevelConfig {
  level: Level;
  count: number;
  minYears: number;
  maxYears: number;
  hireDateStart: string;
  hireDateEnd: string;
  creditMin: number;
  creditMax: number;
}

const LEVEL_CONFIGS: LevelConfig[] = [
  { level: Level.L0, count: 5,  minYears: 1, maxYears: 2,  hireDateStart: "2023-07-01", hireDateEnd: "2025-03-01", creditMin: 2,  creditMax: 8  },
  { level: Level.L1, count: 40, minYears: 2, maxYears: 4,  hireDateStart: "2021-01-01", hireDateEnd: "2024-06-30", creditMin: 5,  creditMax: 18 },
  { level: Level.L2, count: 55, minYears: 4, maxYears: 8,  hireDateStart: "2017-01-01", hireDateEnd: "2022-12-31", creditMin: 12, creditMax: 32 },
  { level: Level.L3, count: 32, minYears: 8, maxYears: 13, hireDateStart: "2012-01-01", hireDateEnd: "2018-12-31", creditMin: 20, creditMax: 45 },
  { level: Level.L4, count: 13, minYears: 12, maxYears: 16, hireDateStart: "2009-01-01", hireDateEnd: "2014-12-31", creditMin: 28, creditMax: 55 },
  { level: Level.L5, count: 5,  minYears: 15, maxYears: 20, hireDateStart: "2005-01-01", hireDateEnd: "2011-12-31", creditMin: 35, creditMax: 65 },
];
// 합계: 5+40+55+32+13+5 = 150

// ══════════════════════════════════════════════════════════════════════════════
// 직원 스펙 생성
// ══════════════════════════════════════════════════════════════════════════════

interface EmpSpec {
  index: number;
  name: string;
  dept: string;
  team: string;
  level: Level;
  hireDate: Date;
  yearsOfService: number;
  grades: (string | null)[];
  creditTotal: number;
}

function generateEmployees(): EmpSpec[] {
  const rng = new SeededRandom(2026);
  const employees: EmpSpec[] = [];
  let globalIndex = 0;

  for (const cfg of LEVEL_CONFIGS) {
    for (let i = 0; i < cfg.count; i++) {
      // 이름
      const name = generateName(globalIndex);

      // 부서/팀 (순환 배정)
      const deptInfo = DEPT_STRUCTURE[globalIndex % DEPT_STRUCTURE.length];
      const teamIdx = i % deptInfo.teams.length;

      // 입사일 (결정론적 난수)
      const startMs = new Date(cfg.hireDateStart).getTime();
      const endMs   = new Date(cfg.hireDateEnd).getTime();
      const hireDate = new Date(startMs + rng.next() * (endMs - startMs));

      const yearsOfService = rng.nextInt(cfg.minYears, cfg.maxYears);

      // 등급 생성 (입사 이전 연도 = null, L0는 2025만)
      const grades: (string | null)[] = YEARS.map((year) => {
        if (hireDate.getFullYear() > year) return null;
        if (cfg.level === Level.L0 && year < 2025) return null;
        return year <= 2024 ? rng.pick(GRADES_OLD) : rng.pick(GRADES_2025);
      });

      // 학점 (결정론적)
      const creditTotal = Math.round(
        (cfg.creditMin + rng.next() * (cfg.creditMax - cfg.creditMin)) * 10
      ) / 10;

      employees.push({
        index: globalIndex,
        name,
        dept: deptInfo.dept,
        team: deptInfo.teams[teamIdx],
        level: cfg.level,
        hireDate,
        yearsOfService,
        grades,
        creditTotal,
      });

      globalIndex++;
    }
  }

  return employees;
}

// ══════════════════════════════════════════════════════════════════════════════
// 유틸 함수
// ══════════════════════════════════════════════════════════════════════════════

function distributeValues(grades: (string | null)[], total: number): number[] {
  const activeCount = grades.filter((g) => g !== null).length;
  if (activeCount === 0) return grades.map(() => 0);

  const perYear = Math.round((total / activeCount) * 10) / 10;
  const result: number[] = [];
  let remaining = total;
  let left = activeCount;

  for (const g of grades) {
    if (g === null) {
      result.push(0);
    } else {
      left--;
      if (left === 0) {
        result.push(Math.round(remaining * 10) / 10);
      } else {
        result.push(perYear);
        remaining = Math.round((remaining - perYear) * 10) / 10;
      }
    }
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "(미설정)";
  console.log("\n🔧 Staging 시드 시작");
  console.log(`   DATABASE_URL: ${dbUrl.substring(0, 50)}...`);
  console.log("   ⚠️  운영 DB가 아닌지 반드시 확인하세요!\n");

  // ── 1. 전체 초기화 ─────────────────────────────────────────────────────────
  console.log("  1. 기존 데이터 전체 삭제...");
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = 0`);
      await tx.$executeRawUnsafe(`
        TRUNCATE TABLE opinions, reviews, confirmations, candidates, submissions,
          bonus_penalties, credits, points, performance_grades,
          upload_histories, sessions, accounts
        RESTART IDENTITY CASCADE
      `);
      await tx.$executeRawUnsafe(`DELETE FROM users`);
    },
    { timeout: 300_000 }
  );
  console.log("  ✓ 초기화 완료\n");

  // ── 2. 검수용 테스트 계정 4개 ─────────────────────────────────────────────
  console.log("  2. 검수용 계정 생성...");
  const reviewPw = await bcrypt.hash("Security@Review2026", 10);

  const TEST_ACCOUNTS = [
    { name: "시스템관리자",  email: "admin@staging.levelup.local",   role: Role.SYSTEM_ADMIN, department: "경영지원본부", team: "인사팀" },
    { name: "인사팀담당자",  email: "hr@staging.levelup.local",      role: Role.HR_TEAM,      department: "경영지원본부", team: "인사팀" },
    { name: "A본부장",       email: "manager@staging.levelup.local", role: Role.DEPT_HEAD,    department: "A사업본부",   team: "" },
    { name: "일반직원",      email: "user@staging.levelup.local",    role: Role.TEAM_MEMBER,  department: "B사업본부",   team: "B1팀" },
  ];

  for (const acct of TEST_ACCOUNTS) {
    await prisma.user.create({
      data: {
        ...acct,
        password: reviewPw,
        level: Level.L3,
        employmentType: EmploymentType.REGULAR,
        yearsOfService: 5,
        isActive: true,
      },
    });
  }
  console.log("  ✓ 검수 계정 4개 생성 완료\n");

  // ── 3. 더미 직원 150명 ────────────────────────────────────────────────────
  console.log("  3. 더미 직원 150명 생성 중...");
  const employees = generateEmployees();
  let empCount = 0;

  for (const emp of employees) {
    const seq = String(emp.index + 1).padStart(3, "0");
    const email = `test.user${seq}@staging.levelup.local`;
    const competencyLevel = `${emp.level}-${String(emp.yearsOfService).padStart(2, "0")}`;

    const user = await prisma.user.create({
      data: {
        name: emp.name,
        email,
        department: emp.dept,
        team: emp.team,
        level: emp.level,
        employmentType: EmploymentType.REGULAR,
        hireDate: emp.hireDate,
        yearsOfService: emp.yearsOfService,
        competencyLevel,
        isActive: true,
        role: Role.TEAM_MEMBER,
      },
    });

    // PerformanceGrade
    const gradeRecords = emp.grades
      .map((grade, i) => ({ year: YEARS[i], grade }))
      .filter((r): r is { year: number; grade: string } => r.grade !== null);

    if (gradeRecords.length > 0) {
      await prisma.performanceGrade.createMany({
        data: gradeRecords.map((r) => ({ userId: user.id, year: r.year, grade: r.grade })),
      });
    }

    // Point (2022년 이후만)
    const gradePointScores: { year: number; score: number }[] = [];
    for (let i = 0; i < YEARS.length; i++) {
      const grade = emp.grades[i];
      const year  = YEARS[i];
      if (!grade || year < 2022) continue;
      const yearRange = year <= 2024 ? "2022-2024" : "2025";
      const score = GRADE_POINTS[yearRange]?.[grade] ?? 2; // 기본값 2점
      gradePointScores.push({ year, score });
    }

    const pointTotal = Math.round(
      gradePointScores.reduce((s, r) => s + r.score, 0) * 10
    ) / 10;
    const pointCriteria = DEFAULT_LEVEL_CRITERIA.find((c) => c.level === emp.level);
    const pointIsMet = pointCriteria ? pointTotal >= pointCriteria.requiredPoints : false;

    if (gradePointScores.length > 0) {
      await prisma.point.createMany({
        data: gradePointScores.map(({ year, score }) => ({
          userId: user.id, year, score, cumulative: pointTotal, isMet: pointIsMet,
        })),
      });
    }

    // Credit
    const creditPerYear = distributeValues(emp.grades, emp.creditTotal);
    let creditCumulative = 0;
    const creditRecords: {
      userId: string; year: number; score: number; cumulative: number; isMet: boolean;
    }[] = [];

    for (let i = 0; i < YEARS.length; i++) {
      if (emp.grades[i] !== null) {
        creditCumulative = Math.round((creditCumulative + creditPerYear[i]) * 10) / 10;
        creditRecords.push({
          userId: user.id,
          year: YEARS[i],
          score: creditPerYear[i],
          cumulative: creditCumulative,
          isMet: false,
        });
      }
    }

    if (creditRecords.length > 0) {
      const creditCriteria = DEFAULT_LEVEL_CRITERIA.find((c) => c.level === emp.level);
      const creditIsMet = creditCriteria
        ? emp.creditTotal >= creditCriteria.requiredCredits
        : false;
      creditRecords[creditRecords.length - 1].cumulative = emp.creditTotal;
      creditRecords[creditRecords.length - 1].isMet = creditIsMet;
      await prisma.credit.createMany({ data: creditRecords });
    }

    empCount++;
    if (empCount % 30 === 0) {
      console.log(`     ... ${empCount}/150 완료`);
    }
  }
  console.log(`  ✓ ${empCount}명 더미 직원 생성 완료\n`);

  // ── 4. 기준 데이터 ────────────────────────────────────────────────────────
  console.log("  4. 기준 데이터(GradeCriteria, LevelCriteria) 설정...");

  for (const gc of DEFAULT_GRADE_CRITERIA) {
    await prisma.gradeCriteria.upsert({
      where: { grade_yearRange: { grade: gc.grade, yearRange: gc.yearRange } },
      update: { points: gc.points },
      create: gc,
    });
  }

  for (const lc of DEFAULT_LEVEL_CRITERIA) {
    await prisma.levelCriteria.upsert({
      where: { level_year: { level: lc.level, year: lc.year } },
      update: {},
      create: lc,
    });
  }
  console.log("  ✓ 기준 데이터 설정 완료\n");

  // ── 완료 출력 ──────────────────────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║          ✅  Staging 시드 완료                       ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  [검수 계정] 비밀번호: Security@Review2026           ║");
  console.log("║                                                      ║");
  console.log("║  관리자   admin@staging.levelup.local                ║");
  console.log("║  인사팀   hr@staging.levelup.local                   ║");
  console.log("║  본부장   manager@staging.levelup.local              ║");
  console.log("║  일반직원 user@staging.levelup.local                 ║");
  console.log("║                                                      ║");
  console.log("║  더미 직원 150명: test.user001~150@staging.levelup.local ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("\n  💡 팁: 대상자 자동 선정은 웹에서 [기준 저장] 또는");
  console.log("         /api/candidates/auto-select (POST) 를 통해 실행하세요.\n");
}

main()
  .catch((e) => {
    console.error("\n❌ 시드 실패:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
