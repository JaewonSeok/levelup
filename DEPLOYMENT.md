# Vercel + Supabase 배포 가이드

## 환경 변수 설정 (Vercel Dashboard → Settings → Environment Variables)

| 변수명 | 예시 / 설명 | 필수 |
|--------|-------------|------|
| `DATABASE_URL` | `postgresql://postgres.[ref]:[pwd]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1` | ✅ |
| `DIRECT_URL` | `postgresql://postgres.[ref]:[pwd]@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres` | ✅ |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` | ✅ |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` 로 생성 | ✅ |
| `ANTHROPIC_API_KEY` | Anthropic Console에서 발급 | ✅ (AI 기능) |

> **주의**: `DATABASE_URL`에 반드시 `?pgbouncer=true&connection_limit=1` 파라미터를 포함해야 합니다.
> PgBouncer(Transaction 모드)에서 세션 모드 명령(prepared statements 등)을 차단합니다.

## Prisma 설정 (schema.prisma)

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")   // 마이그레이션·introspect용 direct 연결
}
```

## Supabase 설정

1. **Connection Pooling** → Transaction mode 사용 (포트 6543)
2. **Row Level Security** → 앱은 NextAuth 세션 기반 RBAC 사용, RLS는 비활성화 권장
3. **Pool Size** → Default(15) 유지. `connection_limit=1` + `pgbouncer=true` 로 Prisma 측에서 제한

## Vercel 배포 설정

### vercel.json (선택 사항)
```json
{
  "functions": {
    "src/app/api/**": {
      "maxDuration": 30
    }
  }
}
```

> 엑셀 업로드·일괄 처리 API가 Vercel 기본 타임아웃(10초)을 초과할 수 있습니다.
> Pro 플랜에서는 `maxDuration: 60` 까지 가능합니다.

### 빌드 명령어
Vercel에서 자동 감지하지만 명시적으로 설정 시:
- **Build Command**: `npx prisma generate && npm run build`
- **Output Directory**: `.next`
- **Install Command**: `npm install`

## 파일 업로드 주의사항

Vercel 서버리스 환경에서 `public/` 디렉토리는 **읽기 전용**입니다.
현재 비고 파일 업로드(`/api/candidate-notes/upload`)는 `os.tmpdir()` 폴백으로 임시 저장하지만,
**서버리스 인스턴스가 재시작되면 파일이 소멸**됩니다.

### 권장: Supabase Storage 마이그레이션
```
src/app/api/candidate-notes/upload/route.ts
→ fs.writeFileSync() 대신 Supabase Storage SDK 사용
→ 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 추가
```

## 배포 전 체크리스트

- [ ] `DATABASE_URL`에 `pgbouncer=true&connection_limit=1` 포함 여부
- [ ] `DIRECT_URL`이 별도로 설정됨 (마이그레이션용)
- [ ] `NEXTAUTH_SECRET` 무작위 값 (32바이트 이상)
- [ ] `NEXTAUTH_URL`이 실제 배포 도메인과 일치
- [ ] `ANTHROPIC_API_KEY` 유효한 키 설정
- [ ] `npx prisma db push` 또는 마이그레이션 적용 완료
- [ ] Vercel 함수 타임아웃 설정 확인 (업로드 API: 30초 이상)
- [ ] 비고 파일 업로드가 임시 디렉토리 폴백으로 동작함을 인지 (장기: Storage 마이그레이션)

## 로컬 개발 → 프로덕션 차이점

| 항목 | 로컬 | Vercel |
|------|------|--------|
| DB 연결 | 직접 PostgreSQL | PgBouncer (Transaction mode) |
| 파일 쓰기 | `public/uploads/` 가능 | `os.tmpdir()` 만 가능 |
| 환경 변수 | `.env.local` | Vercel Dashboard |
| `prisma generate` | `npm run dev` 전 수동 실행 | 빌드 명령어에 포함 |
