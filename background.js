/**
 * 네이버 블로그 HTML 변환기 - Background Service Worker
 * 
 * Firebase SDK 없이 REST API로 직접 통신
 */

// Firebase REST API 설정
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBcpKMuVm_A4USibFpzAlaPLOiB18GICs8",
  authDomain: "naver-blog-converter.firebaseapp.com",
  projectId: "naver-blog-converter"
};

const GOOGLE_CLIENT_ID = "182208263158-rvlf3j22m8pl87g3i506os99gro9e1gq.apps.googleusercontent.com";

// 마스터 계정 (무제한 사용)
const MASTER_ACCOUNTS = [
  'kbhjjan@gmail.com'
];

// 사용자 정보 저장 (메모리)
let currentUser = null;

/**
 * 로컬 시간 기준 날짜 문자열 반환 (YYYY-MM-DD)
 */
function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 확장프로그램 아이콘 클릭 이벤트 처리
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    const url = tab.url || '';
    const isNaverBlog = url.includes('blog.naver.com') &&
      (url.includes('PostWriteForm') || url.includes('postwrite'));

    if (!isNaverBlog) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const existing = document.getElementById('nbc-not-naver-alert');
          if (existing) { existing.remove(); return; }

          const overlay = document.createElement('div');
          overlay.id = 'nbc-not-naver-alert';
          overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
          overlay.innerHTML = `
            <div style="background:#fff;border-radius:16px;padding:40px 36px;max-width:420px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:nbcFadeIn 0.3s ease;">
              <div style="font-size:48px;margin-bottom:16px;">🚫</div>
              <h2 style="font-size:20px;font-weight:700;color:#1f2937;margin:0 0 12px;">네이버 블로그 에디터에서만 사용 가능합니다</h2>
              <p style="font-size:14px;color:#6b7280;line-height:1.6;margin:0 0 24px;">이 확장 프로그램은 <strong style="color:#03C75A;">네이버 블로그 글쓰기</strong> 페이지에서만 동작합니다.<br>아래 버튼을 클릭하여 글쓰기 페이지로 이동하세요.</p>
              <a href="https://blog.naver.com/PostWriteForm.naver" target="_blank" style="display:inline-block;background:#03C75A;color:#fff;font-size:15px;font-weight:600;padding:12px 32px;border-radius:10px;text-decoration:none;margin-bottom:12px;">네이버 블로그 글쓰기로 이동 →</a>
              <br>
              <button id="nbc-close-alert" style="background:none;border:none;color:#9ca3af;font-size:13px;cursor:pointer;margin-top:8px;padding:4px 12px;">닫기</button>
            </div>
            <style>@keyframes nbcFadeIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}</style>
          `;
          document.body.appendChild(overlay);

          overlay.addEventListener('click', function(e) {
            if (e.target === overlay || e.target.id === 'nbc-close-alert') {
              overlay.remove();
            }
          });
        }
      });
      return;
    }

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => typeof window.__naverBlogConverterInitialized !== 'undefined'
    });

    if (result?.result) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (typeof window.toggleNaverBlogConverter === 'function') {
            window.toggleNaverBlogConverter();
          }
        }
      });
    } else {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });

      await new Promise(r => setTimeout(r, 200));

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (typeof window.toggleNaverBlogConverter === 'function') {
            window.toggleNaverBlogConverter();
          }
        }
      });
    }
  } catch (error) {
    console.error('아이콘 클릭 에러:', error);
  }
});

