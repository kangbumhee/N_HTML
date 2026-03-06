# 서버 레포 복사 시 참고

이 폴더의 `check-naver-orders.js`를 **genspark-auth-server** 레포의 `netlify/functions/` 에 복사해 사용하세요.

## 필수: package.json 의존성 추가

서버 레포의 `package.json`에 **bcryptjs**를 추가해야 합니다 (토큰 발급 시 bcrypt 해싱 사용, 순수 JS라 esbuild 번들링 가능).

```json
{
  "name": "genspark-auth-server",
  "version": "1.0.0",
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "bcryptjs": "^2.4.3"
  }
}
```

복사 후 서버 레포에서 `npm install` 실행하고 배포하면 됩니다.
