"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  currentUser: {
    id: string;
    role: string;
    department: string;
  };
}

interface RowState {
  text: string;
  rec: "추천" | "미추천" | "";
  isDirty: boolean;
  saving: boolean;
  savedJustNow: boolean;
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
  onSaved: (reviewerRole: string, recommendation: boolean | null, reviewUpdated: boolean) => void;
  /** 제출 초기화 성공 시 호출 — 부모가 isSubmitted 상태를 false로 갱신 */
  onReset?: () => void;
  isSubmitted?: boolean;
  candidateInfo?: CandidateInfoForAI;
}

// ── Component ──────────────────────────────────────────────────

export function OpinionModal({
  reviewId,
  onClose,
  onSaved,
  onReset,
  isSubmitted = false,
  candidateInfo,
}: OpinionModalProps) {
  const [data, setData] = useState<OpinionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [aiReportLoading, setAiReportLoading] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  // 서버에서 받아온 개별 잠금 해제 여부 (Review.editUnlocked)
  const [editUnlocked, setEditUnlocked] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reviews/${reviewId}/opinions`)
      .then((res) => res.json())
      .then((json: OpinionData) => {
        setData(json);
        setEditUnlocked(json.review.editUnlocked ?? false);
        const initial: Record<string, RowState> = {};
        for (const r of json.reviewers) {
          initial[r.userId] = {
            text: r.opinionText ?? "",
            rec:
              r.recommendation === true
                ? "추천"
                : r.recommendation === false
                ? "미추천"
                : "",
            isDirty: false,
            saving: false,
            savedJustNow: false,
          };
        }
        setRowStates(initial);
      })
      .finally(() => setLoading(false));
  }, [reviewId]);

  const isAdmin = data?.currentUser.role === "SYSTEM_ADMIN";
  const isHRTeam = data?.currentUser.role === "HR_TEAM";
  // 본부장은 자기 의견 행만 표시 (HR_TEAM / CEO / SYSTEM_ADMIN은 전체 표시)
  const isDeptHead = data?.currentUser.role === "DEPT_HEAD";

  // 행 편집 가능 여부
  // isSubmitted=true(본부 제출됨)이더라도 editUnlocked=true면 편집 허용
  function getEditable(reviewer: Reviewer): boolean {
    if (isSubmitted && !editUnlocked) return false;
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
      const body: Record<string, unknown> = {
        opinionText: rs.text,
        recommendation:
          rs.rec === "추천" ? true : rs.rec === "미추천" ? false : null,
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

      // 성공/실패 모두 응답 본문을 먼저 읽는다
      const resData = await res.json();

      if (!res.ok) {
        throw new Error(resData.error ?? "저장 실패");
      }

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
        resData.reviewUpdated === true
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
      setRowStates((prev) => ({
        ...prev,
        [reviewer.userId]: { ...prev[reviewer.userId], saving: false },
      }));
    }
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
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error ?? "AI 분석 실패");
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
                  // 본부장은 자기 의견 행만 표시
                  if (isDeptHead && !reviewer.isCurrentUser) return null;

                  const isHR = reviewer.reviewerRole === "인사팀장";
                  const isOwn = reviewer.reviewerRole === "소속본부장";
                  const editable = getEditable(reviewer);
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
                            value={editable ? rs.text : (reviewer.opinionText ?? "")}
                            readOnly={!editable}
                            onChange={
                              editable
                                ? (e) => handleChange(reviewer.userId, "text", e.target.value)
                                : undefined
                            }
                            placeholder={editable ? "의견을 입력하세요." : "미입력"}
                            maxLength={editable ? 5000 : undefined}
                          />
                          {editable && (
                            <div className="text-right text-xs text-gray-400 mt-0.5">
                              {rs.text.length.toLocaleString()} / 5,000자
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
                                      : "border-gray-300 text-gray-400"
                                  }`}
                                  value={rs.rec}
                                  onChange={(e) =>
                                    handleChange(reviewer.userId, "rec", e.target.value)
                                  }
                                >
                                  <option value="">선택</option>
                                  <option value="추천">추천</option>
                                  <option value="미추천">미추천</option>
                                </select>

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
                                    : "저장"}
                                </Button>
                              </>
                            ) : (
                              /* 읽기 전용: 텍스트로만 표시 */
                              <span
                                className={`text-xs font-medium ${
                                  reviewer.recommendation === true
                                    ? "text-green-600"
                                    : reviewer.recommendation === false
                                    ? "text-red-500"
                                    : "text-gray-400"
                                }`}
                              >
                                {reviewer.recommendation === true
                                  ? "추천"
                                  : reviewer.recommendation === false
                                  ? "미추천"
                                  : "-"}
                              </span>
                            )}
                          </div>
                        )}

                        {/* 인사팀장 저장 영역 (admin만 표시) */}
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
              {/* 초기화 버튼: 본부 제출 상태이고 아직 잠금 해제되지 않은 경우 표시 */}
              {isSubmitted && !editUnlocked && onReset ? (
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
  );
}
