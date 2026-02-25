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

  const accounts = await prisma.user.findMany({
    where: { role: Role.DEPT_HEAD },
    select: {
      id: true,
      name: true,
      email: true,
      employeeNumber: true,
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
    employeeNumber: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { name, emailPrefix, department, employeeNumber } = body;
  if (!name || !emailPrefix || !department || !employeeNumber) {
    return NextResponse.json(
      { error: "필수 항목이 없습니다. (이름, 이메일, 본부, 사번)" },
      { status: 400 }
    );
  }

  const email = `${emailPrefix}@rsupport.com`;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { employeeNumber }] },
  });
  if (existing) {
    if (existing.email === email) {
      return NextResponse.json({ error: "이미 사용 중인 이메일입니다." }, { status: 409 });
    }
    return NextResponse.json({ error: "이미 사용 중인 사번입니다." }, { status: 409 });
  }

  const hashedPassword = await bcrypt.hash(employeeNumber, 10);

  const account = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      employeeNumber,
      department,
      team: "",
      role: Role.DEPT_HEAD,
    },
    select: {
      id: true,
      name: true,
      email: true,
      employeeNumber: true,
      department: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ success: true, account }, { status: 201 });
}
