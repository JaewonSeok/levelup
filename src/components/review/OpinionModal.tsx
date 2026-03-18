"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────

interface Reviewer {
  userId: string;
  reviewerName: string;
  reviewerRole: string;
  isCurrentUser: boolean;
  opinionId: string | null;
  opinionText: string | null;
  recommendation: boolean | null;
  noOpinion: boolean;
  recommendationReason: string | null;
  savedAt: string | null;
  modifiedBy: string | null;
  modifiedAt: string | null;
}

interface OpinionData {
  review: { id: string; editUnlocked: boolean };
  candidate: {
    id: string;
    year: number;
    user: {
      name: string;
      department: string;
      team: string;
      level: string | null;
      competencyLevel: string | null;
    };
  };
  pointCumulative: number;
  creditCumulative: number;
  reviewers: Reviewer[];
  currentPhase: number;
  /** 본부장 화면 보기 프리뷰 모드일 때 API가 포함시키는 대상 본부명 */
  impersonatedDept?: string | null;
  currentUser: {
    id: string;
    role: string;
    department: string;
  };
}

interface RowState {
  text: string;
  rec: "추천" | "미추천" | "의견없음" | "";
  reason: string;
  isDirty: boolean;
  saving: boolean;
  savedJustNow: boolean;
}

interface ReasonPopupState {
  userId: string;
  targetRec: "추천" | "미추천";
  reason: string;
  prevRec: "추천" | "미추천" | "의견없음" | "";
}

interface AiScoreInfo {
  totalScore: number;
  grade: string;
  trendScore: number;
  pointsExcessScore: number;
  creditsExcessScore: number;
  stabilityScore: number;
  maturityScore: number;
  details: string[];
}

export interface CandidateInfoForAI {
  name: string;
  department: string;
  team: string;
  level: string | null;
  yearsOfService: number | null;
  promotionType?: string;
  grades: {
    2021: string | null;
    2022: string | null;
    2023: string | null;
    2024: string | null;
    2025: string | null;
  };
  pointCumulative: number;
  creditCumulative: number;
  aiScore?: AiScoreInfo;
  sameLevelAvgPoints?: number;
  sameLevelAvgCredits?: number;
  requiredPoints?: number | null;
  requiredCredits?: number | null;
  minTenure?: number;
}

interface OpinionModalProps {
  reviewId: string;
  onClose: () => void;
  /** 저장 성공 시 서버가 확정한 값 전달. reviewUpdated=true면 Review.recommendation도 업데이트됨 */
  onSaved: (reviewerRole: string, recommendation: boolean | null, reviewUpdated: boolean, noOpinion?: boolean) => void;
  /** 제출 초기화 성공 시 호출 — 부모가 isSubmitted 상태를 false로 갱신 */
  onReset?: () => void;
  isSubmitted?: boolean;
  candidateInfo?: CandidateInfoForAI;
  /** 본부장 화면 보기 프리뷰 모드 — 해당 본부 이름. null이면 일반 모드 */
  impersonateDept?: string | null;
}

// ── Component ──────────────────────────────────────────────────

