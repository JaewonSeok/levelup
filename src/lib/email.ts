/**
 * 이메일 발송 유틸 (nodemailer)
 * SMTP 설정이 없으면 콘솔 경고만 출력하고 오류 없이 종료.
 */
import nodemailer from "nodemailer";

/** [보안] HTML Injection 방지 — 사용자 입력값을 HTML 템플릿에 삽입 시 이스케이프 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });
}

export async function sendSubmissionEmail(data: {
  department: string;
  submittedByName: string;
  submittedAt: Date;
  year: number;
  stats: { total: number; recommended: number; notRecommended: number };
}) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn("[email] SMTP 미설정 — 이메일 발송 생략");
    return;
  }

  const recipients = ["jwseok@rsupport.com", "shyun@rsupport.com", "shjeong@rsupport.com"];
  const dateStr = data.submittedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  // [보안] HTML Injection 방지 — 사용자 제공 데이터 이스케이프 후 삽입
  const safeDept = escapeHtml(data.department);
  const safeName = escapeHtml(data.submittedByName);
  const safeYear = Number(data.year); // 숫자형이므로 이스케이프 불필요
  const safeTotal = Number(data.stats.total);
  const safeRecommended = Number(data.stats.recommended);
  const safeNotRecommended = Number(data.stats.notRecommended);

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? `"레벨업 HR" <${process.env.SMTP_USER}>`,
    to: recipients.join(", "),
    subject: `[레벨업] ${safeDept} 레벨업 심사 최종 제출`,
    html: `
      <h2 style="color:#1d4ed8;">레벨업 심사 최종 제출 알림</h2>
      <p>${safeName}이(가) ${safeDept}의 ${safeYear}년 레벨업 심사를 최종 제출했습니다.</p>
      <table style="border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280;">본부</td><td><strong>${safeDept}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280;">심사 연도</td><td><strong>${safeYear}년</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280;">제출자</td><td><strong>${safeName}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280;">제출 일시</td><td>${dateStr}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280;">대상자 수</td><td>${safeTotal}명 (추천 ${safeRecommended}명 / 미추천 ${safeNotRecommended}명)</td></tr>
      </table>
    `,
  });
}
