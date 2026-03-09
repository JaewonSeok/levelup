/**
 * 입력값 검증 유틸
 * [보안] new Date(userInput) 직접 호출 시 Invalid Date가 조용히 통과되는 문제 방지
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * YYYY-MM-DD 형식의 날짜 문자열을 안전하게 Date로 변환.
 * 형식이 올바르지 않거나 Invalid Date이면 null 반환.
 */
export function parseSafeDate(value: string): Date | null {
  if (!ISO_DATE_RE.test(value)) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}
