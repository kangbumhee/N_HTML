# 커서 AI에게 전달할 전체 프롬프트 (최종)

- **방법 1**: 아래 전체를 **서버 레포(genspark-auth-server)** 를 연 Cursor에서 복사해 붙여넣어 AI에게 구현 요청.
- **방법 2**: 이 확장 레포에 **참고용 전체 코드**가 있음. `naver-blog-converter/server-reference/check-naver-orders.js` 파일을 서버 레포의 `netlify/functions/check-naver-orders.js` 로 복사해 넣고, Netlify 환경변수 3개만 추가하면 됨.

---

★ Netlify Functions 런타임은 Node 18 기준으로 가정해. netlify.toml의 node_bundler = "esbuild" 설정을 유지해줘. fetch는 Node 18 내장을 사용하므로 별도 패키지 불필요.

---

## 요청: 네이버 스마트스토어 결제 → Pro 한 달 자동 설정 구현

### 현재 코드 전체 구조를 이미 파악했으니, 아래 지시대로 정확히 구현해줘.

---

## 1. 현재 프로젝트 구조 (이미 존재하는 것들)

### 서버: Netlify Functions
- 레포: `genspark-auth-server`
- 경로: `netlify/functions/`
- 기존 파일: `verify-payment.js`, `auth.js`, `config.js`, `admin-users.js`, `use-post.js`, `migrate-fields.js`
- `netlify.toml`:
```toml
[build]
  functions = "netlify/functions"
[functions]
  node_bundler = "esbuild"
```
- `package.json`:
```json
{
  "name": "genspark-auth-server",
  "version": "1.0.0",
  "dependencies": {
    "firebase-admin": "^12.0.0"
  }
}
```

### Firebase/Firestore
- Firebase Admin SDK 사용 (REST API 아님!)
- 환경변수: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (Netlify에 설정됨)
- 모든 기존 파일의 초기화 패턴:
```javascript
const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}
const db = admin.firestore();
```

### Firestore `users` 컬렉션 문서 구조 (doc ID = 이메일 소문자)
```
email, displayName, photoURL, plan, remaining_posts, limit,
todayCount, todayDate, totalCount, max_devices, devices[],
plan_expires, createdAt, lastLoginAt, unlimitedStart, unlimitedEnd, memo
```

### 네이버 커머스 API 정보
- 앱 ID: `3gVa5aPCu9eLPpbUaeVBfc`
- 시크릿: `$2a$04$L20cnXMKIGRwOhr/hdTtuO`
- 스토어 상품: `https://smartstore.naver.com/mumuriri/products/13099849483`
- 상품에 **직접입력 옵션** "구글 이메일 주소를 입력해주세요" 가 이미 설정됨

---

## 2. 구현할 것: 새 파일 `netlify/functions/check-naver-orders.js`

이 함수는 **외부에서 주기적으로 호출(cron)** 되거나, **수동으로 호출**하면:
1. 네이버 커머스 API에서 최근 주문을 조회
2. "결제완료" 상태인 주문에서 직접입력 옵션의 이메일 추출
3. Firestore `users/{email}` 문서를 Pro + 1개월로 업데이트
4. 발송처리(배송없음) 자동 실행
5. 처리한 주문을 Firestore `payments` 컬렉션에 기록 (중복 방지)

### 완성 코드 (extractEmailFromOrder에 디버그 로그 포함):

`extractEmailFromOrder` 함수 **첫 줄에** 아래 디버그 로그를 반드시 넣어줘. 첫 주문 들어오면 Netlify Functions 로그에서 실제 API 응답 구조를 확인할 수 있음.

```javascript
function extractEmailFromOrder(detail) {
  // ★ 첫 주문 들어오면 이 로그로 실제 필드 구조 확인 후, 정확한 경로로 교체할 것
  console.log('=== 주문 상세 전체 구조 ===');
  console.log(JSON.stringify(detail, null, 2));

  // ... 이하 기존 이메일 추출 로직
}
```

나머지 전체 코드는 이전에 전달한 `check-naver-orders.js` 내용 그대로 구현해줘 (getCommerceToken, getChangedOrders, getOrderDetails, activatePro, dispatchOrder 등).

---

## 3. Netlify 환경변수 추가

Netlify 대시보드 → Site settings → Environment variables 에 추가:
- `NAVER_COMMERCE_CLIENT_ID` = `3gVa5aPCu9eLPpbUaeVBfc`
- `NAVER_COMMERCE_CLIENT_SECRET` = `$2a$04$L20cnXMKIGRwOhr/hdTtuO`
- `CRON_SECRET` = `check-orders-secret-2024` (원하는 값으로 변경 가능)

---

## 4. package.json — 변경 없음

crypto는 Node 내장, fetch는 Node 18 내장, firebase-admin 이미 있음. 추가 패키지 불필요.

---

## 5. 자동 실행 (택1)

- **cron-job.org**: URL `https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/check-naver-orders?key=check-orders-secret-2024`, GET, 5분마다.
- **GitHub Actions**: `.github/workflows/check-orders.yml` 에 schedule + workflow_dispatch 로 동일 URL 호출.
- **Netlify Scheduled**: netlify.toml 에 schedule 추가 시, 보안 체크에 `x-nf-event === 'schedule'` 허용 추가.

---

## 6. 테스트

배포 후 브라우저에서:
`https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/check-naver-orders?key=check-orders-secret-2024`

---

## 7. 주의사항

1. 이메일 추출: 첫 주문 들어오면 Netlify Functions 로그에서 `=== 주문 상세 전체 구조 ===` 출력을 보고, 직접입력 옵션 필드 경로를 확정한 뒤 `extractEmailFromOrder` 를 정확한 경로로 수정할 것.
2. 중복 방지: `payments` 컬렉션에 `productOrderId` 를 doc ID로 저장.
3. 기간 연장: 이미 Pro 사용자 추가 결제 시 기존 만료일 +1개월 연장.
4. 발송처리: `deliveryMethod: 'NOTHING'` 으로 자동 발송처리.

---

## 8. 파일 요약

- **새로 생성**: `netlify/functions/check-naver-orders.js` (위 규격대로, extractEmailFromOrder 에 디버그 로그 포함)
- **환경변수**: 3개 추가
- **수정 없음**: verify-payment.js, auth.js, config.js, admin-users.js, use-post.js, migrate-fields.js, package.json
