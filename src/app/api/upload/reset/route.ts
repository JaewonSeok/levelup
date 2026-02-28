import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

// SYSTEM_ADMIN 전용 — 엑셀 업로드된 직원 데이터 전체 초기화
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json({ error: "시스템 관리자만 초기화할 수 있습니다." }, { status: 403 });
  }

  // 삭제 대상: 엑셀 업로드로 생성된 일반 직원 계정 (DEPT_HEAD/HR_TEAM/CEO/SYSTEM_ADMIN 제외)
  const SYSTEM_ROLES: Role[] = [Role.DEPT_HEAD, Role.HR_TEAM, Role.CEO, Role.SYSTEM_ADMIN];

  // onDelete: Cascade로 인해 User 삭제 시 Point/Credit/PerformanceGrade/BonusPenalty/Candidate 자동 삭제
  // Candidate 삭제 시 Review/Opinion/Confirmation 자동 삭제
  await prisma.user.deleteMany({
    where: { role: { notIn: SYSTEM_ROLES } },
  });

  // Submission/UploadHistory는 User FK 없으므로 별도 삭제
  await prisma.submission.deleteMany();
  await prisma.uploadHistory.deleteMany();

  return NextResponse.json({ success: true });
}