export function OpinionModal({
  reviewId,
  onClose,
  onSaved,
  onReset,
  isSubmitted = false,
  candidateInfo,
  impersonateDept,
}: OpinionModalProps) {
  const [data, setData] = useState<OpinionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [reasonPopup, setReasonPopup] = useState<ReasonPopupState | null>(null);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [aiReportLoading, setAiReportLoading] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  // 서버에서 받아온 개별 잠금 해제 여부 (Review.editUnlocked)
  const [editUnlocked, setEditUnlocked] = useState(false);
  // 모달이 열렸을 때의 isSubmitted 스냅샷 — 부모 리렌더링(저장 후 refetch)으로
  // isSubmitted prop이 바뀌어도 모달 내 잠금 상태는 열린 시점 기준으로 유지
  const [submittedSnapshot] = useState(() => isSubmitted);

  useEffect(() => {
    setLoading(true);
    const opinionsUrl = impersonateDept
      ? `/api/reviews/${reviewId}/opinions?impersonate=${encodeURIComponent(impersonateDept)}`
      : `/api/reviews/${reviewId}/opinions`;
    fetch(opinionsUrl, { cache: "no-store" })
      .then((res) => res.json())
      .then((json: OpinionData) => {
        setData(json);
        setEditUnlocked(json.review.editUnlocked ?? false);
        const initial: Record<string, RowState> = {};
        for (const r of json.reviewers) {
          initial[r.userId] = {
            text: r.opinionText ?? "",
            rec: r.noOpinion
              ? "의견없음"
              : r.recommendation === true
              ? "추천"
              : r.recommendation === false
              ? "미추천"
              : "",
            reason: r.recommendationReason ?? "",
            isDirty: false,
            saving: false,
            savedJustNow: false,
          };
        }
        setRowStates(initial);
      })
      .finally(() => setLoading(false));
  }, [reviewId, impersonateDept]);

  const isAdmin = data?.currentUser.role === "SYSTEM_ADMIN";
  const isHRTeam = data?.currentUser.role === "HR_TEAM";
  // 본부장은 자기 의견 행만 표시 (HR_TEAM / CEO / SYSTEM_ADMIN은 전체 표시)
  const isDeptHead = data?.currentUser.role === "DEPT_HEAD";

  // 행 편집 가능 여부
  // submittedSnapshot: 모달이 열렸을 때의 isSubmitted 값 (부모 리렌더링 영향 차단)
  // editUnlocked=true면 제출 후에도 편집 허용 (초기화 버튼으로 해제)
  // 프리뷰 모드(impersonateDept)에서는 submitted 잠금을 적용하지 않음
  //   — isSubmitted prop이 isDeptHead && (...) 로 계산되는데, 프리뷰 시
  //     isDeptHead=true(effectiveRole)가 되어 잘못 잠길 수 있기 때문
  function getEditable(reviewer: Reviewer): boolean {
    if (!impersonateDept && submittedSnapshot && !editUnlocked) return false;
    // 인사팀장 행: SYSTEM_ADMIN 또는 HR_TEAM 본인만 편집 가능
    if (reviewer.reviewerRole === "인사팀장") {
      return reviewer.isCurrentUser && (!!isAdmin || !!isHRTeam);
    }
    return reviewer.isCurrentUser || !!isAdmin;
  }

  function handleChange(
    userId: string,
    field: "text" | "rec",
    value: string
  ) {
    setRowStates((prev) => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        [field]: value,
        isDirty: true,
        savedJustNow: false,
      },
    }));
  }

  async function handleSave(reviewer: Reviewer) {
    const rs = rowStates[reviewer.userId];
    if (!rs) return;

    setRowStates((prev) => ({
      ...prev,
      [reviewer.userId]: { ...prev[reviewer.userId], saving: true },
    }));

    try {
      const noOpinion = rs.rec === "의견없음";
      const body: Record<string, unknown> = {
        opinionText: rs.text,
        recommendation:
          rs.rec === "추천" ? true : rs.rec === "미추천" ? false : null,
        noOpinion,
        recommendationReason: noOpinion ? null : (rs.reason || null),
      };

      // admin이 타인 행을 저장할 때 reviewerId 전달
      if (isAdmin && !reviewer.isCurrentUser) {
        body.reviewerId = reviewer.userId;
      }

      const res = await fetch(`/api/reviews/${reviewId}/opinions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        let errMsg = "저장 실패";
        try { const e = await res.json(); errMsg = e.error ?? errMsg; } catch { /* non-JSON */ }
        throw new Error(errMsg);
      }
      const resData = await res.json();

      setRowStates((prev) => ({
        ...prev,
        [reviewer.userId]: {
          ...prev[reviewer.userId],
          saving: false,
          isDirty: false,
          savedJustNow: true,
        },
      }));

      // 2초 후 "저장됨" → "저장"
      setTimeout(() => {
        setRowStates((prev) => ({
          ...prev,
          [reviewer.userId]: {
            ...prev[reviewer.userId],
            savedJustNow: false,
          },
        }));
      }, 2000);

      // 서버가 확정한 값 + Review 업데이트 여부를 부모에게 전달
      onSaved(
        resData.reviewerRole ?? "",
        resData.recommendation ?? null,
        resData.reviewUpdated === true,
        resData.noOpinion === true
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
      setRowStates((prev) => ({
        ...prev,
        [reviewer.userId]: { ...prev[reviewer.userId], saving: false },
      }));
    }
  }

  // 추천 드롭다운 변경 핸들러
  // 수정 3: SYSTEM_ADMIN만 사유 팝업, 본부장은 바로 반영
  function handleRecChange(reviewer: Reviewer, value: "추천" | "미추천" | "의견없음" | "") {
    if ((value === "추천" || value === "미추천") && isAdmin) {
      // SYSTEM_ADMIN: 사유 팝업 표시
      const currentRec = rowStates[reviewer.userId]?.rec ?? "";
      const currentReason = rowStates[reviewer.userId]?.reason ?? "";
      setReasonPopup({
        userId: reviewer.userId,
        targetRec: value,
        reason: currentReason,
        prevRec: currentRec,
      });
    } else {
      // 비어드민(DEPT_HEAD) 또는 의견없음/"" — 팝업 없이 바로 반영
      setRowStates((prev) => ({
        ...prev,
        [reviewer.userId]: {
          ...prev[reviewer.userId],
          rec: value,
          // 비어드민은 기존 reason 유지 (이미 저장된 사유가 있으면 보존)
          reason: (value === "추천" || value === "미추천")
            ? (prev[reviewer.userId]?.reason ?? "")
            : "",
          isDirty: true,
          savedJustNow: false,
        },
      }));
    }
  }

  function handleReasonConfirm() {
    if (!reasonPopup) return;
    setRowStates((prev) => ({
      ...prev,
      [reasonPopup.userId]: {
        ...prev[reasonPopup.userId],
        rec: reasonPopup.targetRec,
        reason: reasonPopup.reason,
        isDirty: true,
        savedJustNow: false,
      },
    }));
    setReasonPopup(null);
  }

  function handleReasonCancel() {
    setReasonPopup(null);
    // rowStates는 변경하지 않음 — prevRec 값이 그대로 유지됨
  }

  async function handleGenerateAiReport() {
    if (!candidateInfo) return;
    setAiReportLoading(true);
    setAiReport(null);
    try {
      const res = await fetch("/api/ai-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeData: {
            name: candidateInfo.name,
            department: candidateInfo.department,
            team: candidateInfo.team,
            level: candidateInfo.level,
            yearsOfService: candidateInfo.yearsOfService,
            promotionType: candidateInfo.promotionType,
            grades: candidateInfo.grades,
            finalPoints: candidateInfo.pointCumulative,
            pointCumulative: candidateInfo.pointCumulative,
            requiredPoints: candidateInfo.requiredPoints,
            creditScore: candidateInfo.creditCumulative,
            creditCumulative: candidateInfo.creditCumulative,
            requiredCredits: candidateInfo.requiredCredits,
            minTenure: candidateInfo.minTenure,
            aiScore: candidateInfo.aiScore,
            sameLevelAvgPoints: candidateInfo.sameLevelAvgPoints,
            sameLevelAvgCredits: candidateInfo.sameLevelAvgCredits,
          },
        }),
      });
      if (!res.ok) {
        let errMsg = "AI 분석 실패";
        try { const e = await res.json(); errMsg = e.error ?? errMsg; } catch { /* non-JSON */ }
        throw new Error(errMsg);
      }
      const resData = await res.json();
      setAiReport(resData.report);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI 분석 중 오류가 발생했습니다.");
    } finally {
      setAiReportLoading(false);
    }
  }

  async function handleReset() {
    if (!data) return;
    setResetLoading(true);
    try {
      const res = await fetch(`/api/reviews/${data.review.id}/reset`, {
        method: "PUT",
      });
      if (!res.ok) {
        const resData = await res.json();
        throw new Error(resData.error ?? "초기화 실패");
      }
      setEditUnlocked(true);
      toast.success("의견 수정이 활성화되었습니다. 기존 내용을 수정한 후 저장해 주세요.");
      setResetConfirmOpen(false);
      onReset?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "초기화 중 오류가 발생했습니다.");
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <>
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>심사 의견 입력</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-muted-foreground">
            불러오는 중...
          </div>
        ) : !data ? (
          <div className="py-10 text-center text-muted-foreground">
            데이터를 불러올 수 없습니다.
          </div>
        ) : (
          <>
            {/* ── 대상자 요약 ─────────────────────────────────── */}
            <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-sm flex-shrink-0">
              <div className="flex flex-wrap gap-x-6 gap-y-0.5">
                <span className="font-semibold text-blue-700">소속/성명</span>
                <span className="text-gray-700">
                  {data.candidate.user.department} · {data.candidate.user.team} · <strong>{data.candidate.user.name}</strong>
                </span>
                <span className="font-semibold text-blue-700">역량레벨</span>
                <span className="text-gray-700">{data.candidate.user.competencyLevel ?? data.candidate.user.level ?? "-"}</span>
                <span className="font-semibold text-blue-700">포인트</span>
                <span className="text-gray-700">{data.pointCumulative.toFixed(1)}</span>
                <span className="font-semibold text-blue-700">학점</span>
                <span className="text-gray-700">{data.creditCumulative.toFixed(1)}</span>
              </div>
            </div>

            {/* ── AI 분석 리포트 ──────────────────────────────── */}
            {candidateInfo && (
              <div className="flex-shrink-0 mt-2">
                <Button
                  size="sm"
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs h-7"
                  disabled={aiReportLoading}
                  onClick={handleGenerateAiReport}
                >
                  {aiReportLoading ? "AI 분석 중..." : "🤖 AI 분석 리포트 생성"}
                </Button>
                {aiReport && (
                  <div className="mt-2 bg-purple-50 border border-purple-200 rounded-lg p-3 max-h-40 overflow-y-auto">
                    <p className="text-xs font-bold text-purple-800 mb-1.5">🤖 AI 심사 보조 리포트</p>
                    <div className="text-xs text-gray-700 whitespace-pre-wrap">{aiReport}</div>
                    <p className="text-[10px] text-gray-400 mt-2">
                      * AI 분석은 참고자료이며, 최종 판단은 심사위원이 결정합니다.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── 본부장 의견 행 ──────────────────────────────── */}
            <div className="flex-1 overflow-y-auto min-h-0 mt-3">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                본부장 의견
              </h3>
              <div className="space-y-2">
                {data.reviewers.map((reviewer) => {
                  // DEPT_HEAD: 본인 행만 렌더링 (API도 동일하게 필터링하나 이중 보장)
                  if (isDeptHead && !reviewer.isCurrentUser) return null;
                  // 프리뷰 모드: API 응답의 impersonatedDept 사용 (prop 의존 제거, 가장 확실한 방법)
                  // 인사팀장 행은 프리뷰 모드에서 보안상 숨김 (API도 동일 필터 적용)
                  const previewDept = data.impersonatedDept?.trim();
                  if (previewDept) {
                    const isOwnDeptHead = reviewer.reviewerRole === "소속본부장";
                    const isThisHead = reviewer.reviewerName.trim() === `${previewDept}장`;
                    if (!isThisHead && !isOwnDeptHead) return null;
                  }

                  // L0/L1/L2: 소속본부장 + 인사팀장 외 타본부장 행 숨김 (데이터는 유지, 표시만 제한)
                  const candidateLevel = data.candidate.user.competencyLevel ?? data.candidate.user.level ?? "";
                  const isLowLevel = ["L0", "L1", "L2"].includes(candidateLevel);
                  if (isLowLevel && reviewer.reviewerRole !== "소속본부장" && reviewer.reviewerRole !== "인사팀장") return null;

                  const isHR = reviewer.reviewerRole === "인사팀장";
                  const isOwn = reviewer.reviewerRole === "소속본부장";
                  // 프리뷰 모드에서 소속본부장 행은 항상 읽기전용
                  const editable = (previewDept && isOwn) ? false : getEditable(reviewer);
                  const rs: RowState = rowStates[reviewer.userId] ?? {
                    text: reviewer.opinionText ?? "",
                    rec:
                      reviewer.recommendation === true
                        ? "추천"
                        : reviewer.recommendation === false
                        ? "미추천"
                        : "",
                    isDirty: false,
                    saving: false,
                    savedJustNow: false,
                  };

                  return (
                    <div
                      key={reviewer.userId}
                      className={`border rounded-md p-3 ${
                        isOwn
                          ? "bg-blue-50 border-blue-300"
                          : isHR
                          ? "bg-amber-50 border-amber-200"
                          : "bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* 검토자 이름 */}
                        <div className="w-28 flex-shrink-0 pt-1">
                          <p
                            className={`text-xs font-semibold ${
                              isOwn
                                ? "text-blue-700"
                                : isHR
                                ? "text-amber-700"
                                : "text-gray-600"
                            }`}
                          >
                            {reviewer.reviewerName}
                          </p>
                          {isOwn && (
                            <p className="text-xs text-blue-500">(소속)</p>
                          )}
                          {isHR && (
                            <p className="text-xs text-amber-600">(추가보고용)</p>
                          )}
                          {reviewer.modifiedBy && (
                            <p className="text-xs text-purple-600 font-medium mt-0.5">
                              (관리자 수정)
                            </p>
                          )}
                        </div>

                        {/* 의견 입력 영역 — editable: 편집 가능 textarea / 아닐 때: readonly textarea */}
                        <div className="flex-1">
                          <textarea
                            className={`w-full text-xs border rounded px-2 py-1.5 resize-none min-h-[150px] focus:outline-none ${
                              editable
                                ? "focus:ring-1 focus:ring-blue-300 bg-white"
                                : `cursor-default text-gray-600 ${isHR ? "bg-gray-100" : "bg-gray-50"}`
                            }`}
                            value={rs.text}
                            readOnly={!editable}
                            onChange={
                              editable
                                ? (e) => handleChange(reviewer.userId, "text", e.target.value)
                                : undefined
                            }
                            placeholder={editable ? "의견을 입력하세요." : (rs.text ? "" : "미입력")}
                            maxLength={editable ? 3000 : undefined}
                          />
                          {editable && (
                            <div className="text-right text-xs text-gray-400 mt-0.5">
                              {rs.text.length.toLocaleString()} / 3,000자
                            </div>
                          )}
                        </div>

                        {/* 추천여부 + 저장 (HR 제외) */}
                        {!isHR && (
                          <div className="flex flex-col items-end gap-1.5 w-24 flex-shrink-0">
                            {editable ? (
                              <>
                                {/* 추천여부 드롭다운 */}
                                <select
                                  className={`w-full h-7 text-xs rounded border px-1 bg-white focus:outline-none focus:ring-1 ${
                                    rs.rec === "추천"
                                      ? "border-green-400 text-green-700 focus:ring-green-300"
                                      : rs.rec === "미추천"
                                      ? "border-red-400 text-red-600 focus:ring-red-300"
                                      : rs.rec === "의견없음"
                                      ? "border-gray-400 text-gray-500 focus:ring-gray-300"
                                      : "border-gray-300 text-gray-400"
                                  }`}
                                  value={rs.rec}
                                  onChange={(e) =>
                                    handleRecChange(reviewer, e.target.value as "추천" | "미추천" | "의견없음" | "")
                                  }
                                >
                                  <option value="">선택</option>
                                  <option value="추천">추천</option>
                                  <option value="미추천">미추천</option>
                                  {/* 타본부장 전용: 의견없음 */}
                                  {!isOwn && <option value="의견없음">의견없음</option>}
                                </select>
                                {/* 사유 표시 */}
                                {(rs.rec === "추천" || rs.rec === "미추천") && rs.reason && (
                                  <div className="text-[10px] text-gray-500 mt-0.5 truncate w-full" title={rs.reason}>
                                    사유: {rs.reason}
                                  </div>
                                )}

                                {/* 저장 버튼 */}
                                <Button
                                  size="sm"
                                  className={`h-6 text-xs px-2 w-full transition-colors ${
                                    rs.savedJustNow
                                      ? "bg-green-600 hover:bg-green-700 text-white border-0"
                                      : rs.isDirty
                                      ? "bg-blue-600 hover:bg-blue-700 text-white border-0"
                                      : ""
                                  }`}
                                  variant={
                                    rs.savedJustNow || rs.isDirty
                                      ? "default"
                                      : "outline"
                                  }
                                  disabled={rs.saving}
                                  onClick={() => handleSave(reviewer)}
                                >
                                  {rs.saving
                                    ? "..."
                                    : rs.savedJustNow
                                    ? "저장됨"
                                    : reviewer.opinionId
                                    ? "수정"
                                    : "저장"}
                                </Button>
                              </>
                            ) : (
                              /* 읽기 전용: rs.rec 기반으로 표시 (저장 후 모달 내에서도 최신값 반영) */
                              <div className="flex flex-col items-end gap-0.5">
                                <span
                                  className={`text-xs font-medium ${
                                    rs.rec === "추천"
                                      ? "text-green-600"
                                      : rs.rec === "미추천"
                                      ? "text-red-500"
                                      : rs.rec === "의견없음"
                                      ? "text-gray-500"
                                      : "text-gray-400"
                                  }`}
                                >
                                  {rs.rec === "추천" ? "추천"
                                    : rs.rec === "미추천" ? "미추천"
                                    : rs.rec === "의견없음" ? "의견없음"
                                    : "-"}
                                </span>
                                {rs.reason && (rs.rec === "추천" || rs.rec === "미추천") && (
                                  <div className="relative group">
                                    <span className="text-[10px] text-gray-400 cursor-default">ℹ️ 사유</span>
                                    <div className="absolute bottom-full right-0 mb-1 z-50 hidden group-hover:block max-w-[300px] min-w-[120px] bg-gray-800 text-white text-xs rounded-md shadow-lg px-2 py-1.5 whitespace-pre-wrap">
                                      {rs.reason}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 인사팀장 저장 영역 (admin/HR_TEAM만 표시) */}
                        {isHR && editable && (
                          <div className="flex flex-col items-end gap-1.5 w-20 flex-shrink-0">
                            <Button
                              size="sm"
                              className={`h-6 text-xs px-2 w-full transition-colors ${
                                rs.savedJustNow
                                  ? "bg-green-600 hover:bg-green-700 text-white border-0"
                                  : rs.isDirty
                                  ? "bg-blue-600 hover:bg-blue-700 text-white border-0"
                                  : ""
                              }`}
                              variant={
                                rs.savedJustNow || rs.isDirty ? "default" : "outline"
                              }
                              disabled={rs.saving}
                              onClick={() => handleSave(reviewer)}
                            >
                              {rs.saving
                                ? "..."
                                : rs.savedJustNow
                                ? "저장됨"
                                : reviewer.opinionId
                                ? "수정"
                                : "저장"}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between flex-shrink-0 pt-2 border-t mt-2">
              {/* 초기화 버튼: 모달 열릴 때 제출 상태였고 아직 잠금 해제되지 않은 경우 표시 */}
              {submittedSnapshot && !editUnlocked && onReset ? (
                resetConfirmOpen ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-red-600">심사 의견을 초기화하시겠습니까?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleReset}
                      disabled={resetLoading}
                    >
                      {resetLoading ? "처리 중..." : "확인"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setResetConfirmOpen(false)}
                      disabled={resetLoading}
                    >
                      취소
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 border-red-300 hover:bg-red-50"
                    onClick={() => setResetConfirmOpen(true)}
                  >
                    초기화
                  </Button>
                )
              ) : (
                <span />
              )}
              <Button variant="outline" onClick={onClose}>
                닫기
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>

    {/* ── 추천/미추천 사유 입력 팝업 ── */}
    {reasonPopup && (
      <Dialog open onOpenChange={(o) => !o && handleReasonCancel()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {reasonPopup.targetRec === "추천" ? "추천 사유 입력" : "미추천 사유 입력"}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            <textarea
              className="w-full text-sm border rounded px-3 py-2 resize-none h-24 focus:outline-none focus:ring-1 focus:ring-blue-300"
              placeholder="사유를 입력하세요"
              value={reasonPopup.reason}
              maxLength={500}
              onChange={(e) =>
                setReasonPopup((prev) => prev ? { ...prev, reason: e.target.value } : null)
              }
              autoFocus
            />
            <div className="text-right text-xs text-gray-400 mt-0.5">
              {reasonPopup.reason.length} / 500자
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" size="sm" onClick={handleReasonCancel}>취소</Button>
            <Button size="sm" onClick={handleReasonConfirm}>확인</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}
