/**
 * 2026년 대상자 22명 수동 등록 스크립트
 * 실행: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/register-2026-candidates.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TARGET_YEAR = 2026;

// name: DB 이름, promotionType: "normal"|"special"
// note: 동명이인 구분용 (부서/팀 정보)
const TARGETS: Array<{ name: string; promotionType: "normal" | "special"; note?: string }> = [
  { name: "정우승",  promotionType: "special" },
  { name: "서현덕",  promotionType: "normal"  },
  { name: "조현철",  promotionType: "normal"  },
  { name: "조성훈",  promotionType: "normal"  },
  { name: "서원영",  promotionType: "normal"  },
  { name: "강성원",  promotionType: "normal"  },
  { name: "신진수",  promotionType: "normal"  },
  { name: "이수빈",  promotionType: "normal"  },
  { name: "박다빈",  promotionType: "normal"  },
  { name: "하승준",  promotionType: "normal"  },
  { name: "이석현",  promotionType: "normal"  },
  { name: "최성윤",  promotionType: "normal"  },
  { name: "이건준",  promotionType: "normal"  },
  { name: "민경환",  promotionType: "normal"  },
  { name: "문겸",    promotionType: "normal"  },
  { name: "용현준",  promotionType: "normal"  },
  { name: "이소윤",  promotionType: "normal"  },
  { name: "이한결",  promotionType: "normal"  },
  { name: "김가영",  promotionType: "normal"  },
  { name: "유주형",  promotionType: "normal"  },
  { name: "조영태",  promotionType: "normal"  },
  { name: "최승훈",  promotionType: "special", note: "특진 대상자 최승훈 (동명이인 시 아래 로그 확인)" },
];

async function main() {
  console.log("=".repeat(65));
  console.log(`📋 ${TARGET_YEAR}년 대상자 수동 등록 — 총 ${TARGETS.length}명`);
  console.log("=".repeat(65));

  let registered = 0;
  let updated    = 0;
  let notFound   = 0;

  for (const target of TARGETS) {
    const users = await prisma.user.findMany({
      where: { name: target.name },
      select: { id: true, name: true, level: true, isActive: true, department: true, team: true, hireDate: true },
    });

    if (users.length === 0) {
      console.log(`\n  ❌ '${target.name}' — DB에 없음`);
      notFound++;
      continue;
    }

    // 동명이인이 여러 명인 경우 모두 출력
    if (users.length > 1) {
      console.log(`\n  ⚠️  '${target.name}' — 동명이인 ${users.length}명 발견:`);
      for (const u of users) {
        console.log(`     id=${u.id.slice(-8)} | ${u.level ?? "-"} | ${u.department}/${u.team} | isActive=${u.isActive}`);
      }
      if (target.note) console.log(`     note: ${target.note}`);
    }

    for (const user of users) {
      if (!user.isActive) {
        console.log(`\n  ⚠️  '${user.name}' (${user.level ?? "-"}, ${user.department}) — isActive=false, 스킵`);
        continue;
      }

      const existing = await prisma.candidate.findUnique({
        where: { userId_year: { userId: user.id, year: TARGET_YEAR } },
        select: { id: true, source: true, promotionType: true },
      });

      await prisma.candidate.upsert({
        where: { userId_year: { userId: user.id, year: TARGET_YEAR } },
        create: {
          userId:        user.id,
          year:          TARGET_YEAR,
          pointMet:      true,
          creditMet:     true,
          isReviewTarget: true,
          source:        "manual",
          promotionType: target.promotionType,
        },
        update: {
          source:        "manual",
          isReviewTarget: true,
          promotionType: target.promotionType,
        },
      });

      const badge = target.promotionType === "special" ? "⚡특진" : "일반";
      if (existing) {
        console.log(`\n  🔄 '${user.name}' [${badge}] (${user.level ?? "-"}, ${user.department}/${user.team})`);
        console.log(`     기존 source=${existing.source} promotionType=${existing.promotionType} → 갱신`);
        updated++;
      } else {
        console.log(`\n  ✅ '${user.name}' [${badge}] (${user.level ?? "-"}, ${user.department}/${user.team})`);
        console.log(`     신규 등록 완료`);
        registered++;
      }
    }
  }

  console.log("\n" + "=".repeat(65));
  console.log(`완료: 신규 ${registered}명 등록 | 기존 ${updated}명 갱신 | 미발견 ${notFound}명`);
  if (notFound > 0) {
    console.log("⚠️  미발견 직원은 엑셀 업로드 후 재실행하거나 수동으로 추가하세요.");
  }
  console.log("대상자 관리 페이지를 새로고침하면 결과를 확인할 수 있습니다.");
  console.log("=".repeat(65));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ 실패:", e.message);
  prisma.$disconnect();
  process.exit(1);
});
