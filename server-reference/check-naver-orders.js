/**
 * Netlify Function: 네이버 스마트스토어 결제 확인 → Pro 1개월 자동 설정
 * 서버 레포(genspark-auth-server)의 netlify/functions/ 에 이 파일을 복사해 사용.
 * ★ Node 18 기준, fetch 내장 사용. netlify.toml node_bundler = "esbuild" 유지.
 */
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');

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

const COMMERCE_CLIENT_ID = process.env.NAVER_COMMERCE_CLIENT_ID || '3gVa5aPCu9eLPpbUaeVBfc';
const COMMERCE_CLIENT_SECRET = process.env.NAVER_COMMERCE_CLIENT_SECRET || '$2a$04$L20cnXMKIGRwOhr/hdTtuO';
const CRON_SECRET = process.env.CRON_SECRET || 'check-orders-secret-2024';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const bodyKey = event.body ? JSON.parse(event.body).key : null;
  const providedKey = params.key || bodyKey;

  if (providedKey !== CRON_SECRET) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    const token = await getCommerceToken();
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 60 * 1000);
    const changedOrders = await getChangedOrders(token, from, now);

    if (!changedOrders || changedOrders.length === 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, message: '새 주문 없음', processed: 0 })
      };
    }

    const payedOrders = changedOrders.filter(o => o.lastChangedType === 'PAYED');
    if (payedOrders.length === 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, message: '결제완료 주문 없음', processed: 0 })
      };
    }

    const productOrderIds = payedOrders.map(o => o.productOrderId);
    const details = await getOrderDetails(token, productOrderIds);
    const results = [];

    for (const detail of details) {
      const productOrderId = detail.productOrder?.productOrderId;

      const paymentDoc = await db.collection('payments').doc(productOrderId).get();
      if (paymentDoc.exists) {
        results.push({ productOrderId, status: 'already_processed' });
        continue;
      }

      const email = extractEmailFromOrder(detail);
      if (!email) {
        results.push({ productOrderId, status: 'no_email_found' });
        continue;
      }

      await activatePro(email, productOrderId);
      await dispatchOrder(token, productOrderId);
      results.push({ productOrderId, email, status: 'activated' });
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        message: `${results.filter(r => r.status === 'activated').length}건 처리`,
        processed: results.length,
        details: results
      })
    };
  } catch (error) {
    console.error('check-naver-orders error:', error);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function getCommerceToken() {
  const timestamp = Date.now();
  // 1) password = clientId_timestamp
  const password = `${COMMERCE_CLIENT_ID}_${timestamp}`;
  // 2) bcrypt 해싱 (client_secret을 salt로 사용)
  const hashed = bcrypt.hashSync(password, COMMERCE_CLIENT_SECRET);
  // 3) base64 인코딩
  const clientSecretSign = Buffer.from(hashed, 'utf-8').toString('base64');

  const res = await fetch('https://api.commerce.naver.com/external/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: COMMERCE_CLIENT_ID,
      timestamp: timestamp.toString(),
      grant_type: 'client_credentials',
      client_secret_sign: clientSecretSign,
      type: 'SELF'
    })
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('커머스 API 토큰 발급 실패: ' + JSON.stringify(data));
  }
  return data.access_token;
}

