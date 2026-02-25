"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import styles from "./login.module.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [focusedField, setFocusedField] = useState<string | null>(null);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email) { setError("이메일을 입력하세요."); return; }
    if (!password) { setError("비밀번호를 입력하세요."); return; }
    setError("");
    setIsLoading(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError("이메일 또는 비밀번호가 올바르지 않습니다.");
        return;
      }
      window.location.href = "/level-management";
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      background: "#f8f9fb",
      overflow: "hidden",
    }}>
      {/* ── 좌측 브랜딩 패널 ───────────────────────────────── */}
      <div className={styles.left} style={{
        background: "linear-gradient(160deg, #0f172a 0%, #1e3a5f 40%, #1d4ed8 100%)",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "60px 70px",
        overflow: "hidden",
      }}>
        {/* Floating orbs */}
        <div style={{
          position: "absolute", top: "-10%", right: "-5%",
          width: 400, height: 400, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(59,130,246,0.25) 0%, transparent 70%)",
          animation: "float1 12s ease-in-out infinite",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: "5%", left: "-8%",
          width: 300, height: 300, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 70%)",
          animation: "float2 15s ease-in-out infinite",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", top: "40%", right: "20%",
          width: 150, height: 150, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(14,165,233,0.15) 0%, transparent 70%)",
          animation: "float3 10s ease-in-out infinite",
          pointerEvents: "none",
        }} />

        {/* Grid pattern */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
          pointerEvents: "none",
        }} />

        {/* Content */}
        <div style={{ position: "relative", zIndex: 2 }}>
          {/* Brand pill */}
          <div className={styles.brandPill}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
              <polyline points="16 7 22 7 22 13"/>
            </svg>
            <span style={{ color: "#93c5fd", fontSize: 13, fontWeight: 500, letterSpacing: "0.03em" }}>
              LevelUp HR
            </span>
          </div>

          {/* Title */}
          <h1 style={{
            fontSize: 52, fontWeight: 800, color: "#fff",
            lineHeight: 1.15, marginTop: 32,
            animation: "fadeUp 0.8s ease-out 0.5s both",
            letterSpacing: "-0.03em",
          }}>
            레벨업<br/>관리 시스템
          </h1>

          {/* Divider bar */}
          <div style={{
            width: 48, height: 3,
            background: "linear-gradient(90deg, #60a5fa, #818cf8)",
            borderRadius: 2, marginTop: 28, marginBottom: 28,
            transformOrigin: "left",
            animation: "slideRight 0.6s ease-out 0.8s both",
          }} />

          {/* Description */}
          <p style={{
            color: "rgba(191,209,237,0.8)", fontSize: 16, lineHeight: 1.7,
            maxWidth: 380, fontWeight: 400,
            animation: "fadeUp 0.8s ease-out 0.9s both",
          }}>
            포인트 · 학점 기반 승격 기준 관리부터<br/>
            대표이사 최종 확정까지, 원스톱으로.
          </p>

        </div>

        {/* Copyright */}
        <div style={{
          position: "absolute", bottom: 32, left: 70,
          color: "rgba(148,176,215,0.35)", fontSize: 12,
        }}>
          © 2026 LevelUp HR System
        </div>
      </div>

      {/* ── 우측 로그인 폼 ─────────────────────────────────── */}
      <div className={styles.right} style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px",
        background: "#f8f9fb",
        animation: "fadeIn 0.6s ease-out",
      }}>
        <div style={{
          width: "100%", maxWidth: 400,
          animation: "fadeUp 0.6s ease-out 0.2s both",
        }}>
          {/* Icon */}
          <div style={{
            width: 44, height: 44,
            background: "linear-gradient(135deg, #2563eb, #4f46e5)",
            borderRadius: 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 32,
            boxShadow: "0 4px 14px -3px rgba(37,99,235,0.3)",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
              <polyline points="16 7 22 7 22 13"/>
            </svg>
          </div>

          <h2 style={{ fontSize: 26, fontWeight: 700, color: "#111827", letterSpacing: "-0.02em", margin: 0 }}>
            로그인
          </h2>
          <p style={{ color: "#9ca3af", fontSize: 14.5, marginTop: 8, marginBottom: 36, fontWeight: 400 }}>
            계정 정보를 입력하여 시스템에 접속하세요.
          </p>

          {/* Error banner */}
          {error && (
            <div style={{
              padding: "12px 16px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 10,
              marginBottom: 20,
              display: "flex", alignItems: "center", gap: 10,
              animation: "fadeUp 0.3s ease-out",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              <span style={{ color: "#dc2626", fontSize: 13.5, fontWeight: 500 }}>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate>
            {/* Email */}
            <div style={{ marginBottom: 18 }}>
              <label style={{
                display: "block", fontSize: 13.5, fontWeight: 600,
                color: "#374151", marginBottom: 8,
              }}>
                이메일
              </label>
              <div style={{ position: "relative" }}>
                <div style={{
                  position: "absolute", left: 15, top: "50%", transform: "translateY(-50%)",
                  color: focusedField === "email" ? "#2563eb" : "#b0b5be",
                  transition: "color 0.25s",
                  display: "flex", pointerEvents: "none",
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2"/>
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                  </svg>
                </div>
                <input
                  className={`${styles.input}${error && !email ? ` ${styles.inputError}` : ""}`}
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={e => { setEmail(e.target.value); if (error) setError(""); }}
                  onFocus={() => setFocusedField("email")}
                  onBlur={() => setFocusedField(null)}
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password */}
            <div style={{ marginBottom: 28 }}>
              <label style={{
                display: "block", fontSize: 13.5, fontWeight: 600,
                color: "#374151", marginBottom: 8,
              }}>
                비밀번호
              </label>
              <div style={{ position: "relative" }}>
                <div style={{
                  position: "absolute", left: 15, top: "50%", transform: "translateY(-50%)",
                  color: focusedField === "password" ? "#2563eb" : "#b0b5be",
                  transition: "color 0.25s",
                  display: "flex", pointerEvents: "none",
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </div>
                <input
                  className={`${styles.input}${error && !password ? ` ${styles.inputError}` : ""}`}
                  type={showPassword ? "text" : "password"}
                  placeholder="비밀번호를 입력하세요"
                  value={password}
                  onChange={e => { setPassword(e.target.value); if (error) setError(""); }}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  autoComplete="current-password"
                  style={{ paddingRight: 48 }}
                />
                <button
                  type="button"
                  className={styles.toggle}
                  onClick={() => setShowPassword(v => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button type="submit" className={styles.btn} disabled={isLoading}>
              {isLoading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "spin 0.8s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  로그인 중...
                </span>
              ) : "로그인"}
            </button>
          </form>

          {/* Forgot password */}
          <div style={{ textAlign: "center", marginTop: 24 }}>
            <button type="button" className={styles.forgot}>
              비밀번호를 잊으셨나요?
            </button>
          </div>

          {/* Footer */}
          <div style={{
            marginTop: 48, paddingTop: 24,
            borderTop: "1px solid #e5e7eb",
            textAlign: "center",
          }}>
            <p style={{ color: "#b0b5be", fontSize: 12.5 }}>
              계정 문의는 인사팀 관리자에게 연락하세요.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
