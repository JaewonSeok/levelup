"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

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
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || session.user.role !== "DEPT_HEAD") {
      router.replace("/");
      return;
    }
    fetch("/api/dept-confirmation")
      .then((r) => r.json())
      .then((data) => setEmployees(data.employees ?? []))
      .finally(() => setLoading(false));
  }, [session, status, router]);

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        불러오는 중...
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">2026 레벨업 확정</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {session?.user.department} · 확정 완료된 레벨업 대상자 목록입니다.
        </p>
      </div>

      {employees.length === 0 ? (
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
                    "No.",
                    "본부",
                    "팀",
                    "이름",
                    "기존 레벨",
                    "확정 레벨",
                    "연차",
                    "입사일",
                    "포인트",
                    "학점",
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
                    <td className="px-4 py-3 text-gray-700">
                      {emp.pointCumulative.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {emp.creditCumulative.toFixed(1)}
                    </td>
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
