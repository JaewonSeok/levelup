"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Role } from "@prisma/client";
import {
  Users,
  Star,
  GraduationCap,
  ClipboardList,
  FileSearch,
  CheckCircle,
  Settings,
  Upload,
  BarChart3,
  LogOut,
  UserCog,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  allowedRoles: Role[];
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      {
        href: "/level-management",
        label: "레벨 관리/조회",
        icon: Users,
        allowedRoles: [
          Role.TEAM_MEMBER,
          Role.TEAM_LEADER,
          Role.SECTION_CHIEF,
          Role.DEPT_HEAD,
          Role.HR_TEAM,
          Role.CEO,
          Role.SYSTEM_ADMIN,
        ],
      },
    ],
  },
  {
    label: "데이터 관리",
    items: [
      {
        href: "/points",
        label: "포인트 관리",
        icon: Star,
        allowedRoles: [Role.HR_TEAM, Role.SYSTEM_ADMIN],
      },
      {
        href: "/credits",
        label: "학점 관리",
        icon: GraduationCap,
        allowedRoles: [Role.HR_TEAM, Role.SYSTEM_ADMIN],
      },
    ],
  },
  {
    label: "레벨업 관리",
    items: [
      {
        href: "/candidates",
        label: "대상자 관리",
        icon: ClipboardList,
        allowedRoles: [Role.HR_TEAM, Role.SYSTEM_ADMIN],
      },
      {
        href: "/review",
        label: "레벨업 심사",
        icon: FileSearch,
        allowedRoles: [
          Role.DEPT_HEAD,
          Role.CEO,
          Role.SYSTEM_ADMIN,
        ],
      },
      {
        href: "/confirmation",
        label: "레벨업 확정",
        icon: CheckCircle,
        allowedRoles: [Role.CEO, Role.SYSTEM_ADMIN],
      },
    ],
  },
  {
    label: "시스템",
    items: [
      {
        href: "/upload",
        label: "엑셀 업로드",
        icon: Upload,
        allowedRoles: [Role.SYSTEM_ADMIN],
      },
      {
        href: "/dashboard",
        label: "통계 대시보드",
        icon: BarChart3,
        allowedRoles: [Role.CEO, Role.HR_TEAM, Role.SYSTEM_ADMIN],
      },
      {
        href: "/settings",
        label: "기준 설정",
        icon: Settings,
        allowedRoles: [Role.SYSTEM_ADMIN],
      },
      {
        href: "/settings/accounts",
        label: "계정 관리",
        icon: UserCog,
        allowedRoles: [Role.SYSTEM_ADMIN],
      },
    ],
  },
];

interface SidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    role: Role;
    department?: string | null;
    team?: string | null;
  };
}

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-white border-r flex flex-col">
      <div className="p-4 border-b">
        <h1 className="text-sm font-bold text-gray-900">레벨업 관리 시스템</h1>
        <p className="text-xs text-muted-foreground mt-1 truncate">{user.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {user.department} · {user.team}
        </p>
      </div>

      <nav className="flex-1 p-2 overflow-y-auto">
        {NAV_SECTIONS.map((section, sIdx) => {
          const visibleItems = section.items.filter((item) =>
            item.allowedRoles.includes(user.role)
          );
          if (visibleItems.length === 0) return null;

          return (
            <div key={sIdx} className={sIdx > 0 ? "mt-3" : ""}>
              {section.label && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  // 더 구체적인 경로가 있으면 부모 경로는 비활성
                  const allHrefs = NAV_SECTIONS.flatMap((s) => s.items).map((i) => i.href);
                  const hasMoreSpecific = allHrefs.some(
                    (h) => h !== item.href && h.startsWith(item.href + "/") && pathname.startsWith(h)
                  );
                  const isActive = !hasMoreSpecific && (pathname === item.href || pathname.startsWith(item.href + "/"));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-2 border-t">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          로그아웃
        </button>
      </div>
    </aside>
  );
}
