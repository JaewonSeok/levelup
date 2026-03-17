import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

// GET /api/dept-heads
// 본부장 목록 조회 (SYSTEM_ADMIN / HR_TEAM 전용)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const allowed: Role[] = [Role.SYSTEM_ADMIN, Role.HR_TEAM];
  if (!allowed.includes(session.user.role)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const deptHeads = await prisma.user.findMany({
    where: { role: Role.DEPT_HEAD, isActive: true },
    select: { id: true, name: true, department: true },
    orderBy: { department: "asc" },
  });

  return NextResponse.json({ deptHeads });
}
