import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";

// PUT /api/accounts/[id] — 본부장 계정 수정 (SYSTEM_ADMIN 전용)
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target || target.role !== Role.DEPT_HEAD) {
    return NextResponse.json({ error: "해당 계정을 찾을 수 없습니다." }, { status: 404 });
  }

  let body: {
    name?: string;
    emailPrefix?: string;
    department?: string;
    residentIdLast7?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  if (body.residentIdLast7 && !/^\d{7}$/.test(body.residentIdLast7)) {
    return NextResponse.json(
      { error: "주민번호 뒷 7자리는 정확히 7자리 숫자여야 합니다." },
      { status: 400 }
    );
  }

  const updateData: {
    name?: string;
    email?: string;
    department?: string;
    password?: string;
  } = {};

  if (body.name) updateData.name = body.name;
  if (body.department) updateData.department = body.department;

  if (body.emailPrefix) {
    const newEmail = `${body.emailPrefix}@rsupport.com`;
    if (newEmail !== target.email) {
      const emailExists = await prisma.user.findUnique({ where: { email: newEmail } });
      if (emailExists) {
        return NextResponse.json({ error: "이미 사용 중인 이메일입니다." }, { status: 409 });
      }
      updateData.email = newEmail;
    }
  }

  if (body.residentIdLast7) {
    // [KISA2021-22] 주민번호는 비밀번호 해시 생성에만 사용하고 DB에 저장하지 않음
    updateData.password = await bcrypt.hash(body.residentIdLast7, 10);
  }

  const account = await prisma.user.update({
    where: { id: params.id },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      department: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ success: true, account });
}

// DELETE /api/accounts/[id] — 본부장 계정 삭제 (SYSTEM_ADMIN 전용)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target || target.role !== Role.DEPT_HEAD) {
    return NextResponse.json({ error: "해당 계정을 찾을 수 없습니다." }, { status: 404 });
  }

  await prisma.user.delete({ where: { id: params.id } });

  return NextResponse.json({ success: true });
}
