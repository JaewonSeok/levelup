"use client";

import { useState, useEffect, useCallback } from "react";
import { useImpersonate } from "@/context/ImpersonateContext";
import { linkifyText } from "@/utils/linkify";
import { Button } from "@/components/ui/button";
import { EmployeeTooltip } from "@/components/EmployeeTooltip";
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
import { CheckCircle2, AlertTriangle, Send, ChevronDown, ChevronUp, ChevronsUpDown, Info } from "lucide-react";
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

interface AiScoreResult {
  totalScore: number;
  trendScore: number;
  pointsExcessScore: number;
  creditsExcessScore: number;
  stabilityScore: number;
  maturityScore: number;
  grade: string;
  details: string[];
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
  bonusTotal?: number;
  penaltyTotal?: number;
  promotionType?: string;
  currentUserOpinionSavedAt: string | null;
  currentUserHasOpinion?: boolean;
  currentUserRecommendation?: "추천" | "제외" | "의견없음" | null;
  currentUserRecommendationReason?: string | null;
  ownDeptHeadHasOpinion: boolean;
  recommendationStatus: "추천" | "제외" | "의견없음" | null;
  recommendationReason?: string | null;
  grades: GradeMap;
  aiScore?: AiScoreResult;
  sameLevelAvgPoints?: number;
  sameLevelAvgCredits?: number;
  requiredPoints?: number | null;
  requiredCredits?: number | null;
  minTenure?: number;
  note?: { noteText: string | null; fileUrl: string | null; fileName: string | null } | null;
}

interface CurrentUser {
  id: string;
  role: string;
  department: string;
  currentPhase?: number;
  isImpersonating?: boolean;
}

interface Query {
  year: number;
  department: string;
  team: string;
}

// ── Constants ──────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const GRADE_YEARS = [2021, 2022, 2023, 2024, 2025] as const;

// No. 본부 팀 이름 레벨 연차 입사일 포인트 학점 구분 AI점수 의견 추천여부 + 5 grade cols
const COL_BASE = 13;
const COL_COUNT = COL_BASE + GRADE_YEARS.length; // 18

// ── NoteModal ──────────────────────────────────────────────────

interface CandidateNoteData {
  noteText: string | null;
  fileUrl: string | null;
  fileName: string | null;
}

interface NoteModalProps {
  candidateId: string;
  candidateName: string;
  initialNote: CandidateNoteData | null;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (candidateId: string, note: CandidateNoteData | null) => void;
}

