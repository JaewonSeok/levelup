"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { CheckCircle2, AlertTriangle, Send, Undo2 } from "lucide-react";
import { OpinionModal } from "@/components/review/OpinionModal";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────

interface GradeMap {
  2021: string | null;
  2022: string | null;
  2023: string | null;
  2024: string | null;
  2025: string | null;
}

interface ReviewCandidate {
  candidateId: string;
  userId: string;
  reviewId: string | null;
  name: string;
  department: string;
  team: string;
  level: string | null;
  hireDate: string | null;
  yearsOfService: number | null;
  competencyLevel: string | null;
  pointCumulative: number;
  creditCumulative: number;
  currentUserOpinionSavedAt: string | null;
  recommendationStatus: "추천" | "제외" | null;
  grades: GradeMap;
}

interface CurrentUser {
  id: string;
  role: string;
  department: string;
}

type TargetType = "all" | "own" | "other";

interface Query {
  year: number;
  department: string;
  team: string;
  targetType: TargetType;
}

// ── Constants ──────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const GRADE_YEARS = [2021, 2022, 2023, 2024, 2025] as const;

// No. 본부 팀 이름 레벨 연차 입사일 포인트 학점 의견 추천여부 + 5 grade cols
const COL_BASE = 11;
const COL_COUNT = COL_BASE + GRADE_YEARS.length; // 16

// ── Grade badge ────────────────────────────────────────────────

