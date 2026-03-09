# Staging 환경 구축 가이드

정보보안팀 검수를 위한 Staging 환경 설정 및 운영 절차입니다.

---

## 목적

- 운영 환경의 **실제 직원 데이터**(평가등급, 교육점수 등)를 정보보안팀에 노출하지 않음
- 가명처리된 더미 데이터 150명으로 구성된 **완전히 분리된 DB** 사용
- 전체 기능(업로드, 포인트/학점 관리, 대상자 선정, 심사, 확정)을 검수 가능

---

## 사전 준비

### 1. 스테이징 DB 생성

Supabase에서 **운영과 별도 프로젝트**를 생성합니다.

> ⚠️ 운영 프로젝트와 반드시 다른 프로젝트여야 합니다.

1. https://supabase.com → New Project
2. 프로젝트명: `levelup-staging` (또는 유사명)
3. Settings > Database > Connection string에서 `DATABASE_URL`, `DIRECT_URL` 복사

### 2. `.env.staging` 파일 설정

```bash
# 프로젝트 루트에서 실행
cp .env.staging .env.staging.bak   # 백업 (선택)
```

`.env.staging` 파일의 플레이스홀더를 실제 스테이징 값으로 교체:

```env
DATABASE_URL="postgresql://postgres.[STAGING-REF]:[PW]@...pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[STAGING-REF]:[PW]@...pooler.supabase.com:5432/postgres"
NEXTAUTH_URL="https://levelup-2026-staging.vercel.app"
NEXTAUTH_SECRET="<openssl rand -base64 32 으로 새로 생성>"
NEXT_PUBLIC_APP_ENV="staging"
```

### 3. DB 스키마 적용

```bash
# 스테이징 DB에 스키마 적용 (환경 변수 임시 오버라이드)
DATABASE_URL="<스테이징 DIRECT_URL>" npx prisma db push
```

또는 `DIRECT_URL`을 `.env.staging`에 설정한 후:

```bash
# dotenv-cli 사용 시
npx dotenv -e .env.staging -- npx prisma db push
```

---

## 더미 데이터 시드

### 실행

```bash
# 방법 A: npm 스크립트
npm run db:seed:staging

# 방법 B: tsx 직접 실행
npx tsx scripts/seed-staging.ts

# 방법 C: ts-node 직접 실행
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-staging.ts
```

> 스크립트가 자동으로 `.env.staging`을 로드합니다.
> 실행 전 출력되는 `DATABASE_URL` 앞 50자를 확인하여 스테이징 DB인지 검증하세요.

### 시드 내용

| 항목 | 내용 |
|------|------|
| 더미 직원 | 150명 (가상 이름·부서·팀) |
| 레벨 분포 | L0(5) · L1(40) · L2(55) · L3(32) · L4(13) · L5(5) |
| 부서 | A사업본부, B사업본부, C사업본부, 경영지원본부, 기술연구본부, 고객성공본부 |
| 평가등급 | 2021~2025년, 실제 분포(S~C / S~U)와 유사한 비율로 랜덤 생성 |
| 포인트/학점 | 등급 기반 자동 계산 |
| 검수 계정 | 4개 (아래 참고) |

### 더미 데이터 재생성

```bash
# 기존 스테이징 데이터 전체 삭제 후 재생성
npm run db:seed:staging
```

> 스크립트 실행 시 스테이징 DB의 **모든 데이터**를 삭제 후 재삽입합니다.

---

## 검수 계정

| 역할 | 이메일 | 비밀번호 | 접근 범위 |
|------|--------|----------|-----------|
| 관리자 (SYSTEM_ADMIN) | `admin@staging.levelup.local` | `Security@Review2026` | 전체 기능 |
| 인사팀 (HR_TEAM) | `hr@staging.levelup.local` | `Security@Review2026` | 포인트/학점/대상자 관리 |
| 본부장 (DEPT_HEAD) | `manager@staging.levelup.local` | `Security@Review2026` | 심사 의견 입력 |
| 일반직원 (TEAM_MEMBER) | `user@staging.levelup.local` | `Security@Review2026` | 본인 정보 조회만 |

> 더미 직원 150명(`test.user001~150@staging.levelup.local`)은 비밀번호가 없어 직접 로그인 불가합니다.

---

## Vercel 배포 (Staging 환경)

### 방법 A: 별도 Vercel 프로젝트 (권장)

1. Vercel 대시보드 → **Add New Project**
2. 동일 GitHub 레포지토리 선택
3. Project Name: `levelup-2026-staging`
4. **Environment Variables** 탭에서 `.env.staging` 값들을 모두 입력:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `NEXTAUTH_URL` → `https://levelup-2026-staging.vercel.app`
   - `NEXTAUTH_SECRET` → 새로 생성한 값
   - `NEXT_PUBLIC_APP_ENV` → `staging`
5. **Production Branch**: `staging` 브랜치 (또는 `main`에서 분기)

### 방법 B: Vercel Preview 배포

`staging` 브랜치를 push하면 자동으로 Preview URL이 생성됩니다.
Vercel 대시보드 → Settings → Environment Variables → **Preview** 환경에만 스테이징 값 설정.

---

## 운영 환경과의 차이점

| 항목 | 운영 (Production) | 스테이징 (Staging) |
|------|-------------------|--------------------|
| DB | 운영 Supabase 프로젝트 | 별도 Supabase 프로젝트 |
| 데이터 | 실제 직원 정보 | 가상 더미 데이터 150명 |
| 로그인 계정 | 실제 임직원 계정 | 4개 검수 계정만 |
| 이메일 발송 | 활성화 | 비활성화 권장 |
| 상단 배너 | 없음 | "검수용 환경" 경고 배너 표시 |
| AI 리포트 | ANTHROPIC_API_KEY 필요 | 선택 사항 |

---

## 로컬 개발에서 스테이징 환경 확인

```bash
# .env.local에 스테이징 설정을 복사 (로컬 테스트용)
cp .env.staging .env.local
# .env.local의 NEXTAUTH_URL을 http://localhost:3000 으로 수정 후

npm run dev
# → 상단에 "검수용 환경" 배너가 표시됨
```

---

## 검수 완료 후 환경 폐기

1. **Vercel 스테이징 프로젝트 삭제** (Vercel 대시보드 → Settings → Delete Project)
2. **Supabase 스테이징 프로젝트 삭제** (Supabase 대시보드 → Settings → Delete Project)
3. **로컬 파일 정리**:
   ```bash
   rm .env.staging
   ```
4. `.env.staging`이 Git에 커밋되지 않았는지 최종 확인:
   ```bash
   git log --all --full-history -- .env.staging
   # 결과가 없어야 정상
   ```

---

## 보안 체크리스트

검수 전 최종 확인:

- [ ] 스테이징 DB에 실제 직원 데이터 없음 (`test.user*` 이메일만 존재)
- [ ] 스테이징 `DATABASE_URL`이 운영 DB와 다른 host 사용
- [ ] `.env.staging`이 `.gitignore`에 등록되어 Git에 없음
- [ ] 4개 검수 계정으로 로그인 및 주요 기능 동작 확인
- [ ] 화면 상단에 "검수용 환경" 경고 배너 표시 확인
- [ ] 더미 직원 이름/이메일이 실제 임직원과 무관한 가상 데이터임 확인
- [ ] 스테이징에서 SMTP 메일 발송이 비활성화되어 있음 확인