function NoteModal({ candidateId, candidateName, initialNote, readOnly = false, onClose, onSaved }: NoteModalProps) {
  const hasExisting = !!initialNote?.noteText;
  // readOnly면 항상 보기 모드 고정; 기존 메모 없으면 바로 편집 모드
  const [isEditing, setIsEditing] = useState(!hasExisting && !readOnly);
  const [noteText, setNoteText] = useState(initialNote?.noteText ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/candidate-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, noteText: noteText.trim() || null, fileUrl: null, fileName: null }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "저장 실패");
      }
      onSaved(candidateId, { noteText: noteText.trim() || null, fileUrl: null, fileName: null });
      toast.success("메모가 저장되었습니다.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/candidate-notes?candidateId=${candidateId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "삭제 실패");
      }
      onSaved(candidateId, null);
      toast.success("메모가 삭제되었습니다.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "삭제 중 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelEdit = () => {
    setNoteText(initialNote?.noteText ?? "");
    setIsEditing(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-[90vw] min-w-[520px] max-w-[640px]">
        <DialogHeader>
          <DialogTitle>비고 메모 — {candidateName}</DialogTitle>
        </DialogHeader>

        {isEditing ? (
          /* ── 편집 모드 ── */
          <div>
            <textarea
              className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              style={{ minHeight: "200px" }}
              maxLength={2000}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="개인별 메모를 입력하세요. (최대 2,000자)"
              autoFocus
            />
            <p className="text-right text-xs text-muted-foreground">{noteText.length} / 2,000</p>
          </div>
        ) : (
          /* ── 보기 모드 ── */
          <div className="min-h-[200px] px-3 py-2 border rounded-md bg-gray-50 text-sm whitespace-pre-wrap leading-relaxed break-all">
            {noteText.trim() ? linkifyText(noteText) : <span className="text-muted-foreground">메모 없음</span>}
          </div>
        )}

        <DialogFooter className="gap-2 mt-2">
          {isEditing ? (
            <>
              {hasExisting && (
                <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={saving || deleting}>
                  취소
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving || deleting}>닫기</Button>
              <Button size="sm" onClick={handleSave} disabled={saving || deleting}>
                {saving ? "저장 중..." : "저장"}
              </Button>
            </>
          ) : (
            <>
              {!readOnly && hasExisting && (
                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "삭제 중..." : "삭제"}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onClose}>닫기</Button>
              {!readOnly && (
                <Button size="sm" onClick={() => setIsEditing(true)}>편집</Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Grade badge ────────────────────────────────────────────────

function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-gray-300 text-xs">-</span>;
  const colors: Record<string, string> = {
    S: "bg-amber-100 text-[#b8860b]",
    A: "bg-green-100 text-green-700",
    B: "bg-gray-100 text-gray-600",
    C: "bg-orange-100 text-orange-700",
    O: "bg-blue-100 text-blue-700",
    E: "bg-green-100 text-green-700",
    G: "bg-gray-100 text-gray-600",
    N: "bg-orange-100 text-orange-700",
    U: "bg-red-100 text-red-700",
  };
  const cls = colors[grade.toUpperCase()] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${cls}`}>
      {grade}
    </span>
  );
}

// ── ReasonTooltip ───────────────────────────────────────────────

function ReasonTooltip({ children, reason }: { children: React.ReactNode; reason?: string | null }) {
  if (!reason) return <>{children}</>;
  return (
    <div className="relative group inline-flex items-center gap-0.5">
      {children}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 hidden group-hover:block max-w-[300px] min-w-[80px] bg-gray-800 text-white text-xs rounded-md shadow-lg px-2 py-1.5 whitespace-pre-wrap pointer-events-none">
        {reason}
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────

export default function ReviewPage() {
  const { impersonateDept } = useImpersonate();

  const [query, setQuery] = useState<Query>({
    year: CURRENT_YEAR,
    department: "",
    team: "",
  });
  const [draft, setDraft] = useState<Query>({
    year: CURRENT_YEAR,
    department: "",
    team: "",
  });

  const [levelFilter, setLevelFilter] = useState<string>("");
  const [levelSortDir, setLevelSortDir] = useState<"asc" | "desc" | null>(null);

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
  const [selectedCandidate, setSelectedCandidate] = useState<ReviewCandidate | null>(null);

  // AI 점수 상세 팝업
  const [aiDetailTarget, setAiDetailTarget] = useState<ReviewCandidate | null>(null);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [aiReportLoading, setAiReportLoading] = useState(false);

  // 추천/미추천 사유 팝업 (HR_TEAM / SYSTEM_ADMIN 테이블 드롭다운)
  const [recReasonPopup, setRecReasonPopup] = useState<{
    reviewId: string;
    targetValue: "true" | "false";
    reason: string;
  } | null>(null);

  // 비고 NoteModal
  const [noteModal, setNoteModal] = useState<{ candidateId: string; candidateName: string; note: CandidateNoteData | null } | null>(null);

  // Phase 전환
  const [phaseChanging, setPhaseChanging] = useState(false);
  const [confirmPhaseOpen, setConfirmPhaseOpen] = useState(false);

  // 제출 상태
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isPhase2Submitted, setIsPhase2Submitted] = useState(false);
  const [allDeptHeadDepts, setAllDeptHeadDepts] = useState<string[]>([]);
  const [submittedDepts, setSubmittedDepts] = useState<Set<string>>(new Set());
  const [submittedDeptMap, setSubmittedDeptMap] = useState<Map<string, string>>(new Map());
  const [phase2SubmittedDeptMap, setPhase2SubmittedDeptMap] = useState<Map<string, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [confirmPhase2SubmitOpen, setConfirmPhase2SubmitOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(true);
  const [cancelingDept, setCancelingDept] = useState<string | null>(null);

  // ── Fetch ────────────────────────────────────────────────────

  const fetchSubmissionStatus = useCallback(async (year: number) => {
    try {
      const res = await fetch(`/api/reviews/submit?year=${year}`);
      if (!res.ok) return;
      const data = await res.json();
      setIsSubmitted(data.isSubmitted ?? false);
      setIsPhase2Submitted(data.isPhase2Submitted ?? false);
      if (data.allDepartments) setAllDeptHeadDepts(data.allDepartments);
      const deptList: { department: string; submittedAt: string }[] = data.submittedDepartments ?? [];
      setSubmittedDepts(new Set(deptList.map((s) => s.department)));
      setSubmittedDeptMap(new Map(deptList.map((s) => [s.department, s.submittedAt])));
      const phase2List: { department: string; submittedAt: string }[] = data.phase2SubmittedDepts ?? [];
      setPhase2SubmittedDeptMap(new Map(phase2List.map((s) => [s.department, s.submittedAt])));
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
          targetType: "all",
        });
        if (impersonateDept) sp.set("impersonate", impersonateDept);
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
  }, [query, refreshKey, fetchSubmissionStatus, impersonateDept]);

  // ── Handlers ─────────────────────────────────────────────────

  const handleSearch = () => setQuery({ ...draft });

  const isDeptHead = currentUser?.role === "DEPT_HEAD";
  const isAdmin = currentUser?.role === "SYSTEM_ADMIN";
  const isHROrAdmin = currentUser?.role === "HR_TEAM" || currentUser?.role === "SYSTEM_ADMIN";
  const isImpersonating = !!(currentUser?.isImpersonating);
  const currentPhase = currentUser?.currentPhase ?? 1;
  const canEditNote = isHROrAdmin;
  // 비고 컬럼: 전체 역할에 표시 (본부장은 읽기 전용)
  const showNoteColumn = true;

  // 본부장: Phase별 표시 범위 필터 (API 필터 + 프론트 이중 보장)
  const currentDeptName = currentUser?.department ?? "";
  const displayCandidates = isDeptHead
    ? candidates.filter((c) => {
        if (currentPhase === 2) {
          // Phase 2: 타본부장 교차심사 — 본인소속 제외 + L3/L4만 (이중 보장)
          return c.department !== currentDeptName && (c.level === "L3" || c.level === "L4");
        }
        // Phase 1: API가 이미 본인소속만 반환하므로 그대로 통과
        return true;
      })
    : candidates;

  // 레벨 필터 적용
  const levelFilteredCandidates = levelFilter
    ? displayCandidates.filter((c) => (c.level ?? "") === levelFilter)
    : displayCandidates;

  // 레벨 정렬 + 본부장 "전체" 시 본인 소속 먼저 정렬
  const levelOrder = (level: string | null) => {
    const n = parseInt((level ?? "").replace("L", ""), 10);
    return isNaN(n) ? -1 : n;
  };
  const sortedCandidates = (() => {
    const list = [...levelFilteredCandidates];
    if (levelSortDir) {
      list.sort((a, b) => {
        const diff = levelOrder(a.level) - levelOrder(b.level);
        return levelSortDir === "asc" ? diff : -diff;
      });
    } else if (isDeptHead) {
      list.sort((a, b) => {
        const aOwn = a.department === currentDeptName ? 0 : 1;
        const bOwn = b.department === currentDeptName ? 0 : 1;
        if (aOwn !== bOwn) return aOwn - bOwn;
        return a.department.localeCompare(b.department, "ko");
      });
    }
    return list;
  })();
  const displayTotal = isDeptHead ? levelFilteredCandidates.length : (levelFilter ? levelFilteredCandidates.length : total);

  // Phase 2 제출 가능 여부: 타본부 L3/L4 후보자 전원에 대해 의견 입력 완료
  const phase2OtherCandidates = isDeptHead && currentPhase === 2
    ? displayCandidates.filter((c) => c.department !== currentDeptName)
    : [];
  const canPhase2Submit = phase2OtherCandidates.length > 0
    && phase2OtherCandidates.every((c) => c.currentUserHasOpinion);

  // 본부별 제출 현황: 실제 대상자가 있는 본부만 표시
  const candidateDepartments = Array.from(
    new Set(candidates.map((c) => c.department).filter(Boolean))
  ).sort();

  // 의견 저장 성공 콜백 — 서버가 확정한 값 + Review 업데이트 여부 수신
  const handleOpinionSaved = (
    reviewerRole: string,
    recommendation: boolean | null,
    reviewUpdated: boolean,
    noOpinion?: boolean
  ) => {
    if (selectedReviewId !== null) {
      const targetId = selectedReviewId;
      const nowIso = new Date().toISOString();
      setCandidates((prev) =>
        prev.map((c) => {
          if (c.reviewId !== targetId) return c;
          // ① 현재 유저의 의견 저장 시각 + 본인 의견 상태 즉시 반영
          const currentUserRec: "추천" | "제외" | "의견없음" | null =
            noOpinion ? "의견없음" :
            recommendation === true ? "추천" :
            recommendation === false ? "제외" :
            null;
          const updates: Partial<typeof c> = {
            currentUserOpinionSavedAt: nowIso,
            currentUserHasOpinion: true,
            currentUserRecommendation: currentUserRec,
          };
          // ② 소속본부장이 저장한 경우 → 의견 컬럼·추천여부 즉시 반영
          if (reviewerRole === "소속본부장") {
            updates.ownDeptHeadHasOpinion = true;
            if (reviewUpdated) {
              updates.recommendationStatus = currentUserRec;
            }
          }
          return { ...c, ...updates };
        })
      );
    }
    // ③ 백그라운드 refetch — 전체 데이터 정확성 보장
    setRefreshKey((k) => k + 1);
  };

  // ── 추천여부 드롭다운 (HR_TEAM / SYSTEM_ADMIN 전용) ──────────
  const doSaveRecommendation = useCallback(async (
    reviewId: string,
    value: string, // "true" | "false" | "none" | ""
    reason: string | null = null
  ) => {
    const noOpinion = value === "none";
    const recommendation = value === "true" ? true : value === "false" ? false : null;
    const status: "추천" | "제외" | "의견없음" | null =
      noOpinion ? "의견없음" :
      recommendation === true ? "추천" :
      recommendation === false ? "제외" : null;

    setCandidates((prev) =>
      prev.map((c) =>
        c.reviewId === reviewId
          ? { ...c, recommendationStatus: status, recommendationReason: reason }
          : c
      )
    );
    try {
      const res = await fetch(`/api/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendation, recommendationReason: reason, noOpinion }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "변경 실패");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "추천여부 변경 실패");
      setRefreshKey((k) => k + 1);
    }
  }, []);

  const handleRecommendationChange = (reviewId: string, value: string) => {
    if ((value === "true" || value === "false") && isAdmin) {
      // 수정 3: SYSTEM_ADMIN만 사유 팝업 표시
      const prev = candidates.find((c) => c.reviewId === reviewId);
      setRecReasonPopup({
        reviewId,
        targetValue: value as "true" | "false",
        reason: prev?.recommendationReason ?? "",
      });
    } else {
      // 비어드민 또는 의견없음/선택해제: 팝업 없이 바로 저장
      doSaveRecommendation(reviewId, value, null);
    }
  };

  const handleRecReasonConfirm = () => {
    if (!recReasonPopup) return;
    const { reviewId, targetValue, reason } = recReasonPopup;
    setRecReasonPopup(null);
    doSaveRecommendation(reviewId, targetValue, reason || null);
  };

  const handleRecReasonCancel = () => {
    setRecReasonPopup(null);
  };

  const handleGenerateAiReport = async (candidate: ReviewCandidate) => {
    setAiReportLoading(true);
    try {
      const res = await fetch("/api/ai-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeData: {
            name: candidate.name,
            department: candidate.department,
            team: candidate.team,
            level: candidate.level,
            yearsOfService: candidate.yearsOfService,
            promotionType: candidate.promotionType,
            grades: candidate.grades,
            pointCumulative: candidate.pointCumulative,
            creditCumulative: candidate.creditCumulative,
            aiScore: candidate.aiScore,
            sameLevelAvgPoints: candidate.sameLevelAvgPoints,
            sameLevelAvgCredits: candidate.sameLevelAvgCredits,
            requiredPoints: candidate.requiredPoints,
            requiredCredits: candidate.requiredCredits,
            minTenure: candidate.minTenure,
          },
        }),
      });
      if (!res.ok) {
        let errMsg = "AI 분석 실패";
        try { const e = await res.json(); errMsg = e.error ?? errMsg; } catch { /* non-JSON */ }
        throw new Error(errMsg);
      }
      const data = await res.json();
      setAiReport(data.report);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI 분석 중 오류가 발생했습니다.");
    } finally {
      setAiReportLoading(false);
    }
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

  const handleAdminCancelSubmit = async (dept: string) => {
    setCancelingDept(dept);
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: query.year, department: dept, phase: 1 }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "취소 실패");
      }
      toast.success(`${dept} 1차 제출이 취소되었습니다.`);
      fetchSubmissionStatus(query.year);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "취소 중 오류가 발생했습니다.");
    } finally {
      setCancelingDept(null);
    }
  };

  const handleAdminCancelPhase2Submit = async (dept: string) => {
    setCancelingDept(`p2-${dept}`);
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: query.year, department: dept, phase: 2 }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "취소 실패");
      }
      toast.success(`${dept} 2차 제출이 취소되었습니다.`);
      fetchSubmissionStatus(query.year);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "취소 중 오류가 발생했습니다.");
    } finally {
      setCancelingDept(null);
    }
  };

  const handlePhase2Submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: query.year, phase: 2 }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "제출 실패");
      }
      setIsPhase2Submitted(true);
      toast.success("2차 심사 최종 제출이 완료되었습니다.");
      setConfirmPhase2SubmitOpen(false);
      fetchSubmissionStatus(query.year);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "제출 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleNoteSaved = (candidateId: string, note: CandidateNoteData | null) => {
    setCandidates((prev) => prev.map((c) => c.candidateId === candidateId ? { ...c, note } : c));
  };

  const handlePhaseChange = async (newPhase: number) => {
    setPhaseChanging(true);
    try {
      const res = await fetch("/api/review-phase", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: query.year, phase: newPhase }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Phase 변경 실패");
      }
      toast.success(`${newPhase}차 심사 단계로 전환되었습니다.`);
      setConfirmPhaseOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Phase 변경 중 오류가 발생했습니다.");
    } finally {
      setPhaseChanging(false);
    }
  };

  const formatDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "-");

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">레벨업 심사</h1>

      {/* ── Phase 상태 배너 ────────────────────────────────────── */}
      <div className={`flex items-center justify-between gap-3 border rounded-md px-4 py-2.5 mb-4 text-sm font-medium ${
        currentPhase === 1
          ? "bg-blue-50 border-blue-300 text-blue-700"
          : "bg-orange-50 border-orange-300 text-orange-700"
      }`}>
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 flex-shrink-0" />
          {currentPhase === 1
            ? "1차 심사 진행 중 — 소속 본부 직원에 대한 역량평가 및 의견을 입력해주세요."
            : "2차 심사 진행 중 — 타 본부 추천 직원에 대한 의견을 입력해주세요."}
        </div>
        {isHROrAdmin && (
          <Button
            size="sm"
            variant="outline"
            className={`h-7 text-xs flex-shrink-0 ${
              currentPhase === 1
                ? "border-blue-400 text-blue-700 hover:bg-blue-100"
                : "border-orange-400 text-orange-700 hover:bg-orange-100"
            }`}
            onClick={() => setConfirmPhaseOpen(true)}
          >
            {currentPhase === 1 ? "2차 심사 오픈" : "1차 심사로 되돌리기"}
          </Button>
        )}
      </div>

      {/* ── 어드민 패널: 본부별 제출 현황 (HR_TEAM / SYSTEM_ADMIN) ── */}
      {isHROrAdmin && (
        <div className="border rounded-md mb-4 bg-white">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-gray-50"
            onClick={() => setAdminPanelOpen((o) => !o)}
          >
            <span>본부별 제출 현황 ({candidateDepartments.length}개 본부)</span>
            {adminPanelOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {adminPanelOpen && (
            <div className="border-t">
              {/* 1차 제출 현황 */}
              <div className="px-4 py-2 bg-blue-50 text-xs font-semibold text-blue-700 border-b">1차 심사 제출 현황</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-center">
                      <th className="border-b px-3 py-2 font-medium text-left">본부</th>
                      <th className="border-b px-3 py-2 font-medium">제출 상태</th>
                      <th className="border-b px-3 py-2 font-medium">제출 일시</th>
                      <th className="border-b px-3 py-2 font-medium w-24">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidateDepartments.map((dept) => {
                      const submittedAt = submittedDeptMap.get(dept);
                      const isSubm = !!submittedAt;
                      const isCanceling = cancelingDept === dept;
                      return (
                        <tr key={dept} className="text-center hover:bg-gray-50">
                          <td className="border-b px-3 py-1.5 text-left">{dept}</td>
                          <td className="border-b px-3 py-1.5">
                            {isSubm ? (
                              <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full font-medium">
                                <CheckCircle2 className="w-3 h-3" /> 제출 완료
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full font-medium">
                                <AlertTriangle className="w-3 h-3" /> 미제출
                              </span>
                            )}
                          </td>
                          <td className="border-b px-3 py-1.5 text-xs text-gray-500">
                            {submittedAt ? new Date(submittedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-"}
                          </td>
                          <td className="border-b px-3 py-1.5">
                            {isSubm && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2 text-red-600 border-red-300 hover:bg-red-50"
                                disabled={isCanceling}
                                onClick={() => handleAdminCancelSubmit(dept)}
                              >
                                {isCanceling ? "취소 중..." : "제출 취소"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* 2차 제출 현황 */}
              <div className="px-4 py-2 bg-orange-50 text-xs font-semibold text-orange-700 border-t border-b">2차 심사 제출 현황</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-center">
                      <th className="border-b px-3 py-2 font-medium text-left">본부</th>
                      <th className="border-b px-3 py-2 font-medium">제출 상태</th>
                      <th className="border-b px-3 py-2 font-medium">제출 일시</th>
                      <th className="border-b px-3 py-2 font-medium w-24">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(allDeptHeadDepts.length > 0 ? allDeptHeadDepts : candidateDepartments).map((dept) => {
                      const submittedAt = phase2SubmittedDeptMap.get(dept);
                      const isSubm = !!submittedAt;
                      const isCanceling = cancelingDept === `p2-${dept}`;
                      return (
                        <tr key={dept} className="text-center hover:bg-gray-50">
                          <td className="border-b px-3 py-1.5 text-left">{dept}</td>
                          <td className="border-b px-3 py-1.5">
                            {isSubm ? (
                              <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full font-medium">
                                <CheckCircle2 className="w-3 h-3" /> 제출 완료
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full font-medium">
                                미제출
                              </span>
                            )}
                          </td>
                          <td className="border-b px-3 py-1.5 text-xs text-gray-500">
                            {submittedAt ? new Date(submittedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-"}
                          </td>
                          <td className="border-b px-3 py-1.5">
                            {isSubm && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2 text-red-600 border-red-300 hover:bg-red-50"
                                disabled={isCanceling}
                                onClick={() => handleAdminCancelPhase2Submit(dept)}
                              >
                                {isCanceling ? "취소 중..." : "제출 취소"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 제출 완료 배너 (본부장) ──────────────────────────── */}
      {isDeptHead && currentPhase === 1 && isSubmitted && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-300 rounded-md px-4 py-2.5 mb-4 text-green-700 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4" />
          1차 심사 최종 제출 완료 — 더 이상 수정할 수 없습니다.
        </div>
      )}
      {isDeptHead && currentPhase === 2 && isPhase2Submitted && (
        <div className="flex items-center gap-2 bg-orange-50 border border-orange-300 rounded-md px-4 py-2.5 mb-4 text-orange-700 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4" />
          2차 심사 최종 제출 완료 — 타본부 심사 의견이 제출되었습니다.
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

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium whitespace-nowrap">레벨</span>
          <Select
            value={levelFilter || "__all__"}
            onValueChange={(v) => setLevelFilter(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="w-28 h-8 text-sm bg-white">
              <SelectValue placeholder="전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">전체</SelectItem>
              {["L0", "L1", "L2", "L3", "L4", "L5"].map((lv) => (
                <SelectItem key={lv} value={lv}>{lv}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={handleSearch} disabled={loading} size="sm" className="h-8">
          검색
        </Button>
        <span className="text-sm text-muted-foreground">총 {displayTotal}명</span>

        {/* 1차 최종 제출 버튼 (본부장 + Phase 1) */}
        {isDeptHead && !isImpersonating && currentPhase === 1 && !isSubmitted && (
          <Button
            size="sm"
            className="h-8 ml-auto bg-blue-600 hover:bg-blue-700"
            onClick={() => setConfirmSubmitOpen(true)}
          >
            <Send className="w-3.5 h-3.5 mr-1.5" />
            최종 제출 (1차)
          </Button>
        )}
        {/* 2차 최종 제출 버튼 (본부장 + Phase 2) */}
        {isDeptHead && !isImpersonating && currentPhase === 2 && !isPhase2Submitted && (
          <Button
            size="sm"
            className={`h-8 ml-auto ${canPhase2Submit ? "bg-orange-600 hover:bg-orange-700" : "bg-gray-400 cursor-not-allowed"}`}
            disabled={!canPhase2Submit}
            onClick={() => setConfirmPhase2SubmitOpen(true)}
            title={!canPhase2Submit ? "타본부 후보자 전원에 대한 의견을 입력해야 제출할 수 있습니다." : undefined}
          >
            <Send className="w-3.5 h-3.5 mr-1.5" />
            최종 제출 (2차)
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
              <th
                className="border px-2 py-2 font-medium cursor-pointer select-none hover:bg-gray-200 transition-colors"
                onClick={() =>
                  setLevelSortDir((prev) =>
                    prev === null ? "asc" : prev === "asc" ? "desc" : null
                  )
                }
              >
                <span className="inline-flex items-center gap-0.5">
                  레벨
                  {levelSortDir === "asc" ? (
                    <ChevronUp className="w-3.5 h-3.5 text-blue-600" />
                  ) : levelSortDir === "desc" ? (
                    <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                  ) : (
                    <ChevronsUpDown className="w-3.5 h-3.5 text-gray-400" />
                  )}
                </span>
              </th>
              <th className="border px-2 py-2 font-medium">연차</th>
              <th className="border px-2 py-2 font-medium">입사일</th>
              <th className="border px-2 py-2 font-medium">포인트</th>
              <th className="border px-2 py-2 font-medium">학점</th>
              {GRADE_YEARS.map((y) => (
                <th key={y} className="border px-2 py-2 font-medium text-xs text-gray-600">{y}</th>
              ))}
              <th className="border px-2 py-2 font-medium">구분</th>
              <th className="border px-2 py-2 font-medium text-xs text-purple-700">AI 점수</th>
              <th className="border px-2 py-2 font-medium">
                의견
                {isDeptHead && <span className="text-[10px] text-gray-400 block font-normal">(본인 의견만 표시)</span>}
              </th>
              <th className="border px-2 py-2 font-medium">추천여부</th>
              {showNoteColumn && <th className="border px-2 py-2 font-medium">비고</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COL_COUNT + (showNoteColumn ? 1 : 0)} className="text-center py-10 text-muted-foreground">
                  불러오는 중...
                </td>
              </tr>
            ) : sortedCandidates.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT + (showNoteColumn ? 1 : 0)} className="text-center py-10 text-muted-foreground">
                  {isDeptHead && currentPhase === 2
                    ? "2차 심사 대상자가 없습니다. (추천된 타 본부 직원이 없습니다.)"
                    : "심사 대상자가 없습니다."}
                </td>
              </tr>
            ) : (
              sortedCandidates.map((c, idx) => {
                const rowDeptSubmitted = submittedDepts.has(c.department);
                const isOtherDeptRow = isDeptHead && c.department !== currentDeptName;
                // Phase 1: 본부장이 타본부 직원 의견 입력 불가 (잠금)
                const opinionLocked = isDeptHead && currentPhase === 1 && isOtherDeptRow;
                // Phase 2: 본부장이 소속 본부 직원 의견 수정 불가 (읽기전용)
                const opinionReadOnly = isDeptHead && currentPhase === 2 && !isOtherDeptRow;

                return (
                  <tr
                    key={c.candidateId}
                    className={`text-center hover:bg-gray-50 ${isOtherDeptRow ? "bg-gray-50/60" : ""}`}
                  >
                    <td className={`border px-2 py-1.5 text-gray-500 sticky left-0 z-10 ${isOtherDeptRow ? "bg-gray-50" : "bg-white"}`}>
                      {idx + 1}
                    </td>
                    <td className={`border px-2 py-1.5 text-left sticky left-10 z-10 ${isOtherDeptRow ? "bg-gray-50" : "bg-white"}`}>
                      <span>{c.department || "-"}</span>
                      {isOtherDeptRow && (
                        <span className="ml-1 text-[10px] bg-purple-100 text-purple-600 px-1 py-0.5 rounded">타본부</span>
                      )}
                      {isHROrAdmin && rowDeptSubmitted && (
                        <span className="ml-1.5 text-xs bg-green-100 text-green-700 px-1 py-0.5 rounded font-medium">
                          제출
                        </span>
                      )}
                    </td>
                    <td className="border px-2 py-1.5 text-left">{c.team || "-"}</td>
                    <td className="border px-2 py-1.5 font-medium">
                      <EmployeeTooltip
                        name={c.name}
                        department={c.department}
                        team={c.team}
                        level={c.level}
                        competencyLevel={c.competencyLevel}
                        hireDate={c.hireDate}
                        yearsOfService={c.yearsOfService}
                        pointCumulative={c.pointCumulative}
                        creditCumulative={c.creditCumulative}
                      >
                        {c.name}
                      </EmployeeTooltip>
                    </td>
                    <td className="border px-2 py-1.5">{c.competencyLevel ?? c.level ?? "-"}</td>
                    <td className="border px-2 py-1.5">{c.yearsOfService ?? "-"}</td>
                    <td className="border px-2 py-1.5">{formatDate(c.hireDate)}</td>
                    <td className="border px-2 py-1.5 font-mono text-xs">
                      {c.pointCumulative.toFixed(1)}
                      {(c.bonusTotal ?? 0) > 0 && (c.penaltyTotal ?? 0) > 0 && (
                        <span className="ml-1 text-[10px] text-purple-600">±</span>
                      )}
                      {(c.bonusTotal ?? 0) > 0 && (c.penaltyTotal ?? 0) === 0 && (
                        <span className="ml-1 text-[10px] text-blue-600">↑</span>
                      )}
                      {(c.bonusTotal ?? 0) === 0 && (c.penaltyTotal ?? 0) > 0 && (
                        <span className="ml-1 text-[10px] text-red-500">↓</span>
                      )}
                    </td>
                    <td className="border px-2 py-1.5 font-mono text-xs">{c.creditCumulative.toFixed(1)}</td>

                    {/* 평가등급 컬럼 2021~2025 */}
                    {GRADE_YEARS.map((y) => (
                      <td key={y} className="border px-2 py-1.5">
                        <GradeBadge grade={c.grades[y]} />
                      </td>
                    ))}

                    {/* 구분 (일반/특진) */}
                    <td className="border px-2 py-1.5 text-center">
                      {c.promotionType === "special" ? (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">특진</span>
                      ) : (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">일반</span>
                      )}
                    </td>

                    {/* AI 점수 */}
                    <td className="border px-2 py-1.5 text-center">
                      {c.aiScore ? (
                        <button
                          onClick={() => setAiDetailTarget(c)}
                          className="flex flex-col items-center gap-0.5 w-full hover:opacity-80 transition-opacity"
                        >
                          <span className={`font-bold text-sm ${
                            c.aiScore.grade === "S" ? "text-purple-600" :
                            c.aiScore.grade === "A" ? "text-blue-600" :
                            c.aiScore.grade === "B" ? "text-green-600" :
                            c.aiScore.grade === "C" ? "text-orange-500" : "text-red-500"
                          }`}>
                            {c.aiScore.grade}
                          </span>
                          <span className="text-[10px] text-gray-400">{c.aiScore.totalScore}점</span>
                        </button>
                      ) : (
                        <span className="text-gray-300 text-xs">-</span>
                      )}
                    </td>

                    {/* 의견 */}
                    <td className="border px-2 py-1.5">
                      {opinionLocked ? (
                        <span className="flex items-center justify-center gap-0.5 text-gray-400 text-xs cursor-not-allowed" title="1차 심사에서는 소속 본부 직원에 대해서만 의견 입력 가능합니다.">
                          <Info className="w-3.5 h-3.5" /> 잠금
                        </span>
                      ) : (
                        <button
                          onClick={() => { if (c.reviewId) { setSelectedReviewId(c.reviewId); setSelectedCandidate(c); } }}
                          disabled={!c.reviewId}
                          className="flex items-center justify-center gap-0.5 w-full cursor-pointer disabled:cursor-default"
                        >
                          {opinionReadOnly ? (
                            <span className="flex items-center gap-0.5 text-gray-500 text-xs">
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> 1차완료
                            </span>
                          ) : (isDeptHead && c.department !== currentDeptName ? c.currentUserHasOpinion : c.ownDeptHeadHasOpinion) ? (
                            <span className="flex items-center gap-0.5 text-green-600 text-xs">
                              <CheckCircle2 className="w-3.5 h-3.5" /> 입력완료
                            </span>
                          ) : (
                            <span className="flex items-center gap-0.5 text-orange-500 text-xs">
                              <AlertTriangle className="w-3.5 h-3.5" /> 미입력
                            </span>
                          )}
                        </button>
                      )}
                    </td>

                    {/* 추천여부: HR_TEAM/ADMIN은 드롭다운, 나머지는 읽기 전용 */}
                    <td className="border px-2 py-1.5">
                      {isHROrAdmin && c.reviewId ? (
                        <div className="flex flex-col gap-0.5">
                          <select
                            value={
                              c.recommendationStatus === "추천" ? "true" :
                              c.recommendationStatus === "제외" ? "false" :
                              c.recommendationStatus === "의견없음" ? "none" : ""
                            }
                            onChange={(e) => handleRecommendationChange(c.reviewId!, e.target.value)}
                            className={`w-full text-xs rounded border px-1 py-0.5 focus:outline-none ${
                              c.recommendationStatus === "추천"
                                ? "border-green-400 text-green-700 bg-green-50"
                                : c.recommendationStatus === "제외"
                                ? "border-red-400 text-red-600 bg-red-50"
                                : c.recommendationStatus === "의견없음"
                                ? "border-gray-400 text-gray-500 bg-gray-50"
                                : "border-gray-300 text-gray-400 bg-white"
                            }`}
                          >
                            <option value="">-</option>
                            <option value="true">추천</option>
                            <option value="false">미추천</option>
                            <option value="none">의견없음</option>
                          </select>
                          {c.recommendationReason && (
                            <ReasonTooltip reason={c.recommendationReason}>
                              <span className="text-[10px] text-gray-400 truncate max-w-[90px] cursor-default">
                                사유: {c.recommendationReason}
                              </span>
                            </ReasonTooltip>
                          )}
                        </div>
                      ) : (() => {
                        // 타본부장이 타본부 직원 볼 때 → 본인 recommendation 표시
                        const recStatus = (isDeptHead && c.department !== currentDeptName)
                          ? c.currentUserRecommendation
                          : c.recommendationStatus;
                        const reason = (isDeptHead && c.department !== currentDeptName)
                          ? c.currentUserRecommendationReason
                          : c.recommendationReason;
                        if (recStatus === "추천") return (
                          <ReasonTooltip reason={reason}>
                            <span className="flex items-center justify-center gap-0.5 text-green-600 text-xs font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" /> 추천
                            </span>
                          </ReasonTooltip>
                        );
                        if (recStatus === "제외") return (
                          <ReasonTooltip reason={reason}>
                            <span className="flex items-center justify-center gap-0.5 text-red-500 text-xs font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" /> 미추천
                            </span>
                          </ReasonTooltip>
                        );
                        if (recStatus === "의견없음") return (
                          <span className="text-gray-500 text-xs">의견없음</span>
                        );
                        return <span className="text-gray-400 text-xs">-</span>;
                      })()}
                    </td>
                    {/* 비고 (DEPT_HEAD는 읽기 전용) */}
                    {showNoteColumn && (
                      <td className="border px-2 py-1.5 text-center">
                        {c.note?.noteText ? (
                          <div className="relative group inline-block">
                            <button
                              type="button"
                              className="text-base leading-none hover:opacity-70"
                              title={canEditNote ? "메모 보기/수정" : "메모 보기"}
                              onClick={() => setNoteModal({ candidateId: c.candidateId, candidateName: c.name, note: c.note ?? null })}
                            >
                              📝
                            </button>
                            {c.note?.noteText && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 hidden group-hover:block max-w-[240px] bg-gray-800 text-white text-xs rounded-md shadow-lg px-2 py-1.5 whitespace-pre-wrap pointer-events-none text-left">
                                {c.note.noteText.slice(0, 120)}{c.note.noteText.length > 120 ? "…" : ""}
                              </div>
                            )}
                          </div>
                        ) : canEditNote ? (
                          <button
                            type="button"
                            className="text-xs text-gray-400 hover:text-gray-600"
                            title="메모 추가"
                            onClick={() => setNoteModal({ candidateId: c.candidateId, candidateName: c.name, note: null })}
                          >
                            +
                          </button>
                        ) : (
                          <span className="text-gray-300 text-xs">-</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── 의견 입력 팝업 ──────────────────────────────────── */}
      {selectedReviewId && selectedCandidate && (
        <OpinionModal
          reviewId={selectedReviewId}
          onClose={() => { setSelectedReviewId(null); setSelectedCandidate(null); }}
          onSaved={handleOpinionSaved}
          onReset={isDeptHead ? () => setRefreshKey((k) => k + 1) : undefined}
          isSubmitted={
            isDeptHead && (
              currentPhase === 1
                ? isSubmitted // Phase 1: 1차 제출 여부로 잠금
                : selectedCandidate.department === currentDeptName
                  ? true // Phase 2 + 소속본부 직원: 1차 완료 → 항상 잠금
                  : isPhase2Submitted // Phase 2 + 타본부 직원: 2차 제출 여부로 잠금
            )
          }
          candidateInfo={selectedCandidate}
          impersonateDept={impersonateDept}
        />
      )}

      {/* ── AI 점수 상세 팝업 (심사 페이지) ─────────────────── */}
      {aiDetailTarget && (
        <Dialog open onOpenChange={(o) => { if (!o) { setAiDetailTarget(null); setAiReport(null); } }}>
          <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>AI 승진 적합도 — {aiDetailTarget.name}</DialogTitle>
              <DialogDescription>
                {aiDetailTarget.department} · {aiDetailTarget.team} · {aiDetailTarget.competencyLevel ?? aiDetailTarget.level ?? "-"}
              </DialogDescription>
            </DialogHeader>
            {aiDetailTarget.aiScore ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3 bg-gray-50 rounded-md px-3 py-2">
                  <span className={`text-2xl font-bold ${
                    aiDetailTarget.aiScore.grade === "S" ? "text-purple-600" :
                    aiDetailTarget.aiScore.grade === "A" ? "text-blue-600" :
                    aiDetailTarget.aiScore.grade === "B" ? "text-green-600" :
                    aiDetailTarget.aiScore.grade === "C" ? "text-orange-500" : "text-red-500"
                  }`}>{aiDetailTarget.aiScore.grade}</span>
                  <div>
                    <div className="font-semibold">{aiDetailTarget.aiScore.totalScore} / 100점</div>
                    <div className="text-xs text-gray-500">종합 적합도 점수</div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {[
                    { label: "성과 추세", score: aiDetailTarget.aiScore.trendScore, weight: "30%" },
                    { label: "포인트 초과율", score: aiDetailTarget.aiScore.pointsExcessScore, weight: "25%" },
                    { label: "학점 초과율", score: aiDetailTarget.aiScore.creditsExcessScore, weight: "20%" },
                    { label: "평가 안정성", score: aiDetailTarget.aiScore.stabilityScore, weight: "15%" },
                    { label: "체류 성숙도", score: aiDetailTarget.aiScore.maturityScore, weight: "10%" },
                  ].map(({ label, score, weight }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="w-24 text-xs text-gray-600 flex-shrink-0">{label}</span>
                      <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${score >= 70 ? "bg-green-500" : score >= 40 ? "bg-blue-400" : "bg-red-400"}`}
                          style={{ width: `${score}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono w-8 text-right">{score}</span>
                      <span className="text-[10px] text-gray-400 w-7">{weight}</span>
                    </div>
                  ))}
                </div>
                {aiDetailTarget.aiScore.details.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-xs text-blue-700">
                    {aiDetailTarget.aiScore.details.map((d, i) => (
                      <span key={i}>{i > 0 ? " · " : ""}{d}</span>
                    ))}
                  </div>
                )}
                {/* AI 리포트 */}
                <div className="border-t pt-3">
                  <Button
                    size="sm"
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs"
                    disabled={aiReportLoading}
                    onClick={() => handleGenerateAiReport(aiDetailTarget)}
                  >
                    {aiReportLoading ? "AI 분석 중..." : "🤖 AI 분석 리포트 생성"}
                  </Button>
                  {aiReport && (
                    <div className="mt-3 bg-purple-50 border border-purple-200 rounded-lg p-3 max-h-60 overflow-y-auto">
                      <p className="text-xs font-bold text-purple-800 mb-2">🤖 AI 심사 보조 리포트</p>
                      <div className="text-xs text-gray-700 whitespace-pre-wrap">{aiReport}</div>
                      <p className="text-[10px] text-gray-400 mt-2">
                        * AI 분석은 참고자료이며, 최종 판단은 심사위원이 결정합니다.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">점수 정보가 없습니다.</p>
            )}
            <DialogFooter className="flex-shrink-0">
              <Button variant="outline" size="sm" onClick={() => { setAiDetailTarget(null); setAiReport(null); }}>닫기</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 추천/미추천 사유 입력 팝업 (HR/ADMIN 테이블 드롭다운) ── */}
      {recReasonPopup && (
        <Dialog open onOpenChange={(o) => !o && handleRecReasonCancel()}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {recReasonPopup.targetValue === "true" ? "추천 사유 입력" : "미추천 사유 입력"}
              </DialogTitle>
              <DialogDescription>
                사유를 입력하고 확인을 누르면 저장됩니다.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2">
              <textarea
                className="w-full text-sm border rounded px-3 py-2 resize-none h-24 focus:outline-none focus:ring-1 focus:ring-blue-300"
                placeholder="사유를 입력하세요"
                value={recReasonPopup.reason}
                maxLength={500}
                onChange={(e) =>
                  setRecReasonPopup((prev) => prev ? { ...prev, reason: e.target.value } : null)
                }
                autoFocus
              />
              <div className="text-right text-xs text-gray-400 mt-0.5">
                {recReasonPopup.reason.length} / 500자
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleRecReasonCancel}>취소</Button>
              <Button onClick={handleRecReasonConfirm}>확인</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 비고 NoteModal ──────────────────────────────────── */}
      {noteModal && (
        <NoteModal
          candidateId={noteModal.candidateId}
          candidateName={noteModal.candidateName}
          initialNote={noteModal.note}
          readOnly={!canEditNote}
          onClose={() => setNoteModal(null)}
          onSaved={handleNoteSaved}
        />
      )}

      {/* ── 1차 최종 제출 확인 다이얼로그 ──────────────────── */}
      <Dialog open={confirmSubmitOpen} onOpenChange={(o) => !o && setConfirmSubmitOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>1차 심사 최종 제출</DialogTitle>
            <DialogDescription>
              <strong>{currentUser?.department}</strong> 본부의 {query.year}년 1차 심사 의견을
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

      {/* ── 2차 최종 제출 확인 다이얼로그 ──────────────────── */}
      <Dialog open={confirmPhase2SubmitOpen} onOpenChange={(o) => !o && setConfirmPhase2SubmitOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>2차 심사 최종 제출</DialogTitle>
            <DialogDescription>
              <strong>{currentUser?.department}</strong> 본부의 {query.year}년 2차 심사(타본부 교차심사) 의견을
              최종 제출하시겠습니까?
              <br />
              제출 후에는 타본부 의견 수정이 불가합니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPhase2SubmitOpen(false)} disabled={submitting}>
              취소
            </Button>
            <Button className="bg-orange-600 hover:bg-orange-700" onClick={handlePhase2Submit} disabled={submitting}>
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

      {/* ── Phase 전환 확인 다이얼로그 ─────────────────────── */}
      <Dialog open={confirmPhaseOpen} onOpenChange={(o) => !o && setConfirmPhaseOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {currentPhase === 1 ? "2차 심사 오픈" : "1차 심사로 되돌리기"}
            </DialogTitle>
            <DialogDescription>
              {currentPhase === 1 ? (
                <>
                  <strong>{query.year}년 심사를 2차 단계로 전환합니다.</strong>
                  <br />
                  이후 본부장은 타 본부 추천 직원에 대해서만 의견을 입력할 수 있습니다.
                </>
              ) : (
                <>
                  <strong>{query.year}년 심사를 1차 단계로 되돌립니다.</strong>
                  <br />
                  이후 본부장은 소속 본부 직원에 대해서만 의견을 입력할 수 있습니다.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPhaseOpen(false)} disabled={phaseChanging}>
              취소
            </Button>
            <Button
              onClick={() => handlePhaseChange(currentPhase === 1 ? 2 : 1)}
              disabled={phaseChanging}
              className={currentPhase === 1 ? "bg-orange-600 hover:bg-orange-700" : ""}
            >
              {phaseChanging ? "전환 중..." : currentPhase === 1 ? "2차 심사 오픈" : "1차로 되돌리기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
