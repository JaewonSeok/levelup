/**
 * 제외(excluded) 처리된 대상자 복원 스크립트
 * 실행: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/restore-candidate.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TARGET_NAME = "조현철";
const TARGET_YEAR = new Date().getFullYear(); // 2026

async function main() {
  const user = await prisma.user.findFirst({ where: { name: TARGET_NAME } });
  if (!user) { console.error(`'${TARGET_NAME}' 사용자 없음`); return; }

  const candidate = await prisma.candidate.findUnique({
    where: { userId_year: { userId: user.id, year: TARGET_YEAR } },
  });

  if (!candidate) {
    console.log(`'${TARGET_NAME}' year=${TARGET_YEAR} Candidate 레코드 없음`);
    return;
  }

  if (candidate.source !== "excluded") {
    console.log(`'${TARGET_NAME}'의 source='${candidate.source}' → 이미 정상 상태`);
    return;
  }

  const updated = await prisma.candidate.update({
    where: { id: candidate.id },
    data: { source: "auto" },
  });

  console.log(`✅ '${TARGET_NAME}' Candidate 복원 완료`);
  console.log(`   ${candidate.source} → ${updated.source}`);
  console.log(`   pointMet=${updated.pointMet}  creditMet=${updated.creditMet}  promotionType=${updated.promotionType}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
