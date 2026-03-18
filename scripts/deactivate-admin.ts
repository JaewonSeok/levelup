import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.update({
    where: { email: "admin@rsupport.com" },
    data: { isActive: false },
    select: { email: true, isActive: true },
  });
  console.log("deactivated:", user.email, "isActive:", user.isActive);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
