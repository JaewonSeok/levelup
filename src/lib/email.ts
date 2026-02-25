/**
 * 이메일 발송 유틸 (nodemailer)
 * SMTP 설정이 없으면 콘솔 경고만 출력하고 오류 없이 종료.
 */
import nodemailer from "nodemailer";

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
}) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn("[email] SMTP 미설정 — 이메일 발송 생략");
    return;
  }

  const recipients = ["jwseok@rsupport.com", "shyun@rsupport.com"];
  const dateStr = data.submittedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? `"레벨업 HR" <${process.env.SMTP_USER}>`,
    to: recipients.join(", "),
    subject: `[레벨업 심사] ${data.department} ${data.year}년 최종 제출 완료`,
    html: `
      <h2 style="color:#1d4ed8;">레벨업 심사 최종 제출 알림</h2>
      <table style="border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280;">본부</td><td><strong>${data.department}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280;">심사 연도</td><td><strong>${data.year}년</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280;">제출자</td><td><strong>${data.submittedByName}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280;">제출 시각</td><td>${dateStr}</td></tr>
      </table>
    `,
  });
}
