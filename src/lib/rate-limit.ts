/**
 * [KISA2021-33] 인증시도 제한 — 인메모리 Rate Limiter
 * 로그인 브루트포스 방지: 15분 내 5회 실패 시 30분 잠금
 *
 * ⚠️  서버 재시작 시 카운터가 초기화됩니다.
 *     프로덕션 다중 인스턴스 환경에서는 Redis 기반 구현으로 교체하세요.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15분
const LOCKOUT_MS = 30 * 60 * 1000; // 30분

interface AttemptRecord {
  count: number;
  firstAttempt: number;
  lockedUntil?: number;
}

const store = new Map<string, AttemptRecord>();

/**
 * 요청 허용 여부를 확인하고 시도 횟수를 증가시킵니다.
 * @param key  rate limit 식별 키 (예: `login:user@email.com`)
 * @returns    { allowed: true } 또는 { allowed: false, remainingMs: number }
 */
export function checkRateLimit(
  key: string
): { allowed: true } | { allowed: false; remainingMs: number } {
  const now = Date.now();
  const record = store.get(key);

  // 잠금 상태 확인
  if (record?.lockedUntil && now < record.lockedUntil) {
    return { allowed: false, remainingMs: record.lockedUntil - now };
  }

  // 윈도우 초과 또는 첫 시도: 카운터 리셋
  if (!record || now - record.firstAttempt > WINDOW_MS) {
    store.set(key, { count: 1, firstAttempt: now });
    return { allowed: true };
  }

  // 최대 시도 횟수 초과: 잠금 설정
  if (record.count >= MAX_ATTEMPTS) {
    const lockedUntil = now + LOCKOUT_MS;
    store.set(key, { ...record, lockedUntil });
    return { allowed: false, remainingMs: LOCKOUT_MS };
  }

  store.set(key, { ...record, count: record.count + 1 });
  return { allowed: true };
}

/**
 * 로그인 성공 후 시도 횟수를 초기화합니다.
 */
export function resetRateLimit(key: string): void {
  store.delete(key);
}
