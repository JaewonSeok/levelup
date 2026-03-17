import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: Role;
      department?: string | null;
      team?: string | null;
    };
  }
  interface User {
    role: Role;
    department?: string | null;
    team?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    department?: string | null;
    team?: string | null;
  }
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // [보안] 8시간
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // 사내 내부 시스템: signIn 콜백에서 사전 등록된 이메일만 허용하므로
      // 기존 계정에 Google OAuth 연결을 허용해도 보안 위험 없음
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Google OAuth: DB에 등록된 이메일만 허용
      if (account?.provider === "google") {
        if (!user.email) return false;
        const existing = await prisma.user.findUnique({
          where: { email: user.email },
          select: { id: true },
        });
        if (!existing) return "/login?error=google_not_registered";
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: Role }).role ?? token.role;
        token.department = (user as { department?: string }).department ?? token.department;
        token.team = (user as { team?: string }).team ?? token.team;
      }
      // role/department/team을 항상 DB에서 최신 값으로 동기화.
      // 관리자가 계정 role을 변경해도 재로그인 없이 즉시 반영.
      // account가 있으면 최초 로그인(Google OAuth) 시점이므로 우선적으로 처리.
      const lookupEmail = (account?.provider === "google" ? token.email : null) ?? token.email;
      if (lookupEmail) {
        const dbUser = await prisma.user.findUnique({
          where: { email: lookupEmail as string },
          select: { id: true, role: true, department: true, team: true },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.department = dbUser.department;
          token.team = dbUser.team;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.department = token.department;
      session.user.team = token.team;
      return session;
    },
  },
};
