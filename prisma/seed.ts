import { PrismaClient, Role, Level, EmploymentType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ── 유틸 ─────────────────────────────────────────────────────────────

/** null을 포함한 등급 배열에서 연도별 값 배분 (총합 = total) */
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

// ── 데이터 정의 ───────────────────────────────────────────────────────

const YEARS = [2021, 2022, 2023, 2024, 2025];

interface EmpRow {
  name: string;
  dept: string;
  team: string;
  level: Level;
  hireDate: string;
  yrs: number;
  grades: (string | null)[];  // 2021~2025 순서
  points: number;             // 누적 포인트
  credits: number;            // 누적 학점
}

const EMPLOYEES: EmpRow[] = [
  // ── 경영지원본부 ────────────────────────────────────────────────
  { name: "송재현", dept: "경영지원본부", team: "인사팀",  level: Level.L2, hireDate: "2018-03-02", yrs: 8,  grades: ["A","A","S","A","E"],        points: 12, credits: 25 },
  { name: "한소희", dept: "경영지원본부", team: "인사팀",  level: Level.L1, hireDate: "2022-07-15", yrs: 4,  grades: [null,null,"B","A","G"],      points: 4,  credits: 10 },
  { name: "윤지호", dept: "경영지원본부", team: "재무팀",  level: Level.L3, hireDate: "2015-01-10", yrs: 11, grades: ["S","A","A","A","O"],        points: 15, credits: 30 },
  { name: "배수연", dept: "경영지원본부", team: "재무팀",  level: Level.L2, hireDate: "2019-09-01", yrs: 7,  grades: ["B","A","A","S","E"],        points: 11, credits: 22 },
  { name: "구본석", dept: "경영지원본부", team: "총무팀",  level: Level.L2, hireDate: "2020-03-15", yrs: 6,  grades: ["A","B","A","A","G"],        points: 10, credits: 20 },
  { name: "임하늘", dept: "경영지원본부", team: "총무팀",  level: Level.L1, hireDate: "2023-01-02", yrs: 3,  grades: [null,null,null,"B","G"],     points: 3,  credits: 8  },

  // ── 연구개발본부 ────────────────────────────────────────────────
  { name: "김도윤", dept: "연구개발본부", team: "개발1팀", level: Level.L3, hireDate: "2014-05-12", yrs: 12, grades: ["A","S","A","S","O"],        points: 16, credits: 35 },
  { name: "박서진", dept: "연구개발본부", team: "개발1팀", level: Level.L2, hireDate: "2018-08-20", yrs: 8,  grades: ["A","A","B","A","E"],        points: 11, credits: 24 },
  { name: "이준혁", dept: "연구개발본부", team: "개발2팀", level: Level.L2, hireDate: "2019-11-11", yrs: 7,  grades: ["B","A","A","A","E"],        points: 12, credits: 22 },
  { name: "정하은", dept: "연구개발본부", team: "개발2팀", level: Level.L1, hireDate: "2021-06-01", yrs: 5,  grades: [null,"B","A","B","G"],       points: 5,  credits: 12 },
  { name: "최원빈", dept: "연구개발본부", team: "QA팀",   level: Level.L3, hireDate: "2013-02-18", yrs: 13, grades: ["S","A","S","A","O"],        points: 18, credits: 38 },
  { name: "강예린", dept: "연구개발본부", team: "QA팀",   level: Level.L2, hireDate: "2020-04-01", yrs: 6,  grades: ["A","B","A","A","E"],        points: 10, credits: 20 },
  { name: "오승우", dept: "연구개발본부", team: "QA팀",   level: Level.L1, hireDate: "2022-09-15", yrs: 4,  grades: [null,null,"B","A","G"],      points: 4,  credits: 11 },

  // ── 품질경영본부 ────────────────────────────────────────────────
  { name: "신유진", dept: "품질경영본부", team: "품질관리팀", level: Level.L3, hireDate: "2015-03-02", yrs: 11, grades: ["A","A","S","A","O"],    points: 14, credits: 28 },
  { name: "황민재", dept: "품질경영본부", team: "품질관리팀", level: Level.L2, hireDate: "2019-01-15", yrs: 7,  grades: ["B","A","A","A","E"],    points: 11, credits: 23 },
  { name: "조아라", dept: "품질경영본부", team: "인증팀",    level: Level.L2, hireDate: "2018-07-01", yrs: 8,  grades: ["A","A","B","S","E"],    points: 12, credits: 25 },
  { name: "문태호", dept: "품질경영본부", team: "인증팀",    level: Level.L1, hireDate: "2021-12-01", yrs: 5,  grades: [null,"B","A","A","G"],   points: 5,  credits: 13 },
  { name: "류세아", dept: "품질경영본부", team: "품질기획팀", level: Level.L1, hireDate: "2023-05-10", yrs: 3,  grades: [null,null,null,"A","G"], points: 3,  credits: 9  },

  // ── 마케팅본부 ──────────────────────────────────────────────────
  { name: "나윤서", dept: "마케팅본부", team: "마케팅기획팀",   level: Level.L3, hireDate: "2016-02-15", yrs: 10, grades: ["A","A","A","S","O"],    points: 15, credits: 32 },
  { name: "서동현", dept: "마케팅본부", team: "마케팅기획팀",   level: Level.L2, hireDate: "2019-05-01", yrs: 7,  grades: ["B","A","A","A","E"],    points: 10, credits: 21 },
  { name: "장미래", dept: "마케팅본부", team: "브랜드팀",       level: Level.L2, hireDate: "2020-01-06", yrs: 6,  grades: ["A","B","B","A","G"],    points: 9,  credits: 18 },
  { name: "한예솔", dept: "마케팅본부", team: "브랜드팀",       level: Level.L1, hireDate: "2022-03-14", yrs: 4,  grades: [null,null,"A","B","G"],  points: 4,  credits: 10 },
  { name: "권태양", dept: "마케팅본부", team: "디지털마케팅팀", level: Level.L1, hireDate: "2023-08-01", yrs: 3,  grades: [null,null,null,"A","N"], points: 2,  credits: 7  },

  // ── 글로벌기술지원본부 ──────────────────────────────────────────
  { name: "백승호", dept: "글로벌기술지원본부", team: "기술지원1팀", level: Level.L3, hireDate: "2014-11-03", yrs: 12, grades: ["S","A","A","A","O"],  points: 16, credits: 33 },
  { name: "양서윤", dept: "글로벌기술지원본부", team: "기술지원1팀", level: Level.L2, hireDate: "2018-06-18", yrs: 8,  grades: ["A","A","A","B","E"],  points: 11, credits: 23 },
  { name: "홍지민", dept: "글로벌기술지원본부", team: "기술지원2팀", level: Level.L2, hireDate: "2019-08-12", yrs: 7,  grades: ["B","B","A","A","E"],  points: 10, credits: 20 },
  { name: "우채원", dept: "글로벌기술지원본부", team: "기술지원2팀", level: Level.L1, hireDate: "2021-04-05", yrs: 5,  grades: [null,"A","B","A","G"], points: 5,  credits: 12 },
  { name: "남도현", dept: "글로벌기술지원본부", team: "해외기술팀",  level: Level.L3, hireDate: "2016-07-22", yrs: 10, grades: ["A","S","A","A","E"],  points: 14, credits: 29 },
  { name: "차은우", dept: "글로벌기술지원본부", team: "해외기술팀",  level: Level.L1, hireDate: "2022-11-01", yrs: 4,  grades: [null,null,"A","A","G"], points: 4, credits: 11 },

  // ── 국내영업총괄본부 ────────────────────────────────────────────
  { name: "고민수", dept: "국내영업총괄본부", team: "영업1팀",    level: Level.L3, hireDate: "2015-09-14", yrs: 11, grades: ["A","A","S","A","O"],     points: 15, credits: 30 },
  { name: "탁지안", dept: "국내영업총괄본부", team: "영업1팀",    level: Level.L2, hireDate: "2019-02-11", yrs: 7,  grades: ["A","B","A","A","E"],     points: 11, credits: 22 },
  { name: "피수현", dept: "국내영업총괄본부", team: "영업2팀",    level: Level.L2, hireDate: "2020-05-18", yrs: 6,  grades: ["B","A","A","B","G"],     points: 9,  credits: 19 },
  { name: "하윤성", dept: "국내영업총괄본부", team: "영업2팀",    level: Level.L1, hireDate: "2021-10-04", yrs: 5,  grades: [null,"A","B","A","G"],    points: 5,  credits: 13 },
  { name: "추다은", dept: "국내영업총괄본부", team: "영업지원팀", level: Level.L1, hireDate: "2023-03-20", yrs: 3,  grades: [null,null,null,"B","N"],  points: 2,  credits: 6  },
];

const DEPT_HEADS = [
  { name: "김경영", dept: "경영지원본부",      email: "kimky@rsupport.com",   pw: "1234567" },
  { name: "이연구", dept: "연구개발본부",      email: "leeyg@rsupport.com",   pw: "2345678" },
  { name: "박품질", dept: "품질경영본부",      email: "parkpj@rsupport.com",  pw: "3456789" },
  { name: "최마케", dept: "마케팅본부",        email: "choimk@rsupport.com",  pw: "4567890" },
  { name: "정글로", dept: "글로벌기술지원본부", email: "junggr@rsupport.com", pw: "5678901" },
  { name: "강영업", dept: "국내영업총괄본부",   email: "kangyb@rsupport.com",  pw: "6789012" },
];

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding database...");

  // 1. 기존 데이터 삭제 (의존성 역순)
  console.log("  Deleting existing data...");
  await prisma.opinion.deleteMany();
  await prisma.review.deleteMany();
  await prisma.confirmation.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.credit.deleteMany();
  await prisma.point.deleteMany();
  await prisma.performanceGrade.deleteMany();
  await prisma.uploadHistory.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  console.log("  ✓ Existing data deleted");

  // 2. Admin 계정
  const adminPw = await bcrypt.hash("admin1234", 10);
  await prisma.user.create({
    data: {
      name: "관리자",
      email: "admin@rsupport.com",
      password: adminPw,
      department: "인사팀",
      team: "",
      role: Role.SYSTEM_ADMIN,
    },
  });
  console.log("  ✓ Admin created (admin@rsupport.com / admin1234)");

  // 3. 본부장 계정
  for (const dh of DEPT_HEADS) {
    const hashed = await bcrypt.hash(dh.pw, 10);
    await prisma.user.create({
      data: {
        name: dh.name,
        email: dh.email,
        password: hashed,
        residentIdLast7: dh.pw,
        department: dh.dept,
        team: "",
        role: Role.DEPT_HEAD,
      },
    });
  }
  console.log(`  ✓ ${DEPT_HEADS.length} dept heads created`);

  // 4. 직원 + 포인트/학점/등급
  let empCount = 0;
  for (const emp of EMPLOYEES) {
    const competencyLevel = `${emp.level}-${String(emp.yrs).padStart(2, "0")}`;

    const user = await prisma.user.create({
      data: {
        name: emp.name,
        department: emp.dept,
        team: emp.team,
        level: emp.level,
        employmentType: EmploymentType.REGULAR,
        hireDate: new Date(emp.hireDate),
        yearsOfService: emp.yrs,
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
        data: gradeRecords.map((r) => ({
          userId: user.id,
          year: r.year,
          grade: r.grade,
        })),
      });
    }

    // Point records
    const pointPerYear = distributeValues(emp.grades, emp.points);
    let pointCumulative = 0;
    const pointRecords: { userId: string; year: number; score: number; cumulative: number }[] = [];
    for (let i = 0; i < YEARS.length; i++) {
      if (emp.grades[i] !== null) {
        pointCumulative = Math.round((pointCumulative + pointPerYear[i]) * 10) / 10;
        pointRecords.push({ userId: user.id, year: YEARS[i], score: pointPerYear[i], cumulative: pointCumulative });
      }
    }
    if (pointRecords.length > 0) {
      pointRecords[pointRecords.length - 1].cumulative = emp.points;
      await prisma.point.createMany({ data: pointRecords });
    }

    // Credit records
    const creditPerYear = distributeValues(emp.grades, emp.credits);
    let creditCumulative = 0;
    const creditRecords: { userId: string; year: number; score: number; cumulative: number }[] = [];
    for (let i = 0; i < YEARS.length; i++) {
      if (emp.grades[i] !== null) {
        creditCumulative = Math.round((creditCumulative + creditPerYear[i]) * 10) / 10;
        creditRecords.push({ userId: user.id, year: YEARS[i], score: creditPerYear[i], cumulative: creditCumulative });
      }
    }
    if (creditRecords.length > 0) {
      creditRecords[creditRecords.length - 1].cumulative = emp.credits;
      await prisma.credit.createMany({ data: creditRecords });
    }

    empCount++;
  }
  console.log(`  ✓ ${empCount} employees created (with points, credits, grades)`);

  console.log("\n✅ Seed complete!");
  console.log("   Admin    : admin@rsupport.com / admin1234");
  console.log("   본부장   : kimky@rsupport.com  / 1234567  (경영지원본부)");
  console.log("            : leeyg@rsupport.com  / 2345678  (연구개발본부)");
  console.log("            : parkpj@rsupport.com / 3456789  (품질경영본부)");
  console.log("            : choimk@rsupport.com / 4567890  (마케팅본부)");
  console.log("            : junggr@rsupport.com / 5678901  (글로벌기술지원본부)");
  console.log("            : kangyb@rsupport.com / 6789012  (국내영업총괄본부)");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
