import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const pw = await bcrypt.hash("admin1234", 10);

  await prisma.user.upsert({
    where: { email: "admin@rsupport.com" },
    update: {},
    create: {
      name: "시스템 관리자",
      email: "admin@rsupport.com",
      password: pw,
      role: "SYSTEM_ADMIN",
      department: "시스템",
      team: "관리",
    },
  });

  console.log("✅ 시드 완료: admin@rsupport.com / admin1234");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
