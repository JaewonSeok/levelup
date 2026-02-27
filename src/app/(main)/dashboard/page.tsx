"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ── 타입 ─────────────────────────────────────────────────────
interface LevelRow {
  level: string;
  total: number;
  confirmed: number;
  deferred: number;
  pending: number;
  normal: number;
  special: number;
}

interface DeptRow {
  department: string;
  total: number;
  confirmed: number;
  deferred: number;
  pending: number;
}

interface DashboardData {
  year: number;
  availableYears: number[];
  summary: {
    totalCandidates: number;
    confirmed: number;
    deferred: number;
    pending: number;
  };
  byLevel: LevelRow[];
  byDepartment: DeptRow[];
  promotionType: { normal: number; special: number };
  metSummary: {
    bothMet: number;
    pointOnly: number;
    creditOnly: number;
    neitherMet: number;
    total: number;
  };
}

// ── 헬퍼 ──────────────────────────────────────────────────────
function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

// ── 요약 카드 ─────────────────────────────────────────────────
function SummaryCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="border rounded-lg p-5 bg-white flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-3xl font-bold ${color}`}>{value.toLocaleString()}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ── 가로 바 ───────────────────────────────────────────────────
function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

// ── 레벨 표시 ────────────────────────────────────────────────
function LevelBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    L1: "bg-slate-100 text-slate-700",
    L2: "bg-blue-100 text-blue-700",
    L3: "bg-green-100 text-green-700",
    L4: "bg-amber-100 text-amber-700",
    L5: "bg-purple-100 text-purple-700",
  };
  const cls = colors[level] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${cls}`}>{level}</span>
  );
}

// ── 메인 ─────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const CURRENT_YEAR = new Date().getFullYear();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 권한 체크 ─────────────────────────────────────────────
  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.replace("/login"); return; }
    const role = session.user.role;
    if (role !== "CEO" && role !== "HR_TEAM" && role !== "SYSTEM_ADMIN") {
      router.replace("/");
    }
  }, [session, status, router]);

  // ── 데이터 페치 ───────────────────────────────────────────
  const fetchData = useCallback(async (y: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard?year=${y}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "조회 실패");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") fetchData(year);
  }, [status, fetchData, year]);

  // ── 로딩 / 권한 ───────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        로딩 중...
      </div>
    );
  }

  const { summary, byLevel, byDepartment, promotionType, metSummary, availableYears } =
    data ?? {
      summary: { totalCandidates: 0, confirmed: 0, deferred: 0, pending: 0 },
      byLevel: [],
      byDepartment: [],
      promotionType: { normal: 0, special: 0 },
      metSummary: { bothMet: 0, pointOnly: 0, creditOnly: 0, neitherMet: 0, total: 0 },
      availableYears: [CURRENT_YEAR],
    };

  const maxDept = Math.max(...byDepartment.map((d) => d.total), 1);

  return (
    <div className="space-y-6">
      {/* ── 헤더 ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">통계 대시보드</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">연도</span>
          <Select
            value={String(year)}
            onValueChange={(v) => setYear(Number(v))}
          >
            <SelectTrigger className="h-8 w-28 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}년
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="text-red-600 text-sm p-3 bg-red-50 rounded border border-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">데이터 로딩 중...</div>
      ) : (
        <>
          {/* ── 요약 카드 ──────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="심사대상 전체"
              value={summary.totalCandidates}
              sub={`${year}년 레벨업 심사 인원`}
              color="text-foreground"
            />
            <SummaryCard
              label="확정"
              value={summary.confirmed}
              sub={summary.totalCandidates ? `전체의 ${pct(summary.confirmed, summary.totalCandidates)}%` : "-"}
              color="text-green-600"
            />
            <SummaryCard
              label="보류"
              value={summary.deferred}
              sub={summary.totalCandidates ? `전체의 ${pct(summary.deferred, summary.totalCandidates)}%` : "-"}
              color="text-orange-500"
            />
            <SummaryCard
              label="미확정"
              value={summary.pending}
              sub="확정·보류 처리 전"
              color="text-muted-foreground"
            />
          </div>

          {/* ── 승진 유형 + 포인트/학점 충족 ───────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 승진 유형 */}
            <div className="border rounded-lg p-5 bg-white">
              <h2 className="text-sm font-semibold mb-4">승진 유형</h2>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">일반 승진</span>
                    <span className="font-semibold">{promotionType.normal}명</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5">
                    <div
                      className="h-2.5 rounded-full bg-blue-500"
                      style={{
                        width: `${pct(promotionType.normal, promotionType.normal + promotionType.special)}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">특진</span>
                    <span className="font-semibold">{promotionType.special}명</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5">
                    <div
                      className="h-2.5 rounded-full bg-amber-400"
                      style={{
                        width: `${pct(promotionType.special, promotionType.normal + promotionType.special)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 포인트/학점 충족 현황 */}
            <div className="border rounded-lg p-5 bg-white">
              <h2 className="text-sm font-semibold mb-4">
                포인트/학점 충족 현황
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  (전체 대상자 {metSummary.total}명 기준)
                </span>
              </h2>
              <div className="space-y-2.5">
                {[
                  { label: "포인트 + 학점 모두 충족", value: metSummary.bothMet, color: "bg-green-500" },
                  { label: "포인트만 충족", value: metSummary.pointOnly, color: "bg-blue-400" },
                  { label: "학점만 충족", value: metSummary.creditOnly, color: "bg-sky-400" },
                  { label: "미충족", value: metSummary.neitherMet, color: "bg-gray-300" },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-semibold">{value}명</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${color}`}
                        style={{ width: `${pct(value, metSummary.total)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── 레벨별 현황 ────────────────────────────────── */}
          {byLevel.length > 0 && (
            <div className="border rounded-lg bg-white overflow-hidden">
              <div className="px-5 py-3 border-b bg-muted/30">
                <h2 className="text-sm font-semibold">레벨별 현황</h2>
                <p className="text-xs text-muted-foreground mt-0.5">현재 레벨 기준 (예: L2 = L2→L3 승진 대상)</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableHead className="text-xs w-20">레벨</TableHead>
                    <TableHead className="text-center text-xs">심사대상</TableHead>
                    <TableHead className="text-center text-xs text-green-700">확정</TableHead>
                    <TableHead className="text-center text-xs text-orange-600">보류</TableHead>
                    <TableHead className="text-center text-xs text-muted-foreground">미확정</TableHead>
                    <TableHead className="text-center text-xs">일반</TableHead>
                    <TableHead className="text-center text-xs">특진</TableHead>
                    <TableHead className="text-xs w-32">확정률</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byLevel.map((row) => (
                    <TableRow key={row.level}>
                      <TableCell>
                        <LevelBadge level={row.level} />
                      </TableCell>
                      <TableCell className="text-center font-semibold text-sm">
                        {row.total}
                      </TableCell>
                      <TableCell className="text-center text-sm text-green-700 font-medium">
                        {row.confirmed}
                      </TableCell>
                      <TableCell className="text-center text-sm text-orange-600 font-medium">
                        {row.deferred}
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {row.pending}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {row.normal}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {row.special > 0 ? (
                          <span className="text-amber-600 font-medium">{row.special}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <Bar value={row.confirmed} max={row.total} color="bg-green-400" />
                          </div>
                          <span className="text-xs text-muted-foreground w-8 text-right">
                            {pct(row.confirmed, row.total)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* ── 본부별 현황 ────────────────────────────────── */}
          {byDepartment.length > 0 && (
            <div className="border rounded-lg bg-white overflow-hidden">
              <div className="px-5 py-3 border-b bg-muted/30">
                <h2 className="text-sm font-semibold">본부별 현황</h2>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableHead className="text-xs">본부</TableHead>
                    <TableHead className="text-center text-xs">심사대상</TableHead>
                    <TableHead className="text-center text-xs text-green-700">확정</TableHead>
                    <TableHead className="text-center text-xs text-orange-600">보류</TableHead>
                    <TableHead className="text-center text-xs text-muted-foreground">미확정</TableHead>
                    <TableHead className="text-xs w-44">인원 분포</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byDepartment.map((row) => (
                    <TableRow key={row.department}>
                      <TableCell className="text-sm font-medium">{row.department}</TableCell>
                      <TableCell className="text-center font-semibold text-sm">
                        {row.total}
                      </TableCell>
                      <TableCell className="text-center text-sm text-green-700 font-medium">
                        {row.confirmed}
                      </TableCell>
                      <TableCell className="text-center text-sm text-orange-600 font-medium">
                        {row.deferred}
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {row.pending}
                      </TableCell>
                      <TableCell>
                        {/* 누적 바: 확정(초록) + 보류(주황) + 미확정(회색) */}
                        <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 w-full">
                          {row.confirmed > 0 && (
                            <div
                              className="bg-green-400 h-full"
                              style={{ width: `${pct(row.confirmed, maxDept)}%` }}
                              title={`확정 ${row.confirmed}명`}
                            />
                          )}
                          {row.deferred > 0 && (
                            <div
                              className="bg-orange-300 h-full"
                              style={{ width: `${pct(row.deferred, maxDept)}%` }}
                              title={`보류 ${row.deferred}명`}
                            />
                          )}
                          {row.pending > 0 && (
                            <div
                              className="bg-gray-300 h-full"
                              style={{ width: `${pct(row.pending, maxDept)}%` }}
                              title={`미확정 ${row.pending}명`}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* 데이터 없음 */}
          {summary.totalCandidates === 0 && !loading && (
            <div className="text-center py-20 text-muted-foreground text-sm border rounded-lg bg-white">
              {year}년 심사대상 데이터가 없습니다.
            </div>
          )}

          {/* 범례 */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-green-400 inline-block" />
              확정
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-orange-300 inline-block" />
              보류
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-gray-300 inline-block" />
              미확정
            </span>
          </div>
        </>
      )}
    </div>
  );
}
