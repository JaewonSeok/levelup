/**
 * PgBouncer/Supabase 환경에서 커넥션 일시 포화 시 1회 재시도하는 유틸리티.
 * 'MaxClientsInSessionMode' 또는 'connection pool' 관련 에러에서만 재시도.
 */
const RETRYABLE_MESSAGES = [
  "MaxClientsInSessionMode",
  "connection pool",
  "Connection terminated",
  "too many clients",
  "ECONNRESET",
  "ECONNREFUSED",
];

function isRetryable(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return RETRYABLE_MESSAGES.some((pat) => msg.includes(pat));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 1,
  delayMs = 500
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries > 0 && isRetryable(error)) {
      console.warn(`[Prisma] 커넥션 재시도... (남은 횟수: ${retries})`);
      await new Promise((r) => setTimeout(r, delayMs));
      return withRetry(fn, retries - 1, delayMs);
    }
    throw error;
  }
}
