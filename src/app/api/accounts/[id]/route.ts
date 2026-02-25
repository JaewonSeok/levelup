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
    employeeNumber?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const updateData: {
    name?: string;
    email?: string;
    department?: string;
    employeeNumber?: string;
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

  if (body.employeeNumber && body.employeeNumber !== target.employeeNumber) {
    const empExists = await prisma.user.findUnique({
      where: { employeeNumber: body.employeeNumber },
    });
    if (empExists) {
      return NextResponse.json({ error: "이미 사용 중인 사번입니다." }, { status: 409 });
    }
    updateData.employeeNumber = body.employeeNumber;
    updateData.password = await bcrypt.hash(body.employeeNumber, 10);
  }

  const account = await prisma.user.update({
    where: { id: params.id },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      employeeNumber: true,
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
