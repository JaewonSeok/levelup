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

export async function sendPhase2CompletionEmail(data: {
  year: number;
  submissions: { department: string; submittedAt: Date }[];
}) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn("[email] SMTP 미설정 — Phase 2 완료 이메일 발송 생략");
    return;
  }

  const recipients = ["jwseok@rsupport.com", "shyun@rsupport.com", "shjeong@rsupport.com"];
  const safeYear = Number(data.year);
  const systemUrl = "https://levelup-2026.vercel.app/review";

  const rows = data.submissions
    .map((s) => {
      const safeDept = escapeHtml(s.department);
      const dateStr = s.submittedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
      return `<tr>
        <td style="padding:5px 16px 5px 0;color:#374151;">${safeDept}</td>
        <td style="padding:5px 0;color:#6b7280;">${dateStr}</td>
      </tr>`;
    })
    .join("");

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? `"레벨업 HR" <${process.env.SMTP_USER}>`,
    to: recipients.join(", "),
    subject: `[레벨업 관리 시스템] ${safeYear}년 2차 심사가 완료되었습니다`,
    html: `
      <h2 style="color:#ea580c;">2차 레벨업 심사 완료 알림</h2>
      <p>모든 본부장의 <strong>${safeYear}년 2차 심사 제출</strong>이 완료되었습니다.</p>
      <h3 style="color:#374151;font-size:14px;margin-top:20px;">본부별 제출 완료 일시</h3>
      <table style="border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:5px 16px 5px 0;color:#6b7280;font-weight:normal;border-bottom:1px solid #e5e7eb;">본부</th>
            <th style="text-align:left;padding:5px 0;color:#6b7280;font-weight:normal;border-bottom:1px solid #e5e7eb;">제출 일시</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:20px;">
        <a href="${systemUrl}" style="display:inline-block;background:#ea580c;color:white;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:14px;">
          심사 페이지 바로가기
        </a>
      </p>
      <p style="color:#9ca3af;font-size:12px;margin-top:16px;">레벨업 관리 시스템 · ${systemUrl}</p>
    `,
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
