import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";

// GET /api/accounts — DEPT_HEAD 목록 조회 (SYSTEM_ADMIN 전용)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  // [KISA2021-22] residentIdLast7(개인식별정보) 응답에서 제외
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

// POST /api/accounts — 본부장 계정 생성 (SYSTEM_ADMIN 전용)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  let body: {
    name: string;
    emailPrefix: string;
    department: string;
    residentIdLast7: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { name, emailPrefix, department, residentIdLast7 } = body;
  if (!name || !emailPrefix || !department || !residentIdLast7) {
    return NextResponse.json(
      { error: "필수 항목이 없습니다. (이름, 이메일, 본부, 주민번호 뒷 7자리)" },
      { status: 400 }
    );
  }

  if (!/^\d{7}$/.test(residentIdLast7)) {
    return NextResponse.json(
      { error: "주민번호 뒷 7자리는 정확히 7자리 숫자여야 합니다." },
      { status: 400 }
    );
  }

  const email = `${emailPrefix}@rsupport.com`;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "이미 사용 중인 이메일입니다." }, { status: 409 });
  }

  // [KISA2021-22] 주민번호는 비밀번호 해시 생성에만 사용하고 DB에 저장하지 않음
  const hashedPassword = await bcrypt.hash(residentIdLast7, 10);

  const account = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
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
