"use client";

import { useEffect, useState } from "react";
import { useImpersonate } from "@/context/ImpersonateContext";
import { Eye, X } from "lucide-react";

interface DeptHead {
  id: string;
  name: string;
  department: string;
}

interface Props {
  userRole: string;
}

export function ImpersonateBanner({ userRole }: Props) {
  const { impersonateDept, setImpersonateDept } = useImpersonate();
  const [deptHeads, setDeptHeads] = useState<DeptHead[]>([]);

  const canImpersonate = userRole === "SYSTEM_ADMIN" || userRole === "HR_TEAM";

  useEffect(() => {
    if (!canImpersonate) return;
    fetch("/api/dept-heads")
      .then((r) => r.json())
      .then((data) => setDeptHeads(data.deptHeads ?? []))
      .catch(() => {});
  }, [canImpersonate]);

  if (!canImpersonate) return null;

  if (impersonateDept) {
    const current = deptHeads.find((d) => d.department === impersonateDept);
    return (
      <div className="bg-orange-500 text-white px-4 py-2 flex items-center gap-3 text-sm flex-shrink-0">
        <Eye className="h-4 w-4 shrink-0" />
        <span className="font-medium">본부장 화면 보기 중:</span>
        <span>
          {current?.department ?? impersonateDept}
          {current?.name ? ` (${current.name})` : ""}
        </span>
        <button
          onClick={() => setImpersonateDept(null)}
          className="ml-auto flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-2.5 py-1 rounded text-xs font-medium transition-colors"
        >
          <X className="h-3 w-3" />
          원래 계정으로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border-b px-4 py-1.5 flex items-center gap-2 text-sm flex-shrink-0">
      <Eye className="h-3.5 w-3.5 text-gray-400" />
      <span className="text-xs text-gray-500">본부장 화면 보기:</span>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) setImpersonateDept(e.target.value);
        }}
        className="text-xs border rounded px-2 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-orange-400 text-gray-700"
      >
        <option value="">본부 선택</option>
        {deptHeads.map((d) => (
          <option key={d.id} value={d.department}>
            {d.department} ({d.name})
          </option>
        ))}
      </select>
    </div>
  );
}
