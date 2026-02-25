# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

사내 직원 레벨업(승진) 관리 시스템. 본부/팀별 엑셀 업로드로 직원 데이터 적재 → 포인트/학점 집계 → 대상자 선정 → 심사(본부장 의견·역량평가) → 대표이사 최종 확정의 전체 승진 프로세스를 3단계로 개발한다. 기존 CUBE 시스템의 레벨업관리 모듈을 참고한다.

## 기술 스택

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Next.js API Routes
- **DB**: PostgreSQL + Prisma ORM
- **엑셀 파싱**: SheetJS (`xlsx`)
- **인증**: NextAuth.js

## 개발 명령어

```bash
npm install
npm run dev          # 개발 서버 (localhost:3000)
npm run build        # 프로덕션 빌드
npm run lint         # ESLint
npm run lint:fix     # ESLint 자동 수정

npx prisma generate                        # Prisma 클라이언트 생성
npx prisma migrate dev --name <이름>       # 새 마이그레이션 생성 및 적용
npx prisma studio                          # DB GUI
npm run db:seed                            # 시드 데이터 삽입
```

## 핵심 도메인 용어

| 용어 | 정의 |
|------|------|
| 레벨 | 직급 (L1~L5). 레벨업 = 승진 |
| 포인트 | 연도별 업무 성과 점수. 상점/벌점 포함. **해당 레벨 체류 기간 발생분만 집계** |
| 학점 | 연도별 교육/자기개발 이수 점수. 2025년 기준 소급 적용 |
| 충족 | 상위 레벨 승격을 위한 포인트/학점 기준 달성 여부 |
| 역량레벨평가 | 상위 레벨의 역량 기준표를 대상자 기준으로 평가한 점수 |
| 본부장 의견 | L4/L5 승진 시 타본부장 포함 각 본부장의 추천/미추천 의견 |
| 확정 | 대표이사가 최종 승진 여부를 결정하는 단계 |

## 전체 프로세스 흐름

```
[Phase 1] 엑셀 업로드 (.xlsx) → 직원 데이터 적재
              ↓
         포인트/학점 관리 (인사팀 전용, 연도별 동적 컬럼)
              ↓
[Phase 2] 대상자 선정 (포인트/학점/포인트&학점 충족 필터)
              ↓
         인사팀 심사대상 체크 → 심사 명단 확정
              ↓
         본부장 역량평가 + 의견 입력 + 추천/미추천
              ↓
[Phase 3] 대표이사 최종 확정/보류
              ↓
         통계 대시보드 집계
```

## 권한 체계 (RBAC)

| 역할 | 접근 범위 |
|------|----------|
| 팀원 | 본인 레벨 정보만 조회 |
| 팀장 | 본인 + 소속 팀원 조회 |
| 실장/본부장 | 소속 실장·팀장·팀원 조회, 심사 의견 입력 및 추천/미추천 결정 |
| 인사팀 | 전체 포인트/학점 관리, 대상자 선정, 심사대상 체크, 기준 설정 |
| 대표이사 | 최종 확정/보류 결정, 전체 통계 조회 |

> 포인트/학점/대상자 관리 화면은 인사팀 전용(비공개).
> L4/L5 승진 시 타본부장 의견도 필수.

## 화면 목록 및 라우트 (예정)

| 화면 | 라우트 | 권한 |
|------|--------|------|
| 레벨 관리/조회 | `/employees` | 직책별 차등 |
| 레벨업 포인트 관리 | `/points` | 인사팀 |
| 레벨업 학점 관리 | `/credits` | 인사팀 |
| 레벨업 대상자 관리 | `/candidates` | 인사팀 |
| 레벨업 심사 | `/reviews` | 본부장 이상 |
| 레벨업 확정 | `/confirmation` | 대표이사 |
| 레벨업 기준 설정 | `/admin/criteria` | 시스템 관리자 |
| 엑셀 업로드 | `/upload` | 인사팀 |
| 통계 대시보드 | `/dashboard` | 대표이사/인사팀 |

## 데이터 모델 (전체 엔티티)

