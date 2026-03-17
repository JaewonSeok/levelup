import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

const HR_ADMINS = [
  { email: "jwseok@rsupport.com", name: "jwseok" },
  { email: "shyun@rsupport.com",  name: "shyun"  },
  { email: "shjeong@rsupport.com", name: "shjeong" },
];

async function main() {
  console.log("Adding HR admin accounts...");

  for (const acc of HR_ADMINS) {
    await prisma.user.upsert({
      where: { email: acc.email },
      update: { role: Role.SYSTEM_ADMIN, isActive: true },
      create: {
        name:       acc.name,
        email:      acc.email,
        password:   null,
        role:       Role.SYSTEM_ADMIN,
        department: "인사팀",
        team:       "",
        isActive:   true,
      },
    });
    console.log(`  ✓ ${acc.email}`);
  }

  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
