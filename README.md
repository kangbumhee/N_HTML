# 네이버 블로그 HTML 변환기

HTML을 네이버 블로그 SE 에디터 형식으로 자동 변환하는 크롬 확장프로그램입니다.

## 설치 방법

### 1. Firebase 프로젝트 설정

1. [Firebase Console](https://console.firebase.google.com/)에서 새 프로젝트 생성
2. **Authentication** > **Sign-in method**에서 **Google** 로그인 활성화
3. **Firestore Database** 생성
4. **프로젝트 설정** > **일반** > **웹 앱 추가** > 설정값 복사

### 2. Google Cloud Console 설정

1. [Google Cloud Console](https://console.cloud.google.com/)
2. **API 및 서비스** > **사용자 인증 정보**
3. **OAuth 2.0 클라이언트 ID 만들기** > **Chrome 앱**
4. **애플리케이션 ID**에 확장프로그램 ID 입력 (chrome://extensions에서 확인)

### 3. 설정 파일 수정

`firebase-config.js` 파일에 Firebase 설정 입력:

```javascript
const FIREBASE_CONFIG = {
  apiKey: "실제_API_KEY",
  authDomain: "프로젝트.firebaseapp.com",
  projectId: "실제_PROJECT_ID",
  storageBucket: "프로젝트.appspot.com",
  messagingSenderId: "실제_SENDER_ID",
  appId: "실제_APP_ID"
};

const GOOGLE_CLIENT_ID = "실제_CLIENT_ID.apps.googleusercontent.com";
```

`manifest.json`의 `oauth2.client_id`도 동일하게 수정:

```json
"oauth2": {
  "client_id": "실제_CLIENT_ID.apps.googleusercontent.com",
  ...
}
```

### 4. 아이콘 생성

1. `create_icons.html` 파일을 브라우저에서 열기
2. **아이콘 생성 및 다운로드** 버튼 클릭
3. 다운로드된 `icon16.png`, `icon48.png`, `icon128.png` 파일을 `icons` 폴더에 저장

### 5. Firestore 보안 규칙 설정

Firebase Console > Firestore Database > 규칙 탭에서 아래 규칙 설정:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{email} {
      allow read, write: if request.auth != null && request.auth.token.email == email;
    }
  }
}
```

### 6. 확장프로그램 설치

1. Chrome에서 `chrome://extensions` 열기
2. **개발자 모드** 활성화
3. **압축해제된 확장 프로그램을 로드합니다** 클릭
4. `naver-blog-converter` 폴더 선택

## 사용 방법

1. 네이버 블로그 글쓰기 페이지로 이동
2. 확장프로그램 아이콘 클릭
3. Google 로그인
4. HTML 또는 서식있는 텍스트 붙여넣기
5. **블로그에 삽입** 버튼 클릭

## 주요 기능

- ✅ HTML을 네이버 블로그 SE 에디터 형식으로 자동 변환
- ✅ 표, 링크, 텍스트 스타일 지원
- ✅ 플로팅 UI (드래그 이동, 크기 조절)
- ✅ 일일 사용량 제한 (무료: 3회, Pro: 무제한)
- ✅ Firebase Authentication으로 안전한 로그인
- ✅ 사용량 실시간 확인

## 제한 사항

- 하루 3회 무료 사용
- Pro 업그레이드 시 무제한 (추후 제공)

## 지원하는 HTML 요소

### 텍스트로 변환
- 텍스트: `<p>`, `<div>`, `<h1>`~`<h6>`, `<span>`, `<li>`
- 스타일: `<strong>`, `<b>`, `<em>`, `<i>`, `<u>`, `<s>`, `<del>`, `<mark>`, `<small>`, `<code>`, `<kbd>`
- 링크: `<a href>` (OG 링크 카드)
- 표: `<table>`, `<tr>`, `<td>`, `<th>`
- 구분선: `<hr>`
- 인용문: `<blockquote>`
- 목록: `<ul>`, `<ol>`, `<li>`, `<dl>`
- 코드: `<pre>`, `<code>`

### 이미지(스크린샷)로 변환
- 미디어: `<img>` (네이버 서버 re-upload), `<svg>`, `<canvas>`, `<video>` (썸네일)
- 시각 요소: `<figure>`, `<details>`, `<progress>`, `<meter>`
- CSS 효과: gradient, flex, grid, filter, transform, animation, box-shadow, clip-path, backdrop-filter 등
- 복잡한 레이아웃 및 다크/라이트 테마 전체

### 자동 최적화
- 이미지·텍스트 교차 배치 (네이버 SEO 최적화)
- 첫 이미지 대표 이미지 자동 설정
- CDN 전파 대기 후 삽입 (이미지 깨짐 방지)

## 문의

카카오톡 문의: https://open.kakao.com/o/ssaNogdi

## 라이선스

이 프로젝트는 개인 사용 목적으로 제작되었습니다.
