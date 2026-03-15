import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres.jicjvcyjvbvkxezvaqcz:sgt19450922!%40@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?schema=public&sslmode=require",
    },
  },
});

async function main() {
  // 1. admin 계정 확인
  const admin = await prisma.user.findUnique({
    where: { email: "admin@rsupport.com" },
    select: { id: true, email: true, name: true, role: true, password: true },
  });

  if (!admin) {
    console.log("❌ admin@rsupport.com 계정이 존재하지 않습니다. upsert로 생성합니다...");
  } else {
    const pwPreview = admin.password ? admin.password.slice(0, 10) + "..." : "null";
    const isBcrypt = admin.password?.startsWith("$2");
    console.log(`\n현재 admin 계정 상태:`);
    console.log(`  email   : ${admin.email}`);
    console.log(`  name    : ${admin.name}`);
    console.log(`  role    : ${admin.role}`);
    console.log(`  password: ${pwPreview} (${isBcrypt ? "✅ bcrypt" : "❌ bcrypt 아님 — 재설정 필요"})`);
  }

  // 2. 비밀번호 재설정
  const hash = await bcrypt.hash("hradmin1450", 10);
  console.log(`\n  bcrypt 해시 생성 완료: ${hash.slice(0, 20)}...`);

  if (!admin) {
    // 계정이 없으면 upsert로 생성
    await prisma.user.upsert({
      where: { email: "admin@rsupport.com" },
      update: { password: hash },
      create: {
        email:          "admin@rsupport.com",
        name:           "시스템관리자",
        password:       hash,
        role:           "SYSTEM_ADMIN",
        department:     "인사팀",
        team:           "인사팀",
        employmentType: "REGULAR",
        hireDate:       new Date("2020-01-01"),
        yearsOfService: 5,
        isActive:       true,
      },
    });
    console.log("  ✅ admin 계정 생성 완료");
  } else {
    await prisma.user.update({
      where: { email: "admin@rsupport.com" },
      data:  { password: hash },
    });
    console.log("  ✅ admin 비밀번호 재설정 완료");
  }

  // 3. 최종 확인
  const updated = await prisma.user.findUnique({
    where: { email: "admin@rsupport.com" },
    select: { email: true, role: true, password: true },
  });
  const ok = updated?.password?.startsWith("$2");
  console.log(`\n최종 확인: password=${updated?.password?.slice(0, 15)}... (${ok ? "✅ bcrypt OK" : "❌ 실패"})`);
  console.log(`\n─────────────────────────────────────────────`);
  console.log(`로그인 정보: admin@rsupport.com / hradmin1450`);
  console.log(`─────────────────────────────────────────────`);
}

main()
  .catch(e => { console.error("❌ 실패:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
