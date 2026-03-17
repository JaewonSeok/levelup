"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useImpersonate } from "@/context/ImpersonateContext";

interface Employee {
  no: number;
  name: string;
  department: string | null;
  team: string | null;
  level: string | null;
  competencyLevel: string | null;
  yearsOfService: number | null;
  hireDate: string | null;
  pointCumulative: number;
  creditCumulative: number;
}

export default function DeptConfirmationPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { impersonateDept } = useImpersonate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [visible, setVisible] = useState<boolean | null>(null); // null = 로딩 중
  const [loading, setLoading] = useState(true);

  const isAdminOrHR =
    session?.user.role === "SYSTEM_ADMIN" || session?.user.role === "HR_TEAM";
  const canAccess =
    session?.user.role === "DEPT_HEAD" || (isAdminOrHR && !!impersonateDept);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || !canAccess) {
      router.replace("/");
      return;
    }
    const url = impersonateDept
      ? `/api/dept-confirmation?impersonate=${encodeURIComponent(impersonateDept)}`
      : "/api/dept-confirmation";
    setLoading(true);
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setVisible(data.visible !== false);
        setEmployees(data.employees ?? []);
      })
      .finally(() => setLoading(false));
  }, [session, status, router, impersonateDept, canAccess]);

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        불러오는 중...
      </div>
    );
  }

  const displayDept = impersonateDept ?? session?.user.department;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">2026 레벨업 확정</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {displayDept} · 확정 완료된 레벨업 대상자 목록입니다.
        </p>
      </div>

      {/* 비공개 상태 */}
      {visible === false ? (
        <div className="flex flex-col items-center justify-center h-48 bg-white rounded-lg border gap-3">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <p className="text-muted-foreground text-sm">아직 확정 결과가 공개되지 않았습니다. 공개 후 확인 가능합니다.</p>
        </div>
      ) : employees.length === 0 ? (
        <div className="flex items-center justify-center h-48 bg-white rounded-lg border text-muted-foreground">
          확정된 레벨업 대상자가 없습니다.
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {[
                    "No.", "본부", "팀", "이름",
                    "기존 레벨", "확정 레벨", "연차", "입사일", "포인트", "학점",
                  ].map((col) => (
                    <th
                      key={col}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-600 whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {employees.map((emp) => (
                  <tr key={emp.no} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500">{emp.no}</td>
                    <td className="px-4 py-3 text-gray-700">{emp.department ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-700">{emp.team ?? "-"}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{emp.name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                        {emp.level ?? "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                        {emp.competencyLevel ?? "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {emp.yearsOfService != null ? `${emp.yearsOfService}년` : "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {emp.hireDate
                        ? new Date(emp.hireDate).toLocaleDateString("ko-KR", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                          })
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{emp.pointCumulative.toFixed(1)}</td>
                    <td className="px-4 py-3 text-gray-700">{emp.creditCumulative.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-500">
            총 {employees.length}명
          </div>
        </div>
      )}
    </div>
  );
}