/**
 * 메시지 핸들러
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      if (request.action === 'login') {
        const result = await handleGoogleLogin();
        sendResponse(result);
        return;
      }
      
      if (request.action === 'logout') {
        // 현재 토큰 가져오기
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
          if (token) {
            // 토큰 철회 (revoke)
            fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
              .then(() => {})
              .catch(err => {});
            
            // 캐시에서 토큰 제거
            chrome.identity.removeCachedAuthToken({ token }, () => {});
          }
          
          // 모든 캐시된 토큰 제거
          chrome.identity.clearAllCachedAuthTokens(() => {});
        });
        
        // 로컬 스토리지 정리
        currentUser = null;
        chrome.storage.local.remove(['user', 'accessToken'], () => {});
        
        sendResponse({ success: true });
        return;
      }
      
      if (request.action === 'getUser') {
        const result = await chrome.storage.local.get(['user', 'accessToken']);
        
        // 저장된 사용자가 있으면 토큰 유효성도 확인
        if (result.user && result.accessToken) {
          try {
            // 토큰으로 사용자 정보 확인 (유효성 검증)
            const userInfoResponse = await fetch(
              'https://www.googleapis.com/oauth2/v2/userinfo',
              { headers: { Authorization: `Bearer ${result.accessToken}` } }
            );
            
            if (userInfoResponse.ok) {
              // 토큰 유효 - 저장된 사용자 정보 반환
              sendResponse({ success: true, user: result.user });
            } else {
              // 토큰 만료 - 새 토큰 시도
              const newToken = await new Promise((resolve) => {
                chrome.identity.getAuthToken({ interactive: false }, (token) => {
                  resolve(token || null);
                });
              });
              
              if (newToken) {
                // 새 토큰으로 사용자 정보 가져오기
                const newUserInfoResponse = await fetch(
                  'https://www.googleapis.com/oauth2/v2/userinfo',
                  { headers: { Authorization: `Bearer ${newToken}` } }
                );
                
                if (newUserInfoResponse.ok) {
                  const userInfo = await newUserInfoResponse.json();
                  const user = {
                    email: userInfo.email,
                    displayName: userInfo.name || userInfo.email.split('@')[0],
                    photoURL: userInfo.picture || ''
                  };
                  
                  await chrome.storage.local.set({ user, accessToken: newToken });
                  sendResponse({ success: true, user });
                } else {
                  // 갱신 실패
                  await chrome.storage.local.remove(['user', 'accessToken']);
                  sendResponse({ success: false, user: null });
                }
              } else {
                // 새 토큰 없음
                await chrome.storage.local.remove(['user', 'accessToken']);
                sendResponse({ success: false, user: null });
              }
            }
          } catch (error) {
            // 에러 시에도 저장된 정보 반환 (오프라인 등)
            sendResponse({ success: true, user: result.user });
          }
        } else {
          // 저장된 사용자 없음
          sendResponse({ success: false, user: null });
        }
        return;
      }
      
      if (request.action === 'openAdmin') {
        chrome.tabs.create({ url: chrome.runtime.getURL('admin.html') });
        sendResponse({ success: true });
        return;
      }
      
      if (request.action === 'checkUsage') {
        const result = await chrome.storage.local.get(['user']);
        const email = request.email || result.user?.email;
        
        if (!email) {
          sendResponse({ 
            success: false, 
            error: 'no_user',
            count: 0,
            limit: 3,
            plan: 'free',
            unlimited: false
          });
          return;
        }
        
        const usage = await checkUsage(email);
        sendResponse({ 
          success: true, 
          ...usage,
          usage: usage 
        });
        return;
      }
      
      if (request.action === 'useConversion') {
        const result = await chrome.storage.local.get(['user', 'usage']);
        const email = result.user?.email || request.email;
        const usageResult = await useConversion(email);
        sendResponse({ success: usageResult.success, usage: usageResult.usage, error: usageResult.error });
        return;
      }

      if (request.action === 'forceRefreshUsage') {
        (async () => {
          const email = request.email;
          if (!email) {
            sendResponse({ success: false, error: 'No email' });
            return;
          }
          
          // 현재 시간으로 새로운 날짜 생성 (캐시 우회, 로컬 시간 기준)
          const today = getLocalDateString();
          
          // Firestore에서 최신 데이터 가져오기
          const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${encodeURIComponent(email)}`;
          
          try {
            const response = await fetch(url);
            const data = await response.json();
            const fields = data.fields || {};
            
            const lastUsageDate = fields.lastUsageDate?.stringValue || '';
            let todayCount = parseInt(fields.todayCount?.integerValue) || 0;
            const plan = fields.plan?.stringValue || 'free';
            const limit = parseInt(fields.limit?.integerValue) || 3;
            
            // 날짜가 다르면 리셋
            if (lastUsageDate !== today) {
              const updateUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${encodeURIComponent(email)}?updateMask.fieldPaths=todayCount&updateMask.fieldPaths=lastUsageDate`;
              
              await fetch(updateUrl, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fields: {
                    todayCount: { integerValue: 0 },
                    lastUsageDate: { stringValue: today }
                  }
                })
              });
              
              todayCount = 0;
            }
            
            sendResponse({ 
              success: true, 
              count: todayCount, 
              limit, 
              plan,
              today 
            });
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
        })();
        
        return true; // 비동기 응답
      }

      // ═══════════════════ captureHtmlAsImage (capture.html + sendMessage, executeScript 미사용) ═══════════════════
      if (request.action === 'captureHtmlAsImage') {
        (async () => {
          let newTabId = null;
          try {
            const html = request.html;

            const captureUrl = chrome.runtime.getURL('capture.html');
            const tab = await chrome.tabs.create({
              url: captureUrl,
              active: true
            });
            newTabId = tab.id;

            await new Promise((resolve) => {
              const listener = (tabId, info) => {
                if (tabId === newTabId && info.status === 'complete') {
                  chrome.tabs.onUpdated.removeListener(listener);
                  resolve();
                }
              };
              chrome.tabs.onUpdated.addListener(listener);
            });
            await new Promise(r => setTimeout(r, 800));

            const renderResult = await chrome.tabs.sendMessage(newTabId, {
              action: 'renderHtml',
              html: html
            });

            if (!renderResult || !renderResult.ok) {
              throw new Error('렌더링 실패: ' + (renderResult ? renderResult.error : 'no response'));
            }

            const pageHeight = renderResult.scrollHeight;
            const viewportHeight = renderResult.clientHeight;

            await new Promise(r => setTimeout(r, 500));

            const captures = [];
            let scrollY = 0;

            while (scrollY < pageHeight) {
              await chrome.tabs.sendMessage(newTabId, {
                action: 'scrollTo',
                y: scrollY
              });
              await new Promise(r => setTimeout(r, 400));

              const dataUri = await chrome.tabs.captureVisibleTab(tab.windowId, {
                format: 'png',
                quality: 100
              });

              captures.push({
                dataUri: dataUri,
                scrollY: scrollY,
                viewportHeight: viewportHeight
              });

              scrollY += viewportHeight;
              if (captures.length > 30) break;
            }

            await chrome.tabs.remove(newTabId);
            newTabId = null;

            if (sender.tab && sender.tab.id) {
              try { await chrome.tabs.update(sender.tab.id, { active: true }); } catch (e) {}
            }

            sendResponse({
              success: true,
              captures: captures,
              pageHeight: pageHeight,
              viewportHeight: viewportHeight,
              totalCaptures: captures.length
            });

          } catch (err) {
            if (newTabId) {
              try { await chrome.tabs.remove(newTabId); } catch (e) {}
            }
            if (sender.tab && sender.tab.id) {
              try { await chrome.tabs.update(sender.tab.id, { active: true }); } catch (e) {}
            }
            sendResponse({ success: false, error: err.message });
          }
        })();
        return true;
      }

      sendResponse({ success: false, error: '알 수 없는 액션' });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // 비동기 응답
});

/**
 * Google OAuth 로그인
 */
