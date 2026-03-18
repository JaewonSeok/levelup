import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

// GET /api/accounts — DEPT_HEAD 목록 조회 (SYSTEM_ADMIN 전용)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const accounts = await prisma.user.findMany({
    where: { role: Role.DEPT_HEAD },
    select: {
      id: true,
      name: true,
      email: true,
      department: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ accounts });
}

// POST /api/accounts — 본부장 계정 생성 (SYSTEM_ADMIN 전용, Google 로그인 전용)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  let body: { name: string; emailPrefix: string; department: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { name, emailPrefix, department } = body;
  if (!name || !emailPrefix || !department) {
    return NextResponse.json(
      { error: "필수 항목이 없습니다. (이름, 이메일, 본부)" },
      { status: 400 }
    );
  }

  const email = `${emailPrefix}@rsupport.com`;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "이미 사용 중인 이메일입니다." }, { status: 409 });
  }

  const account = await prisma.user.create({
    data: {
      name,
      email,
      password: null,
      department,
      team: "",
      role: Role.DEPT_HEAD,
    },
    select: {
      id: true,
      name: true,
      email: true,
      department: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ success: true, account }, { status: 201 });
}
