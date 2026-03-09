import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const names = ["조성훈", "서원영", "박다빈", "하승준", "신진수"];
  for (const name of names) {
    const user = await prisma.user.findFirst({ where: { name } });
    if (!user) { console.log(`${name}: USER NOT FOUND`); continue; }
    const cand = await prisma.candidate.findUnique({ where: { userId_year: { userId: user.id, year: 2026 } } });
    if (!cand) { console.log(`${name}: CANDIDATE NOT FOUND (userId=${user.id})`); continue; }
    console.log(`${name} | level=${user.level} | source=${cand.source} | pointMet=${cand.pointMet} | creditMet=${cand.creditMet} | isReviewTarget=${cand.isReviewTarget} | promotionType=${cand.promotionType}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