async function handleGoogleLogin() {
  try {
    // 기존 토큰 캐시 제거 (계정 선택 화면 표시를 위해)
    await new Promise((resolve) => {
      chrome.identity.clearAllCachedAuthTokens(() => {
        resolve();
      });
    });
    
    // Chrome Identity API로 Google 토큰 획득 (interactive: true로 계정 선택 화면 표시)
    const authToken = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ 
        interactive: true,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile'
        ]
      }, (token) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(token);
        }
      });
    });
    
    // 사용자 정보 가져오기
    const userInfoResponse = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    
    if (!userInfoResponse.ok) {
      throw new Error('사용자 정보를 가져올 수 없습니다.');
    }
    
    const userInfo = await userInfoResponse.json();
    
    // Firestore에 사용자 저장/업데이트 (await로 대기)
    try {
      await saveUserToFirestore(userInfo);
    } catch (err) {
    }
    
    // 로컬 저장
    const user = {
      email: userInfo.email,
      displayName: userInfo.name || userInfo.email.split('@')[0],
      photoURL: userInfo.picture || ''
    };
    
    currentUser = user;
    await chrome.storage.local.set({ user, accessToken: authToken });
    
    return { success: true, user };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Firestore에 사용자 저장 (REST API)
 */
async function saveUserToFirestore(userInfo) {
  const email = userInfo.email;
  const isMaster = MASTER_ACCOUNTS.includes(email);
  
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${encodeURIComponent(email)}`;
  
  const now = new Date().toISOString();
  
  // Firestore 문서 데이터
  const documentData = {
    fields: {
      email: { stringValue: email },
      displayName: { stringValue: userInfo.name || email.split('@')[0] },
      photoURL: { stringValue: userInfo.picture || '' },
      plan: { stringValue: isMaster ? 'master' : 'free' },
      limit: { integerValue: isMaster ? -1 : 3 },
      createdAt: { stringValue: now },
      lastLoginAt: { stringValue: now }
    }
  };
  
  try {
    // 먼저 기존 문서 확인
    const getResponse = await fetch(firestoreUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (getResponse.ok) {
      // 기존 사용자 - lastLoginAt만 업데이트
      const existingDoc = await getResponse.json();
      const existingPlan = existingDoc.fields?.plan?.stringValue;
      const existingLimit = existingDoc.fields?.limit?.integerValue;
      
      // 마스터 계정이면 plan과 limit 업데이트, 아니면 기존 값 유지
      const updateData = {
        fields: {
          ...existingDoc.fields,
          lastLoginAt: { stringValue: now }
        }
      };
      
      // 마스터 계정이면 강제로 master/무제한 설정
      if (isMaster) {
        updateData.fields.plan = { stringValue: 'master' };
        updateData.fields.limit = { integerValue: -1 };
      }
      
      await fetch(firestoreUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      
      // 로컬 스토리지에도 plan/limit 저장
      const plan = isMaster ? 'master' : (existingPlan || 'free');
      const limit = isMaster ? -1 : (parseInt(existingLimit) || 3);
      
      await updateLocalUsage(email, plan, limit);
      
    } else {
      // 새 사용자 - 문서 생성
      await fetch(firestoreUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(documentData)
      });
      
      // 로컬 스토리지에 plan/limit 저장
      const plan = isMaster ? 'master' : 'free';
      const limit = isMaster ? -1 : 3;
      
      await updateLocalUsage(email, plan, limit);
    }
    
  } catch (error) {
  }
}

/**
 * 로컬 사용량 정보 업데이트
 */
async function updateLocalUsage(email, plan, limit) {
  const usageKey = `usage_${email}`;
  const today = getLocalDateString();
  
  const result = await chrome.storage.local.get([usageKey]);
  const usage = result[usageKey] || { date: today, count: 0 };
  
  usage.plan = plan;
  usage.limit = limit;
  
  await chrome.storage.local.set({ [usageKey]: usage });
}

/**
 * Firestore 사용자 정보 가져오기
 */
async function getFirestoreUser(email) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${encodeURIComponent(email)}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    return {
      email: data.fields?.email?.stringValue || email,
      plan: data.fields?.plan?.stringValue || 'free',
      limit: parseInt(data.fields?.limit?.integerValue) || 3,
      todayCount: parseInt(data.fields?.todayCount?.integerValue) || 0,
      totalCount: parseInt(data.fields?.totalCount?.integerValue) || 0,
      lastUsageDate: data.fields?.lastUsageDate?.stringValue || '',
      unlimitedStart: data.fields?.unlimitedStart?.stringValue || '',
      unlimitedEnd: data.fields?.unlimitedEnd?.stringValue || ''
    };
  } catch (error) {
    return null;
  }
}

/**
 * Firestore 사용자 정보 업데이트
 */
async function updateFirestoreUser(email, updates) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${encodeURIComponent(email)}`;
    
    // 기존 문서 가져오기
    const getResponse = await fetch(url);
    if (!getResponse.ok) {
      throw new Error('사용자 정보를 가져올 수 없습니다.');
    }
    
    const existingDoc = await getResponse.json();
    const existingFields = existingDoc.fields || {};
    
    // 안전하게 필드 생성
    const stringField = (value) => ({ stringValue: value || '' });
    const intField = (value) => ({ integerValue: parseInt(value) || 0 });
    
    // 업데이트할 필드만 변경 (총 사용량 반영, 접속일 갱신)
    const nowIso = new Date().toISOString();
    const updateFields = {
      email: stringField(existingFields.email?.stringValue || email),
      displayName: stringField(existingFields.displayName?.stringValue || ''),
      photoURL: stringField(existingFields.photoURL?.stringValue || ''),
      createdAt: stringField(existingFields.createdAt?.stringValue || new Date().toISOString()),
      lastLoginAt: stringField(updates.lastLoginAt !== undefined ? updates.lastLoginAt : nowIso),
      todayCount: intField(updates.todayCount !== undefined ? updates.todayCount : (existingFields.todayCount?.integerValue || 0)),
      lastUsageDate: stringField(updates.lastUsageDate !== undefined ? updates.lastUsageDate : (existingFields.lastUsageDate?.stringValue || '')),
      totalCount: intField(updates.totalCount !== undefined ? updates.totalCount : (parseInt(existingFields.totalCount?.integerValue) || 0)),
      plan: stringField(existingFields.plan?.stringValue || 'free'),
      limit: intField(existingFields.limit?.integerValue || 3),
      unlimitedStart: stringField(existingFields.unlimitedStart?.stringValue || ''),
      unlimitedEnd: stringField(existingFields.unlimitedEnd?.stringValue || ''),
      memo: stringField(existingFields.memo?.stringValue || '')
    };
    
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: updateFields })
    });
    
  } catch (error) {
  }
}