function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-gray-300 text-xs">-</span>;
  const colors: Record<string, string> = {
    S: "bg-green-100 text-green-700",
    A: "bg-blue-100 text-blue-700",
    B: "bg-amber-100 text-amber-700",
    C: "bg-orange-100 text-orange-700",
    D: "bg-red-100 text-red-700",
  };
  const cls = colors[grade.toUpperCase()] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${cls}`}>
      {grade}
    </span>
  );
}

// ── Component ──────────────────────────────────────────────────

export default function ReviewPage() {
  const [query, setQuery] = useState<Query>({
    year: CURRENT_YEAR,
    department: "",
    team: "",
    targetType: "all",
  });
  const [draft, setDraft] = useState<Query>({
    year: CURRENT_YEAR,
    department: "",
    team: "",
    targetType: "all",
  });

  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState<{ departments: string[]; teams: string[] }>({
    departments: [],
    teams: [],
  });
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // 의견 팝업
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);

  // 제출 상태
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedDepts, setSubmittedDepts] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // ── Fetch ────────────────────────────────────────────────────

  const fetchSubmissionStatus = useCallback(async (year: number) => {
    try {
      const res = await fetch(`/api/reviews/submit?year=${year}`);
      if (!res.ok) return;
      const data = await res.json();
      setIsSubmitted(data.isSubmitted ?? false);
      setSubmittedDepts(
        new Set((data.submittedDepartments ?? []).map((s: { department: string }) => s.department))
      );
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function doFetch() {
      setLoading(true);
      try {
        const sp = new URLSearchParams({
          year: String(query.year),
          department: query.department,
          team: query.team,
          targetType: query.targetType,
        });
        const res = await fetch(`/api/reviews?${sp}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        setCandidates(data.candidates ?? []);
        setTotal(data.total ?? 0);
        setMeta(data.meta ?? { departments: [], teams: [] });
        setCurrentUser(data.currentUser ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    doFetch();
    fetchSubmissionStatus(query.year);
    return () => { cancelled = true; };
  }, [query, refreshKey, fetchSubmissionStatus]);

  // ── Handlers ─────────────────────────────────────────────────

  const handleSearch = () => setQuery({ ...draft });

  const isDeptHead = currentUser?.role === "DEPT_HEAD";
  const isAdmin = currentUser?.role === "SYSTEM_ADMIN";

  // 의견 저장 성공 콜백 — 서버가 확정한 값 + Review 업데이트 여부 수신
  const handleOpinionSaved = (
    _reviewerRole: string,
    recommendation: boolean | null,
    reviewUpdated: boolean
  ) => {
    // ① Review.recommendation이 실제로 업데이트된 경우에만 즉시 화면 갱신 (optimistic update)
    if (reviewUpdated && selectedReviewId !== null) {
      const newStatus: "추천" | "제외" | null =
        recommendation === true ? "추천" :
        recommendation === false ? "제외" :
        null;
      const targetId = selectedReviewId;
      setCandidates((prev) =>
        prev.map((c) =>
          c.reviewId === targetId
            ? { ...c, recommendationStatus: newStatus }
            : c
        )
      );
    }
    // ② 백그라운드 refetch — 전체 데이터 정확성 보장
    setRefreshKey((k) => k + 1);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: query.year }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "제출 실패");
      }
      setIsSubmitted(true);
      toast.success("최종 제출이 완료되었습니다.");
      setConfirmSubmitOpen(false);
      fetchSubmissionStatus(query.year);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "제출 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: query.year }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "취소 실패");
      }
      setIsSubmitted(false);
      toast.success("제출이 취소되었습니다.");
      setConfirmCancelOpen(false);
      fetchSubmissionStatus(query.year);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "취소 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "-");

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">레벨업 심사</h1>

      {/* ── 제출 완료 배너 (본부장) ──────────────────────────── */}
      {isDeptHead && isSubmitted && (
        <div className="flex items-center justify-between bg-green-50 border border-green-300 rounded-md px-4 py-2.5 mb-4">
          <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" />
            최종 제출 완료 — 더 이상 수정할 수 없습니다.
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-green-400 text-green-700 hover:bg-green-100"
            onClick={() => setConfirmCancelOpen(true)}
          >
            <Undo2 className="w-3.5 h-3.5 mr-1" />
            제출 취소
          </Button>
        </div>
      )}

      {/* ── 필터 영역 ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 mb-4 border rounded-md p-4 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium whitespace-nowrap">년도</span>
          <Select
            value={String(draft.year)}
            onValueChange={(v) => setDraft((prev) => ({ ...prev, year: Number(v) }))}
          >
            <SelectTrigger className="w-28 h-8 text-sm bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}년</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium whitespace-nowrap">본부</span>
          <Select
            value={draft.department || "__all__"}
            onValueChange={(v) =>
              setDraft((prev) => ({ ...prev, department: v === "__all__" ? "" : v, team: "" }))
            }
          >
            <SelectTrigger className="w-36 h-8 text-sm bg-white">
              <SelectValue placeholder="전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">전체</SelectItem>
              {meta.departments.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium whitespace-nowrap">팀</span>
          <Select
            value={draft.team || "__all__"}
            onValueChange={(v) => setDraft((prev) => ({ ...prev, team: v === "__all__" ? "" : v }))}
          >
            <SelectTrigger className="w-32 h-8 text-sm bg-white">
              <SelectValue placeholder="전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">전체</SelectItem>
              {meta.teams.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm font-medium whitespace-nowrap">대상</span>
          {(
            [
              { v: "all", label: "전체" },
              { v: "own", label: "본인소속" },
              { v: "other", label: "타본부소속" },
            ] as { v: TargetType; label: string }[]
          ).map(({ v, label }) => (
            <label key={v} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="targetType"
                value={v}
                checked={draft.targetType === v}
                onChange={() => setDraft((prev) => ({ ...prev, targetType: v }))}
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>

        <Button onClick={handleSearch} disabled={loading} size="sm" className="h-8">
          검색
        </Button>
        <span className="text-sm text-muted-foreground">총 {total}명</span>

        {/* 최종 제출 버튼 (본부장만) */}
        {isDeptHead && !isSubmitted && (
          <Button
            size="sm"
            className="h-8 ml-auto bg-blue-600 hover:bg-blue-700"
            onClick={() => setConfirmSubmitOpen(true)}
          >
            <Send className="w-3.5 h-3.5 mr-1.5" />
            최종 제출
          </Button>
        )}
      </div>

      {/* ── 테이블 ──────────────────────────────────────────── */}
      <div className="overflow-x-auto border rounded-md">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 text-center">
              <th className="border px-2 py-2 font-medium w-10 sticky left-0 bg-gray-100 z-10">No.</th>
              <th className="border px-2 py-2 font-medium sticky left-10 bg-gray-100 z-10">본부</th>
              <th className="border px-2 py-2 font-medium">팀</th>
              <th className="border px-2 py-2 font-medium">이름</th>
              <th className="border px-2 py-2 font-medium">레벨</th>
              <th className="border px-2 py-2 font-medium">연차</th>
              <th className="border px-2 py-2 font-medium">입사일</th>
              <th className="border px-2 py-2 font-medium">포인트</th>
              <th className="border px-2 py-2 font-medium">학점</th>
              {GRADE_YEARS.map((y) => (
                <th key={y} className="border px-2 py-2 font-medium text-xs text-gray-600">{y}</th>
              ))}
              <th className="border px-2 py-2 font-medium">의견</th>
              <th className="border px-2 py-2 font-medium">추천여부</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COL_COUNT} className="text-center py-10 text-muted-foreground">
                  불러오는 중...
                </td>
              </tr>
            ) : candidates.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} className="text-center py-10 text-muted-foreground">
                  심사 대상자가 없습니다.
                </td>
              </tr>
            ) : (
              candidates.map((c, idx) => {
                const rowDeptSubmitted = submittedDepts.has(c.department);

                return (
                  <tr
                    key={c.candidateId}
                    className="text-center hover:bg-gray-50"
                  >
                    <td className="border px-2 py-1.5 text-gray-500 sticky left-0 bg-white z-10">
                      {idx + 1}
                    </td>
                    <td className="border px-2 py-1.5 text-left sticky left-10 bg-white z-10">
                      <span>{c.department || "-"}</span>
                      {isAdmin && rowDeptSubmitted && (
                        <span className="ml-1.5 text-xs bg-green-100 text-green-700 px-1 py-0.5 rounded font-medium">
                          제출
                        </span>
                      )}
                    </td>
                    <td className="border px-2 py-1.5 text-left">{c.team || "-"}</td>
                    <td className="border px-2 py-1.5 font-medium">{c.name}</td>
                    <td className="border px-2 py-1.5">{c.competencyLevel ?? c.level ?? "-"}</td>
                    <td className="border px-2 py-1.5">{c.yearsOfService ?? "-"}</td>
                    <td className="border px-2 py-1.5">{formatDate(c.hireDate)}</td>
                    <td className="border px-2 py-1.5 font-mono text-xs">{c.pointCumulative.toFixed(1)}</td>
                    <td className="border px-2 py-1.5 font-mono text-xs">{c.creditCumulative.toFixed(1)}</td>

                    {/* 평가등급 컬럼 2021~2025 */}
                    {GRADE_YEARS.map((y) => (
                      <td key={y} className="border px-2 py-1.5">
                        <GradeBadge grade={c.grades[y]} />
                      </td>
                    ))}

                    {/* 의견 */}
                    <td className="border px-2 py-1.5">
                      <button
                        onClick={() => c.reviewId && setSelectedReviewId(c.reviewId)}
                        disabled={!c.reviewId}
                        className="flex items-center justify-center gap-0.5 w-full cursor-pointer disabled:cursor-default"
                      >
                        {c.currentUserOpinionSavedAt ? (
                          <span className="flex items-center gap-0.5 text-green-600 text-xs">
                            <CheckCircle2 className="w-3.5 h-3.5" /> 입력완료
                          </span>
                        ) : (
                          <span className="flex items-center gap-0.5 text-orange-500 text-xs">
                            <AlertTriangle className="w-3.5 h-3.5" /> 미입력
                          </span>
                        )}
                      </button>
                    </td>

                    {/* 추천여부 (읽기 전용 — 의견 팝업에서만 변경 가능) */}
                    <td className="border px-2 py-1.5">
                      {c.recommendationStatus === "추천" ? (
                        <span className="flex items-center justify-center gap-0.5 text-green-600 text-xs font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> 추천
                        </span>
                      ) : c.recommendationStatus === "제외" ? (
                        <span className="flex items-center justify-center gap-0.5 text-red-500 text-xs font-medium">
                          <AlertTriangle className="w-3.5 h-3.5" /> 미추천
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── 의견 입력 팝업 ──────────────────────────────────── */}
      {selectedReviewId && (
        <OpinionModal
          reviewId={selectedReviewId}
          onClose={() => setSelectedReviewId(null)}
          onSaved={handleOpinionSaved}
          isSubmitted={isSubmitted && isDeptHead}
        />
      )}

      {/* ── 최종 제출 확인 다이얼로그 ───────────────────────── */}
      <Dialog open={confirmSubmitOpen} onOpenChange={(o) => !o && setConfirmSubmitOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>최종 제출</DialogTitle>
            <DialogDescription>
              <strong>{currentUser?.department}</strong> 본부의 {query.year}년 심사 의견을
              최종 제출하시겠습니까?
              <br />
              제출 후에는 추천여부 변경 및 의견 수정이 불가합니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSubmitOpen(false)} disabled={submitting}>
              취소
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "제출 중..." : "최종 제출"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 제출 취소 확인 다이얼로그 ───────────────────────── */}
      <Dialog open={confirmCancelOpen} onOpenChange={(o) => !o && setConfirmCancelOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>제출 취소</DialogTitle>
            <DialogDescription>
              {query.year}년 심사 최종 제출을 취소하시겠습니까?
              <br />
              취소 후에는 다시 수정 및 재제출이 가능합니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancelOpen(false)} disabled={submitting}>
              닫기
            </Button>
            <Button variant="destructive" onClick={handleCancelSubmit} disabled={submitting}>
              {submitting ? "취소 중..." : "제출 취소"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