async function getChangedOrders(token, from, to) {
  const params = new URLSearchParams({
    lastChangedFrom: from.toISOString(),
    lastChangedTo: to.toISOString()
  });

  const res = await fetch(
    `https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/last-changed-statuses?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const data = await res.json();
  return data.data?.lastChangeStatuses || [];
}

async function getOrderDetails(token, productOrderIds) {
  const res = await fetch(
    'https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/query',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ productOrderIds })
    }
  );

  const data = await res.json();
  return data.data || [];
}

function extractEmailFromOrder(detail) {
  const searchTargets = [
    detail.productOrder?.productOption,
    detail.productOrder?.optionManageCode,
    detail.order?.ordererName
  ];

  const fullJson = JSON.stringify(detail);
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const allEmails = fullJson.match(emailRegex) || [];

  const filtered = allEmails.filter(e =>
    !e.includes('naver-blog-converter') &&
    !e.includes('iam.gserviceaccount.com') &&
    !e.includes('kbhjjan@gmail.com')
  );

  if (filtered.length > 0) {
    return filtered[0].toLowerCase().trim();
  }

  for (const target of searchTargets) {
    if (typeof target === 'string') {
      const match = target.match(emailRegex);
      if (match) return match[0].toLowerCase().trim();
    }
  }

  return null;
}

async function activatePro(email, productOrderId) {
  const userEmail = email.toLowerCase();
  const userRef = db.collection('users').doc(userEmail);
  const userDoc = await userRef.get();
  const now = new Date();
  const nowISO = now.toISOString();
  const today = nowISO.split('T')[0];

  const endDate = new Date(now);
  endDate.setMonth(endDate.getMonth() + 1);
  if (endDate.getDate() < now.getDate()) {
    endDate.setDate(0);
  }
  const unlimitedEndStr = endDate.toISOString().split('T')[0];

  if (!userDoc.exists) {
    await userRef.set({
      email: userEmail,
      displayName: '',
      photoURL: '',
      plan: 'pro',
      remaining_posts: 120,
      limit: -1,
      todayCount: 0,
      todayDate: today,
      totalCount: 0,
      max_devices: 3,
      devices: [],
      plan_expires: unlimitedEndStr + 'T23:59:59.999Z',
      createdAt: nowISO,
      lastLoginAt: nowISO,
      unlimitedStart: today,
      unlimitedEnd: unlimitedEndStr,
      memo: `스마트스토어 자동결제 (${productOrderId})`
    });
  } else {
    const userData = userDoc.data();
    let startDate = today;
    let finalEndStr = unlimitedEndStr;

    if ((userData.plan === 'pro' || userData.plan === 'master') &&
        userData.unlimitedEnd && userData.unlimitedEnd > today) {
      const existingEnd = new Date(userData.unlimitedEnd);
      existingEnd.setMonth(existingEnd.getMonth() + 1);
      if (existingEnd.getDate() < new Date(userData.unlimitedEnd).getDate()) {
        existingEnd.setDate(0);
      }
      finalEndStr = existingEnd.toISOString().split('T')[0];
      startDate = userData.unlimitedStart || today;
    }

    await userRef.update({
      plan: 'pro',
      remaining_posts: userData.remaining_posts > 120 ? userData.remaining_posts : 120,
      limit: -1,
      max_devices: Math.max(userData.max_devices || 1, 3),
      plan_expires: finalEndStr + 'T23:59:59.999Z',
      unlimitedStart: startDate,
      unlimitedEnd: finalEndStr,
      lastLoginAt: nowISO,
      memo: `${userData.memo || ''}\n스마트스토어 결제 ${today} (${productOrderId})`.trim()
    });
  }

  await db.collection('payments').doc(productOrderId).set({
    order_id: productOrderId,
    user_email: userEmail,
    buyer_name: '',
    plan: 'pro',
    amount: 29800,
    started_at: today,
    expires_at: (userDoc.exists ? 'extended' : unlimitedEndStr),
    status: 'auto_approved',
    source: 'naver_smartstore',
    created_at: nowISO
  });
}

async function dispatchOrder(token, productOrderId) {
  try {
    const res = await fetch(
      'https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/dispatch',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          dispatchProductOrders: [{
            productOrderId,
            deliveryMethod: 'NOTHING',
            dispatchDate: new Date().toISOString()
          }]
        })
      }
    );
    const data = await res.json();
    if (data.data?.failProductOrderInfos?.length > 0) {
      console.warn('발송처리 실패:', JSON.stringify(data.data.failProductOrderInfos));
    }
  } catch (err) {
    console.warn('발송처리 에러 (무시):', err.message);
  }
}