/**
 * 사용량 확인 (Firestore 동기화 포함)
 */
async function checkUsage(email) {
  try {
    const today = getLocalDateString();
    
    // 마스터 계정 체크
    if (MASTER_ACCOUNTS.includes(email)) {
      return { plan: 'master', limit: -1, count: 0, unlimited: true, unlimitedStart: '', unlimitedEnd: '' };
    }
    
    // Firestore에서 사용자 정보 가져오기
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${encodeURIComponent(email)}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      return { plan: 'free', limit: 3, count: 0, totalCount: 0, unlimited: false };
    }
    
    const data = await response.json();
    const fields = data.fields || {};
    
    const lastUsageDate = fields.lastUsageDate?.stringValue || '';
    let todayCount = parseInt(fields.todayCount?.integerValue) || 0;
    const totalCount = parseInt(fields.totalCount?.integerValue) || 0;
    let plan = fields.plan?.stringValue || 'free';
    let limit = parseInt(fields.limit?.integerValue) || 3;
    const unlimitedStart = fields.unlimitedStart?.stringValue || '';
    const unlimitedEnd = fields.unlimitedEnd?.stringValue || '';
    
    // 날짜가 바뀌었으면 카운트 리셋 (접속일도 갱신)
    if (lastUsageDate !== today) {
      todayCount = 0;
      const nowIso = new Date().toISOString();
      const updateUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${encodeURIComponent(email)}?updateMask.fieldPaths=todayCount&updateMask.fieldPaths=lastUsageDate&updateMask.fieldPaths=lastLoginAt`;
      await fetch(updateUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            todayCount: { integerValue: 0 },
            lastUsageDate: { stringValue: today },
            lastLoginAt: { stringValue: nowIso }
          }
        })
      });
    }
    
    // 무제한 기간 체크
    let isUnlimited = false;
    if (unlimitedStart && unlimitedEnd) {
      const now = new Date();
      const start = new Date(unlimitedStart);
      const end = new Date(unlimitedEnd);
      isUnlimited = now >= start && now <= end;
    }
    if (limit === -1) {
      isUnlimited = true;
    }

    // ✅ Pro/기본 플랜 만료 시 자동 다운그레이드
    if (plan !== 'free' && plan !== 'master' && !isUnlimited && unlimitedEnd) {
      const now = new Date();
      const end = new Date(unlimitedEnd);
      if (now > end) {
        // 만료됨 → free로 다운그레이드
        console.log(`⏰ [checkUsage] ${email} 플랜 만료 → free로 다운그레이드`);
        const encEmail = encodeURIComponent(email);
        const patchUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${encEmail}?updateMask.fieldPaths=plan&updateMask.fieldPaths=limit&updateMask.fieldPaths=remaining_posts&updateMask.fieldPaths=max_devices`;
        try {
          await fetch(patchUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                plan: { stringValue: 'free' },
                limit: { integerValue: 3 },
                remaining_posts: { integerValue: 5 },
                max_devices: { integerValue: 1 }
              }
            })
          });
          // 로컬 변수도 갱신
          plan = 'free';
          limit = 3;
        } catch (e) {
          console.error('다운그레이드 실패:', e);
        }
      }
    }
    
    const result = {
      plan,
      limit,
      count: todayCount,
      totalCount,
      unlimited: isUnlimited,
      unlimitedStart,
      unlimitedEnd
    };
    
    return result;
    
  } catch (error) {
    return { plan: 'free', limit: 3, count: 0, totalCount: 0, unlimited: false };
  }
}

