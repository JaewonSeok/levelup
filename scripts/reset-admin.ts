/**
 * admin@rsupport.com 비밀번호 복구 스크립트
 * 실행: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/reset-admin.ts
 */
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPw = await bcrypt.hash("admin1234", 10);

  const user = await prisma.user.upsert({
    where: { email: "admin@rsupport.com" },
    update: {
      password: adminPw,
      role: Role.SYSTEM_ADMIN,
      name: "관리자",
      department: "인사팀",
    },
    create: {
      name: "관리자",
      email: "admin@rsupport.com",
      password: adminPw,
      department: "인사팀",
      team: "",
      role: Role.SYSTEM_ADMIN,
    },
  });

  console.log("✅ Admin 계정 복구 완료");
  console.log("   Email :", user.email);
  console.log("   Role  :", user.role);
  console.log("   Password: admin1234");
}

main()
  .catch((e) => {
    console.error("❌ 실패:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
