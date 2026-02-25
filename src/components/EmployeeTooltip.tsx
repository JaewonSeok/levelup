"use client";

import { useState } from "react";

const EMPLOYMENT_LABEL: Record<string, string> = {
  REGULAR: "정규직",
  CONTRACT: "계약직",
};

interface EmployeeTooltipProps {
  children: React.ReactNode;
  name: string;
  department?: string | null;
  team?: string | null;
  level?: string | null;
  competencyLevel?: string | null;
  hireDate?: string | null;
  yearsOfService?: number | null;
  employmentType?: string | null;
  pointCumulative?: number | null;
  creditCumulative?: number | null;
}

export function EmployeeTooltip({
  children,
  name,
  department,
  team,
  level,
  competencyLevel,
  hireDate,
  yearsOfService,
  employmentType,
  pointCumulative,
  creditCumulative,
}: EmployeeTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const handleMouseEnter = (e: React.MouseEvent<HTMLSpanElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setStyle({
      position: "fixed",
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
      transform: "translate(-50%, -100%)",
      zIndex: 9999,
    });
    setVisible(true);
  };

  const fmtDate = (iso: string | null | undefined) =>
    iso ? iso.slice(0, 10) : "-";

  return (
    <span
      className="relative cursor-default"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setVisible(false)}
    >
      <span className="underline decoration-dotted decoration-gray-400 underline-offset-2">
        {children}
      </span>
      {visible && (
        <div
          style={style}
          className="w-52 bg-white border border-gray-200 shadow-xl rounded-lg p-3 text-xs pointer-events-none"
        >
          <p className="font-semibold text-sm text-gray-800 mb-2 border-b pb-1.5">
            {name}
          </p>
          <div className="space-y-1 text-gray-600">
            {(department || team) && (
              <Row label="소속" value={[department, team].filter(Boolean).join(" · ")} />
            )}
            {(competencyLevel || level) && (
              <Row label="역량레벨" value={competencyLevel ?? level ?? "-"} />
            )}
            {hireDate && (
              <Row label="입사일" value={fmtDate(hireDate)} />
            )}
            {yearsOfService != null && (
              <Row label="연차" value={`${yearsOfService}년`} />
            )}
            {employmentType && (
              <Row label="고용형태" value={EMPLOYMENT_LABEL[employmentType] ?? employmentType} />
            )}
            {pointCumulative != null && (
              <Row label="포인트" value={pointCumulative.toFixed(1)} />
            )}
            {creditCumulative != null && (
              <Row label="학점" value={creditCumulative.toFixed(1)} />
            )}
          </div>
        </div>
      )}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <span className="text-gray-400 w-14 flex-shrink-0">{label}</span>
      <span className="text-gray-700">{value}</span>
    </div>
  );
}