/**
 * 변환 1회 사용
 */
async function useConversion(email) {
  if (!email) {
    return { success: false, error: 'no_email' };
  }
  
  const today = getLocalDateString();
  
  // 마스터 계정 체크
  const isMaster = MASTER_ACCOUNTS.includes(email);
  
  try {
    // 최신 사용량 정보 가져오기 (Firestore 동기화 포함)
    const currentUsage = await checkUsage(email);
    
    // 무제한 체크
    if (currentUsage.unlimited || isMaster) {
      // Firestore에서 현재 카운트 가져오기
      const userDoc = await getFirestoreUser(email);
      const newCount = (userDoc?.todayCount || 0) + 1;
      const newTotalCount = (userDoc?.totalCount || 0) + 1;
      
      // Firestore 업데이트 (오늘 사용량, 총 사용량, 접속일)
      await updateFirestoreUser(email, {
        todayCount: newCount,
        lastUsageDate: today,
        totalCount: newTotalCount
      });
      
      return { 
        success: true, 
        usage: {
          date: today,
          count: newCount,
          limit: -1,
          plan: currentUsage.plan || 'master',
          unlimited: true
        }
      };
    }
    
    // 제한 체크
    if (currentUsage.count >= currentUsage.limit) {
      return { 
        success: false, 
        error: 'limit_reached', 
        usage: {
          date: today,
          count: currentUsage.count,
          limit: currentUsage.limit,
          plan: currentUsage.plan || 'free',
          unlimited: false
        }
      };
    }
    
    // 카운트 증가
    const newCount = currentUsage.count + 1;
    const newTotalCount = (currentUsage.totalCount || 0) + 1;
    
    // Firestore 업데이트 (오늘 사용량, 총 사용량, 접속일)
    await updateFirestoreUser(email, {
      todayCount: newCount,
      lastUsageDate: today,
      totalCount: newTotalCount
    });
    
    // 로컬 스토리지도 업데이트
    const usageKey = `usage_${email}`;
    await chrome.storage.local.set({
      [usageKey]: {
        date: today,
        count: newCount,
        limit: currentUsage.limit,
        plan: currentUsage.plan
      }
    });
    
    return { 
      success: true, 
      usage: {
        date: today,
        count: newCount,
        limit: currentUsage.limit,
        plan: currentUsage.plan || 'free',
        unlimited: false
      }
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Firestore 사용량 업데이트 (헬퍼 함수)
 */
async function updateFirestoreUsage(email, todayCount) {
  const today = getLocalDateString();
  
  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${encodeURIComponent(email)}`;
    
    // 기존 문서 가져오기
    const getResponse = await fetch(firestoreUrl);
    if (getResponse.ok) {
      const existingDoc = await getResponse.json();
      const existingFields = existingDoc.fields || {};
      const currentTotalCount = parseInt(existingFields.totalCount?.integerValue) || 0;
      
      // 안전하게 필드 생성
      const stringField = (value) => ({ stringValue: value || '' });
      const intField = (value) => ({ integerValue: parseInt(value) || 0 });
      
      const updateFields = {
        email: stringField(existingFields.email?.stringValue || email),
        displayName: stringField(existingFields.displayName?.stringValue || ''),
        photoURL: stringField(existingFields.photoURL?.stringValue || ''),
        createdAt: stringField(existingFields.createdAt?.stringValue || new Date().toISOString()),
        lastLoginAt: stringField(existingFields.lastLoginAt?.stringValue || new Date().toISOString()),
        todayCount: intField(todayCount),
        lastUsageDate: stringField(today),  // 오늘 날짜 기록
        totalCount: intField(currentTotalCount + 1),
        plan: stringField(existingFields.plan?.stringValue || 'free'),
        limit: intField(existingFields.limit?.integerValue || 3),
        unlimitedStart: stringField(existingFields.unlimitedStart?.stringValue || ''),
        unlimitedEnd: stringField(existingFields.unlimitedEnd?.stringValue || ''),
        memo: stringField(existingFields.memo?.stringValue || '')
      };
      
      await fetch(firestoreUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: updateFields })
      });
      
    }
  } catch (err) {
  }
}
