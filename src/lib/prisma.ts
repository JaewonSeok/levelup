import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Vercel 서버리스에서 warm 인스턴스의 DB 연결을 재사용하기 위해 globalThis에 항상 캐싱.
// (dev 환경에서는 HMR 시 중복 인스턴스 방지 역할도 겸함)
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

globalForPrisma.prisma = prisma;

export default prisma;