**Phase 1**
- `Employee` — 직원 기본정보 (name, department, team, level, hire_date, employment_type, position, years_of_service)
- `Point` — 연도별 포인트 (employee_id, year, score, merit, penalty, cumulative)
- `Credit` — 연도별 학점 (employee_id, year, score, cumulative)
- `UploadHistory` — 엑셀 업로드 이력 (filename, uploaded_by, uploaded_at, record_count, status)

**Phase 2**
- `Candidate` — 대상자 (employee_id, year, point_met, credit_met, is_review_target)
- `Review` — 심사 결과 (candidate_id, year, competency_score, competency_eval, recommendation)
- `Opinion` — 본부장 의견 (review_id, reviewer_id, reviewer_role, opinion_text, recommendation)

**Phase 3**
- `Confirmation` — 확정 (candidate_id, year, status[확정/보류/미제출], confirmed_by, confirmed_at)
- `LevelCriteria` — 승격 기준 (level, year, required_points, required_credits, min_tenure)
- `CriteriaHistory` — 기준 변경 이력 (criteria_id, changed_by, changed_at, field, old_value, new_value)

## 핵심 비즈니스 규칙

- **포인트 집계**: 해당 레벨 체류 기간 발생분만 합산. 누적 = 연도별 합 + 상점 - 벌점
- **학점 집계**: 2025년부터 도입, 이전 연도에도 동일 기준 소급 적용
- **신규입사자**: L3-03이지만 신규입사 시, L3-01·L3-02 포인트는 G기준 2점 부여
- **포인트/학점 컬럼**: 해당 레벨의 연차 수만큼 연도별 컬럼을 동적으로 생성
- **추천 완료 조건**: 역량점수 + 역량레벨평가 + 의견 **모두** 입력 완료 시에만 추천 가능
- **엑셀 업로드 트랜잭션**: 전체 성공 또는 전체 롤백 (부분 저장 없음)
- **동일 사원 덮어쓰기**: 업로드 시 업데이트/스킵 중 선택, 이력 보존

## 엑셀 업로드 템플릿 컬럼

본부(필수), 팀(필수), 이름(필수), 고용형태(필수), 직책, 현재직급(필수), 입사일자(필수), 연차(필수), 역량레벨, 레벨업연도

## 아키텍처 구조 (예정)

```
src/
├── app/
│   ├── (auth)/              # NextAuth 로그인
│   ├── employees/           # 레벨 관리/조회
│   ├── points/              # 포인트 관리
│   ├── credits/             # 학점 관리
│   ├── candidates/          # 대상자 관리
│   ├── reviews/             # 심사 메인 + 의견 팝업
│   ├── confirmation/        # 확정
│   ├── upload/              # 엑셀 업로드
│   ├── dashboard/           # 통계
│   ├── admin/criteria/      # 기준 설정
│   └── api/                 # API Routes (각 도메인별)
├── components/              # shadcn/ui 기반 공통 컴포넌트
├── lib/
│   ├── prisma.ts            # Prisma 클라이언트 싱글턴
│   ├── excel/               # SheetJS 파싱·템플릿 생성
│   ├── level/               # 충족 여부 판정 로직
│   └── auth/                # NextAuth 설정·권한 헬퍼
├── types/                   # 공통 TypeScript 타입
└── prisma/
    ├── schema.prisma
    └── migrations/
```

## 개발 단계 요약

| 단계 | 주요 산출물 | 검증 기준 |
|------|------------|----------|
| Phase 1 (6~8주) | DB 설계, 엑셀 업로드, 레벨 조회, 포인트/학점 관리 | 엑셀 업로드 후 3개 화면 정상 동작 |
| Phase 2 (6~8주) | 대상자 관리, 심사 메인/팝업, 추천 워크플로우 | 심사 E2E 테스트 통과 |
| Phase 3 (4~6주) | 확정 화면, 기준 설정, 통계 대시보드, 권한 고도화 | 전체 프로세스 E2E 완료 |

## 참고 자료

- PRD 원문: `docs/PRD.docx` (또는 프로젝트 루트 `PRD.docx`)
