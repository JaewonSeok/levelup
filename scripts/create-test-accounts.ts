/**
 * QA 테스트용 계정 10개 생성 스크립트
 *
 * 실행:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/create-test-accounts.ts
 *
 * 생성되는 계정 (비밀번호 모두 bcrypt 해시 처리):
 *   qa-hr01@rsupport.com      / QAtest1234!  (HR_TEAM)
 *   qa-hr02@rsupport.com      / QAtest1234!  (HR_TEAM)
 *   qa-dept01@rsupport.com    / QAtest1234!  (DEPT_HEAD)
 *   qa-dept02@rsupport.com    / QAtest1234!  (DEPT_HEAD)
 *   qa-dept03@rsupport.com    / QAtest1234!  (DEPT_HEAD)
 *   qa-section@rsupport.com   / QAtest1234!  (SECTION_CHIEF)
 *   qa-leader01@rsupport.com  / QAtest1234!  (TEAM_LEADER)
 *   qa-leader02@rsupport.com  / QAtest1234!  (TEAM_LEADER)
 *   qa-member@rsupport.com    / QAtest1234!  (TEAM_MEMBER)
 *   qa-ceo@rsupport.com       / QAtest1234!  (CEO)
 */

import { PrismaClient, Role, Level, EmploymentType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PLAIN_PASSWORD = "QAtest1234!";

interface TestAccountDef {
  email: string;
  name: string;
  department: string;
  team: string;
  role: Role;
  level?: Level;
  description: string;
}

const TEST_ACCOUNTS: TestAccountDef[] = [
  {
    email:       "qa-hr01@rsupport.com",
    name:        "QA인사01",
    department:  "인사팀",
    team:        "인사팀",
    role:        Role.HR_TEAM,
    description: "HR_TEAM — 포인트/학점/대상자 관리 권한",
  },
  {
    email:       "qa-hr02@rsupport.com",
    name:        "QA인사02",
    department:  "인사팀",
    team:        "인사팀",
    role:        Role.HR_TEAM,
    description: "HR_TEAM — 동시 접근 테스트용",
  },
  {
    email:       "qa-dept01@rsupport.com",
    name:        "QA본부장01",
    department:  "연구개발본부",
    team:        "",
    role:        Role.DEPT_HEAD,
    description: "DEPT_HEAD — 심사 의견 입력 권한",
  },
  {
    email:       "qa-dept02@rsupport.com",
    name:        "QA본부장02",
    department:  "마케팅본부",
    team:        "",
    role:        Role.DEPT_HEAD,
    description: "DEPT_HEAD — 타본부장 의견 테스트용",
  },
  {
    email:       "qa-dept03@rsupport.com",
    name:        "QA본부장03",
    department:  "글로벌기술지원본부",
    team:        "",
    role:        Role.DEPT_HEAD,
    description: "DEPT_HEAD — 세션 격리 테스트용",
  },
  {
    email:       "qa-section@rsupport.com",
    name:        "QA실장01",
    department:  "연구개발본부",
    team:        "개발1팀",
    role:        Role.SECTION_CHIEF,
    description: "SECTION_CHIEF — 팀 조회 권한",
  },
  {
    email:       "qa-leader01@rsupport.com",
    name:        "QA팀장01",
    department:  "연구개발본부",
    team:        "개발1팀",
    role:        Role.TEAM_LEADER,
    description: "TEAM_LEADER — 소속 팀 조회 권한",
  },
  {
    email:       "qa-leader02@rsupport.com",
    name:        "QA팀장02",
    department:  "마케팅본부",
    team:        "마케팅기획팀",
    role:        Role.TEAM_LEADER,
    description: "TEAM_LEADER — 동시 접근 테스트용",
  },
  {
    email:       "qa-member@rsupport.com",
    name:        "QA팀원01",
    department:  "연구개발본부",
    team:        "개발1팀",
    role:        Role.TEAM_MEMBER,
    level:       Level.L2,
    description: "TEAM_MEMBER — 본인 정보만 조회",
  },
  {
    email:       "qa-ceo@rsupport.com",
    name:        "QA대표이사",
    department:  "경영본부",
    team:        "",
    role:        Role.CEO,
    description: "CEO — 최종 확정 권한",
  },
];

async function main() {
  console.log("🔧 QA 테스트 계정 생성 시작...\n");

  const hashedPw = await bcrypt.hash(PLAIN_PASSWORD, 10);
  console.log(`  비밀번호 해시 생성 완료 (rounds=10)`);
  console.log(`  평문: ${PLAIN_PASSWORD}\n`);

  let created = 0;
  let updated = 0;

  for (const acc of TEST_ACCOUNTS) {
    const existing = await prisma.user.findUnique({ where: { email: acc.email } });

    if (existing) {
      // 이미 있으면 비밀번호 + 역할만 갱신
      await prisma.user.update({
        where: { email: acc.email },
        data: { password: hashedPw, role: acc.role },
      });
      console.log(`  ♻️  갱신: ${acc.email}  (${acc.role})`);
      updated++;
    } else {
      await prisma.user.create({
        data: {
          email:          acc.email,
          name:           acc.name,
          password:       hashedPw,
          department:     acc.department,
          team:           acc.team,
          role:           acc.role,
          level:          acc.level ?? Level.L3,
          employmentType: EmploymentType.REGULAR,
          hireDate:       new Date("2020-01-01"),
          yearsOfService: 6,
          isActive:       true,
        },
      });
      console.log(`  ✅ 생성: ${acc.email}  (${acc.role})`);
      created++;
    }
  }

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`생성: ${created}개 / 갱신: ${updated}개`);
  console.log(`─────────────────────────────────────────────`);
  console.log(`\n공통 비밀번호: ${PLAIN_PASSWORD}`);
  console.log(`\n계정 목록:`);
  for (const acc of TEST_ACCOUNTS) {
    console.log(`  ${acc.email.padEnd(32)} ${acc.role.padEnd(14)} — ${acc.description}`);
  }
  console.log(`\n✅ 완료! Playwright 테스트를 실행하세요.`);
  console.log(`   cd qa-test && npm run test:login`);
}

main()
  .catch((e) => {
    console.error("❌ 실패:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
