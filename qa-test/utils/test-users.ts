export interface TestUser {
  email: string;
  password: string;
  role?: string;
  description?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// scripts/create-test-accounts.ts 로 생성된 QA 전용 계정.
// 비밀번호 변경 시 create-test-accounts.ts 의 PLAIN_PASSWORD 도 같이 수정.
// ────────────────────────────────────────────────────────────────────────────
export const TEST_USERS: TestUser[] = [
  { email: "qa-hr01@rsupport.com",     password: "QAtest1234!", role: "HR_TEAM",      description: "인사팀 01"   },
  { email: "qa-hr02@rsupport.com",     password: "QAtest1234!", role: "HR_TEAM",      description: "인사팀 02"   },
  { email: "qa-dept01@rsupport.com",   password: "QAtest1234!", role: "DEPT_HEAD",    description: "본부장 A"    },
  { email: "qa-dept02@rsupport.com",   password: "QAtest1234!", role: "DEPT_HEAD",    description: "본부장 B"    },
  { email: "qa-dept03@rsupport.com",   password: "QAtest1234!", role: "DEPT_HEAD",    description: "본부장 C"    },
  { email: "qa-section@rsupport.com",  password: "QAtest1234!", role: "SECTION_CHIEF",description: "실장 01"     },
  { email: "qa-leader01@rsupport.com", password: "QAtest1234!", role: "TEAM_LEADER",  description: "팀장 01"     },
  { email: "qa-leader02@rsupport.com", password: "QAtest1234!", role: "TEAM_LEADER",  description: "팀장 02"     },
  { email: "qa-member@rsupport.com",   password: "QAtest1234!", role: "TEAM_MEMBER",  description: "팀원 01"     },
  { email: "qa-ceo@rsupport.com",      password: "QAtest1234!", role: "CEO",          description: "대표이사"    },
];

export const BASE_URL = "https://levelup-2026.vercel.app";
