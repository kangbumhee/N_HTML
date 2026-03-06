/**
 * 네이버 블로그 변환기 - 관리자 페이지
 * CSP 호환 버전 (인라인 이벤트 핸들러 제거)
 */

// Firebase 설정
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBcpKMuVm_A4USibFpzAlaPLOiB18GICs8",
  projectId: "naver-blog-converter"
};

// 마스터 계정 (관리자 접근 허용)
const MASTER_ACCOUNTS = [
  'kbhjjan@gmail.com'
];

// 상태
let currentAdmin = null;
let users = [];
let filteredUsers = [];
let currentFilter = 'all';
let searchQuery = '';
let currentPage = 1;
const pageSize = 20;
let editingUser = null;
let noticeList = [];
let currentTab = 'users';

/**
 * 초기화
 */
async function init() {
  console.log('🔵 [Admin] 초기화 시작');
  
  // 로그인 상태 확인
  const token = await getAuthToken(false);
  
  if (token) {
    const userInfo = await getUserInfo(token);
    if (userInfo && MASTER_ACCOUNTS.includes(userInfo.email)) {
      currentAdmin = userInfo;
      await loadNotice();
      await loadUsers();
      renderApp();
    } else {
      renderAccessDenied(userInfo?.email);
    }
  } else {
    renderLogin();
  }
}

/**
 * Google 토큰 가져오기
 */
function getAuthToken(interactive = false) {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        console.log('토큰 없음:', chrome.runtime.lastError);
        resolve(null);
      } else {
        resolve(token);
      }
    });
  });
}

/**
 * 사용자 정보 가져오기
 */
async function getUserInfo(token) {
  try {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    console.error('사용자 정보 가져오기 실패:', e);
  }
  return null;
}

/**
 * 로그인 처리
 */
async function handleLogin() {
  // 먼저 모든 캐시된 토큰 제거 (계정 선택 화면 표시를 위해)
  await new Promise((resolve) => {
    chrome.identity.clearAllCachedAuthTokens(() => {
      console.log('✅ [Admin] 로그인 전 캐시 토큰 제거');
      resolve();
    });
  });
  
  // 잠시 대기 (캐시 정리 시간)
  await new Promise(r => setTimeout(r, 500));
  
  const token = await getAuthToken(true);
  if (token) {
    const userInfo = await getUserInfo(token);
    if (userInfo && MASTER_ACCOUNTS.includes(userInfo.email)) {
      currentAdmin = userInfo;
      await loadUsers();
      renderApp();
    } else {
      renderAccessDenied(userInfo?.email);
    }
  }
}

/**
 * 로그아웃 처리
 */
function handleLogout() {
  // 모든 캐시된 토큰 제거
  chrome.identity.clearAllCachedAuthTokens(() => {
    console.log('✅ [Admin] 모든 캐시 토큰 제거');
    
    // 현재 토큰도 명시적으로 제거
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        // Google에서 토큰 철회
        fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
          .then(() => console.log('✅ [Admin] 토큰 철회 완료'))
          .catch(err => console.log('⚠️ [Admin] 토큰 철회 실패:', err));
        
        // 캐시에서 제거
        chrome.identity.removeCachedAuthToken({ token }, () => {
          console.log('✅ [Admin] 캐시 토큰 제거 완료');
          currentAdmin = null;
          renderLogin();
        });
      } else {
        currentAdmin = null;
        renderLogin();
      }
    });
  });
}

/**
 * 공지사항 로드
 */
async function loadNotice() {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/notices?pageSize=20&orderBy=createdAt%20desc`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      if (data.documents) {
        noticeList = data.documents.map(doc => {
          const f = doc.fields || {};
          const docPath = doc.name.split('/');
          return {
            id: docPath[docPath.length - 1],
            title: f.title?.stringValue || '',
            message: f.message?.stringValue || '',
            active: f.active?.booleanValue || false,
            createdAt: f.createdAt?.stringValue || ''
          };
        });
        noticeList.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      }
    }
  } catch (e) {
    console.log('공지사항 로드 실패:', e);
  }
}

/**
 * 공지사항 저장 (새 공지 추가)
 */
async function saveNotice() {
  const title = document.getElementById('noticeTitle').value.trim();
  const message = document.getElementById('noticeMessage').value.trim();

  if (!title || !message) {
    showToast('제목과 내용을 모두 입력해주세요.', 'error');
    return;
  }

  const saveBtn = document.getElementById('noticeSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';

  try {
    // 1) 기존 active 공지들을 비활성화
    for (const n of noticeList) {
      if (n.active) {
        await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/notices/${n.id}?updateMask.fieldPaths=active`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { active: { booleanValue: false } } })
        });
      }
    }

    // 2) 새 공지 추가 (POST로 자동 ID 생성)
    const createUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/notices`;
    const response = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          title: { stringValue: title },
          message: { stringValue: message },
          active: { booleanValue: true },
          createdAt: { stringValue: new Date().toISOString() }
        }
      })
    });

    if (!response.ok) throw new Error('저장 실패');

    showToast('공지사항이 등록되었습니다!', 'success');

    // 입력 초기화
    document.getElementById('noticeTitle').value = '';
    document.getElementById('noticeMessage').value = '';

    // 목록 새로고침
    await loadNotice();
    renderApp();

  } catch (error) {
    console.error('공지사항 저장 실패:', error);
    showToast('공지사항 저장 실패: ' + error.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '📢 공지 등록';
  }
}

/**
 * 공지 활성/비활성 토글
 */
async function toggleNoticeActive(noticeId) {
  const notice = noticeList.find(n => n.id === noticeId);
  if (!notice) return;

  try {
    if (!notice.active) {
      // 다른 활성 공지 비활성화
      for (const n of noticeList) {
        if (n.active) {
          await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/notices/${n.id}?updateMask.fieldPaths=active`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { active: { booleanValue: false } } })
          });
        }
      }
    }

    // 토글
    await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/notices/${noticeId}?updateMask.fieldPaths=active`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { active: { booleanValue: !notice.active } } })
    });

    showToast(notice.active ? '공지 비활성화됨' : '공지 활성화됨', 'success');
    await loadNotice();
    renderApp();
  } catch (error) {
    showToast('변경 실패: ' + error.message, 'error');
  }
}

/**
 * 공지 삭제
 */
async function deleteNotice(noticeId) {
  if (!confirm('이 공지를 삭제하시겠습니까?')) return;

  try {
    await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/notices/${noticeId}`, {
      method: 'DELETE'
    });

    showToast('공지가 삭제되었습니다.', 'success');
    await loadNotice();
    renderApp();
  } catch (error) {
    showToast('삭제 실패: ' + error.message, 'error');
  }
}

/**
 * Firestore에서 모든 사용자 로드
 */
async function loadUsers() {
  console.log('📊 [Admin] 사용자 목록 로드');
  
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users?pageSize=1000`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.documents && data.documents.length > 0) {
      users = data.documents.map(doc => {
        const fields = doc.fields || {};
        const docPath = doc.name.split('/');
        const docId = decodeURIComponent(docPath[docPath.length - 1]);
        
        // 필드 값 안전하게 추출
        const getValue = (field, type, defaultValue) => {
          if (!field) return defaultValue;
          if (type === 'string') return field.stringValue || defaultValue;
          if (type === 'int') return parseInt(field.integerValue) || defaultValue;
          return defaultValue;
        };
        
        return {
          id: docId,
          email: getValue(fields.email, 'string', docId),
          displayName: getValue(fields.displayName, 'string', ''),
          photoURL: getValue(fields.photoURL, 'string', ''),
          plan: getValue(fields.plan, 'string', 'free'),
          limit: getValue(fields.limit, 'int', 3),
          todayCount: getValue(fields.todayCount, 'int', 0),
          totalCount: getValue(fields.totalCount, 'int', 0),
          lastLoginAt: getValue(fields.lastLoginAt, 'string', ''),
          createdAt: getValue(fields.createdAt, 'string', ''),
          unlimitedStart: getValue(fields.unlimitedStart, 'string', ''),
          unlimitedEnd: getValue(fields.unlimitedEnd, 'string', ''),
          memo: getValue(fields.memo, 'string', '')
        };
      });
      
      // 최근 로그인 순으로 정렬
      users.sort((a, b) => {
        if (!a.lastLoginAt) return 1;
        if (!b.lastLoginAt) return -1;
        return new Date(b.lastLoginAt) - new Date(a.lastLoginAt);
      });
      
      console.log(`✅ [Admin] ${users.length}명 로드 완료`);
    } else {
      users = [];
      console.log('📊 [Admin] 사용자 없음');
    }
    
    applyFilter();
    
  } catch (error) {
    console.error('❌ [Admin] 사용자 로드 실패:', error);
    users = [];
    showToast('사용자 로드 실패: ' + error.message, 'error');
  }
}

/**
 * 필터 적용
 */
function applyFilter() {
  filteredUsers = users.filter(user => {
    // 플랜 필터
    if (currentFilter !== 'all' && user.plan !== currentFilter) {
      return false;
    }
    
    // 검색어 필터
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return user.email.toLowerCase().includes(query) ||
             user.displayName.toLowerCase().includes(query);
    }
    
    return true;
  });
  
  currentPage = 1;
}

/**
 * 통계 계산
 */
function getStats() {
  const total = users.length;
  const masters = users.filter(u => u.plan === 'master').length;
  const pros = users.filter(u => u.plan === 'pro').length;
  const frees = users.filter(u => u.plan === 'free').length;
  const todayActive = users.filter(u => {
    const today = new Date().toISOString().split('T')[0];
    return u.lastLoginAt && u.lastLoginAt.startsWith(today);
  }).length;
  
  return { total, masters, pros, frees, todayActive };
}

/**
 * 로그인 화면 렌더링
 */
function renderLogin() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login-screen">
      <div class="login-box">
        <div class="logo">🔐</div>
        <h1>관리자 로그인</h1>
        <p>마스터 계정으로 로그인하세요</p>
        
        <button class="google-login-btn" id="loginBtn">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google">
          Google로 로그인
        </button>
      </div>
    </div>
  `;
  
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
}

/**
 * 접근 거부 화면 렌더링
 */
function renderAccessDenied(email) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login-screen">
      <div class="login-box">
        <div class="logo">🚫</div>
        <h1>접근 거부</h1>
        <p>관리자 권한이 없습니다</p>
        
        <div class="access-denied">
          ${email || '알 수 없는 계정'}은(는)<br>관리자 계정이 아닙니다.
        </div>
        
        <button class="btn btn-secondary" style="width:100%; margin-top: 16px;" id="retryLoginBtn">
          다른 계정으로 로그인
        </button>
      </div>
    </div>
  `;
  
  document.getElementById('retryLoginBtn').addEventListener('click', async () => {
    // 완전히 로그아웃 후 다시 로그인
    await new Promise((resolve) => {
      chrome.identity.clearAllCachedAuthTokens(() => {
        console.log('✅ [Admin] 재로그인 전 캐시 제거');
        resolve();
      });
    });
    
    // 현재 토큰 철회
    const token = await getAuthToken(false);
    if (token) {
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
      await new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, resolve);
      });
    }
    
    // 잠시 대기 후 로그인
    await new Promise(r => setTimeout(r, 500));
    handleLogin();
  });
}

/**
 * 메인 앱 렌더링
 */
function renderApp() {
  const stats = getStats();
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const pageUsers = filteredUsers.slice(startIdx, endIdx);
  const totalPages = Math.ceil(filteredUsers.length / pageSize);
  
  const app = document.getElementById('app');
  app.innerHTML = `
    <!-- 헤더 -->
    <div class="header">
      <div class="header-left">
        <span class="logo">📝</span>
        <h1>네이버 블로그 변환기 관리자</h1>
      </div>
      <div class="header-right">
        <span class="admin-badge">👑 MASTER</span>
        <span class="admin-email">${currentAdmin.email}</span>
        <button class="logout-btn" id="logoutBtn">로그아웃</button>
      </div>
    </div>
    
    <!-- 통계 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="label">전체 사용자</div>
        <div class="value blue">${stats.total}</div>
      </div>
      <div class="stat-card">
        <div class="label">오늘 활성</div>
        <div class="value green">${stats.todayActive}</div>
      </div>
      <div class="stat-card">
        <div class="label">Pro 사용자</div>
        <div class="value purple">${stats.pros}</div>
      </div>
      <div class="stat-card">
        <div class="label">Master 사용자</div>
        <div class="value orange">${stats.masters}</div>
      </div>
    </div>
    
    <!-- 메인 패널 -->
    <div class="main-panel">
      <!-- 탭 -->
      <div class="tabs">
        <div class="tab ${currentTab === 'users' ? 'active' : ''}" data-tab="users">👥 사용자 관리</div>
        <div class="tab ${currentTab === 'notice' ? 'active' : ''}" data-tab="notice">📢 공지사항</div>
      </div>
      
      ${currentTab === 'users' ? `
      <!-- 툴바 -->
      <div class="toolbar">
        <div class="search-box">
          <span>🔍</span>
          <input type="text" placeholder="이메일 또는 이름으로 검색..." 
                 value="${searchQuery}" id="searchInput">
        </div>
        
        <div class="filter-group">
          <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">전체</button>
          <button class="filter-btn ${currentFilter === 'master' ? 'active' : ''}" data-filter="master">Master</button>
          <button class="filter-btn ${currentFilter === 'pro' ? 'active' : ''}" data-filter="pro">Pro</button>
          <button class="filter-btn ${currentFilter === 'free' ? 'active' : ''}" data-filter="free">Free</button>
        </div>
        
        <button class="refresh-btn" id="refreshBtn">
          🔄 새로고침
        </button>
      </div>
      
      <!-- 테이블 -->
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>사용자</th>
              <th>플랜</th>
              <th>오늘 사용량</th>
              <th>총 사용량</th>
              <th>마지막 로그인</th>
              <th>메모</th>
              <th>액션</th>
            </tr>
          </thead>
          <tbody id="userTableBody">
            ${pageUsers.length === 0 ? `
              <tr>
                <td colspan="7">
                  <div class="empty-state">
                    <div class="icon">📭</div>
                    <p>사용자가 없습니다</p>
                  </div>
                </td>
              </tr>
            ` : pageUsers.map(user => renderUserRow(user)).join('')}
          </tbody>
        </table>
      </div>
      
      <!-- 페이지네이션 -->
      ${totalPages > 1 ? `
        <div class="pagination" id="pagination">
          <button class="page-btn" data-page="${currentPage - 1}" 
                  ${currentPage === 1 ? 'disabled' : ''}>이전</button>
          ${renderPagination(totalPages)}
          <button class="page-btn" data-page="${currentPage + 1}" 
                  ${currentPage === totalPages ? 'disabled' : ''}>다음</button>
        </div>
      ` : ''}
      ` : `
        <div style="padding: 24px;">
          <!-- 새 공지 등록 -->
          <div style="background:#f8f9ff; border:1px solid #e0e4ff; border-radius:12px; padding:20px; margin-bottom:24px;">
            <h3 style="font-size:16px; color:#1f2937; margin-bottom:16px;">📝 새 공지 등록</h3>
            <div class="form-group">
              <label>공지 제목</label>
              <input type="text" id="noticeTitle" placeholder="예: 프로플랜 출시">
            </div>
            <div class="form-group">
              <label>공지 내용</label>
              <textarea id="noticeMessage" rows="3" placeholder="공지 내용을 입력하세요. URL은 자동 링크됩니다."></textarea>
            </div>
            <button class="btn btn-primary" id="noticeSaveBtn">📢 공지 등록</button>
          </div>

          <!-- 공지 목록 -->
          <h3 style="font-size:16px; color:#1f2937; margin-bottom:12px;">📋 공지 목록 (${noticeList.length}개)</h3>
          ${noticeList.length === 0 ? `
            <div style="text-align:center; padding:40px; color:#6b7280;">
              <div style="font-size:40px; margin-bottom:12px;">📭</div>
              <p>등록된 공지가 없습니다.</p>
            </div>
          ` : noticeList.map(n => `
            <div style="background:${n.active ? '#f0fdf4' : '#fff'}; border:1px solid ${n.active ? '#86efac' : '#e5e7eb'}; border-radius:10px; padding:16px; margin-bottom:10px; position:relative;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                <div style="flex:1;">
                  <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                    ${n.active ? '<span style="background:#22c55e; color:#fff; font-size:11px; font-weight:600; padding:2px 8px; border-radius:4px;">활성</span>' : '<span style="background:#e5e7eb; color:#6b7280; font-size:11px; font-weight:600; padding:2px 8px; border-radius:4px;">비활성</span>'}
                    <span style="font-weight:600; color:#1f2937;">${n.title}</span>
                  </div>
                  <p style="font-size:13px; color:#4b5563; line-height:1.5; margin-bottom:6px;">${n.message}</p>
                  <span style="font-size:11px; color:#9ca3af;">${n.createdAt ? new Date(n.createdAt).toLocaleString('ko-KR') : ''}</span>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0;">
                  <button class="action-btn edit notice-toggle-btn" data-notice-id="${n.id}" style="font-size:11px;">
                    ${n.active ? '🔕 비활성' : '🔔 활성화'}
                  </button>
                  <button class="action-btn delete notice-delete-btn" data-notice-id="${n.id}" style="font-size:11px;">
                    🗑️ 삭제
                  </button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
  
  // 이벤트 리스너 등록
  attachEventListeners();
}

/**
 * 이벤트 리스너 등록
 */
function attachEventListeners() {
  // 로그아웃 버튼
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
  
  // 검색 입력
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      applyFilter();
      renderApp();
    });
  }
  
  // 필터 버튼들
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      applyFilter();
      renderApp();
    });
  });
  
  // 새로고침 버튼
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refresh);
  }
  
  // 편집 버튼들
  const editBtns = document.querySelectorAll('.edit-btn');
  editBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      editUser(btn.dataset.email);
    });
  });
  
  // 페이지네이션 버튼들
  const pageBtns = document.querySelectorAll('.page-btn[data-page]');
  pageBtns.forEach(btn => {
    if (!btn.disabled) {
      btn.addEventListener('click', () => {
        const page = parseInt(btn.dataset.page);
        goToPage(page);
      });
    }
  });
  
  // 모달 닫기 버튼
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeModal);
  }
  
  // 모달 취소 버튼
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  if (modalCancelBtn) {
    modalCancelBtn.addEventListener('click', closeModal);
  }
  
  // 모달 저장 버튼
  const modalSaveBtn = document.getElementById('modalSaveBtn');
  if (modalSaveBtn) {
    modalSaveBtn.addEventListener('click', saveUser);
  }
  
  // 사용량 초기화 버튼
  const resetUsageBtn = document.getElementById('resetUsageBtn');
  if (resetUsageBtn) {
    resetUsageBtn.addEventListener('click', resetTodayUsage);
  }

  // 탭 클릭
  const tabs = document.querySelectorAll('.tab[data-tab]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      currentTab = tab.dataset.tab;
      renderApp();
    });
  });

  // 공지 등록
  const noticeSaveBtn = document.getElementById('noticeSaveBtn');
  if (noticeSaveBtn) {
    noticeSaveBtn.addEventListener('click', saveNotice);
  }

  // 공지 활성/비활성 토글
  document.querySelectorAll('.notice-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleNoticeActive(btn.dataset.noticeId);
    });
  });

  // 공지 삭제
  document.querySelectorAll('.notice-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteNotice(btn.dataset.noticeId);
    });
  });
}

/**
 * 사용자 행 렌더링
 */
/**
 * 사용자 행 렌더링
 */
function renderUserRow(user) {
  const isUnlimited = user.limit === -1 || isInUnlimitedPeriod(user) || user.plan === 'pro' || user.plan === 'master';
  const usagePercent = isUnlimited ? 0 : Math.min(100, (user.todayCount / user.limit) * 100);
  const usageClass = usagePercent >= 100 ? 'danger' : usagePercent >= 70 ? 'warning' : '';
  
  const planBadge = {
    master: '<span class="badge master">👑 Master</span>',
    pro: '<span class="badge pro">⭐ Pro</span>',
    free: '<span class="badge free">Free</span>'
  }[user.plan] || '<span class="badge free">Free</span>';
  
  const lastLogin = user.lastLoginAt ? formatDate(user.lastLoginAt) : '-';
  const memoText = user.memo ? user.memo : '-';
  
  return `
    <tr>
      <td>
        <div class="user-cell">
          <img class="user-avatar" src="${user.photoURL || ''}" 
               onerror="this.style.background='#e5e7eb'">
          <div class="user-info">
            <div class="email">${user.email}</div>
            <div class="name">${user.displayName || '-'}</div>
          </div>
        </div>
      </td>
      <td>${planBadge}</td>
      <td>
        ${isUnlimited ? `
          <span class="badge active">무제한</span>
        ` : `
          <div class="usage-bar">
            <div class="fill ${usageClass}" style="width: ${usagePercent}%"></div>
          </div>
          <div class="usage-text">${user.todayCount} / ${user.limit}</div>
        `}
      </td>
      <td>${user.totalCount || 0}회</td>
      <td>${lastLogin}</td>
      <td class="memo-cell" title="${memoText}">${memoText.length > 20 ? memoText.substring(0, 20) + '...' : memoText}</td>
      <td>
        <div class="action-btns">
          <button class="action-btn edit edit-btn" data-email="${user.email}">✏️ 편집</button>
        </div>
      </td>
    </tr>
  `;
}

/**
 * 페이지네이션 렌더링
 */
function renderPagination(totalPages) {
  let html = '';
  const maxVisible = 5;
  let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);
  
  if (end - start < maxVisible - 1) {
    start = Math.max(1, end - maxVisible + 1);
  }
  
  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }
  
  return html;
}

/**
 * 무제한 기간 체크
 */
function isInUnlimitedPeriod(user) {
  if (!user.unlimitedStart || !user.unlimitedEnd) return false;
  
  const today = new Date().toISOString().split('T')[0];
  return today >= user.unlimitedStart && today <= user.unlimitedEnd;
}

/**
 * 날짜 포맷
 */
function formatDate(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return '방금 전';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}일 전`;
  
  return date.toLocaleDateString('ko-KR');
}

/**
 * 페이지 이동
 */
function goToPage(page) {
  const totalPages = Math.ceil(filteredUsers.length / pageSize);
  if (page >= 1 && page <= totalPages) {
    currentPage = page;
    renderApp();
  }
}

/**
 * 새로고침
 */
async function refresh() {
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '로딩 중...';
  }
  
  showToast('새로고침 중...');
  
  try {
    await loadUsers();
    renderApp();
    showToast('새로고침 완료!', 'success');
  } catch (error) {
    console.error('새로고침 실패:', error);
    showToast('새로고침 실패', 'error');
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '🔄 새로고침';
    }
  }
}

/**
 * 사용자 편집 모달 열기
 */
/**
 * 사용자 편집 모달 열기
 */
function editUser(email) {
  // users 배열에서 최신 데이터 찾기
  editingUser = users.find(u => u.email === email);
  if (!editingUser) {
    showToast('사용자를 찾을 수 없습니다.', 'error');
    return;
  }
  
  // 모달 필드에 값 설정
  document.getElementById('modalEmail').value = editingUser.email;
  document.getElementById('modalPlan').value = editingUser.plan || 'free';
  document.getElementById('modalLimit').value = (editingUser.limit || 3).toString();
  document.getElementById('modalUnlimitedStart').value = editingUser.unlimitedStart || '';
  document.getElementById('modalUnlimitedEnd').value = editingUser.unlimitedEnd || '';
  document.getElementById('modalMemo').value = editingUser.memo || '';
  
  // 모달 표시
  document.getElementById('editModal').classList.add('show');
  
  // 모달 내 버튼 이벤트 재등록
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  if (modalCloseBtn) modalCloseBtn.onclick = closeModal;
  
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  if (modalCancelBtn) modalCancelBtn.onclick = closeModal;
  
  const modalSaveBtn = document.getElementById('modalSaveBtn');
  if (modalSaveBtn) modalSaveBtn.onclick = saveUser;
  
  const resetUsageBtn = document.getElementById('resetUsageBtn');
  if (resetUsageBtn) resetUsageBtn.onclick = resetTodayUsage;
}

/**
 * 모달 닫기
 */
function closeModal() {
  document.getElementById('editModal').classList.remove('show');
  editingUser = null;
}

/**
 * 오늘 사용량 초기화
 */
/**
 * 오늘 사용량 초기화
 */
async function resetTodayUsage() {
  if (!editingUser) return;
  
  // 이메일 미리 저장
  const targetEmail = editingUser.email;
  
  const resetBtn = document.getElementById('resetUsageBtn');
  resetBtn.disabled = true;
  resetBtn.textContent = '초기화 중...';
  
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${encodeURIComponent(targetEmail)}`;
    
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
    
    // todayCount를 0으로
    const updateFields = {
      email: stringField(existingFields.email?.stringValue || targetEmail),
      displayName: stringField(existingFields.displayName?.stringValue || ''),
      photoURL: stringField(existingFields.photoURL?.stringValue || ''),
      createdAt: stringField(existingFields.createdAt?.stringValue || new Date().toISOString()),
      lastLoginAt: stringField(existingFields.lastLoginAt?.stringValue || new Date().toISOString()),
      todayCount: intField(0),
      totalCount: intField(existingFields.totalCount?.integerValue || 0),
      plan: stringField(existingFields.plan?.stringValue || 'free'),
      limit: intField(existingFields.limit?.integerValue || 3),
      unlimitedStart: stringField(existingFields.unlimitedStart?.stringValue || ''),
      unlimitedEnd: stringField(existingFields.unlimitedEnd?.stringValue || ''),
      memo: stringField(existingFields.memo?.stringValue || '')
    };
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: updateFields })
    });
    
    if (!response.ok) {
      throw new Error('초기화 실패');
    }
    
    console.log('✅ [Admin] Firestore 사용량 초기화 완료:', targetEmail);
    
    // 로컬 users 배열 업데이트
    const userIndex = users.findIndex(u => u.email === targetEmail);
    if (userIndex !== -1) {
      users[userIndex].todayCount = 0;
    }
    
    // editingUser 업데이트
    if (editingUser) {
      editingUser.todayCount = 0;
    }
    
    showToast('사용량 초기화 완료!', 'success');
    
    // 필터 다시 적용하고 화면 갱신
    applyFilter();
    renderApp();
    
    // 모달 다시 열기
    setTimeout(() => {
      editUser(targetEmail);
    }, 100);
    
  } catch (error) {
    console.error('❌ [Admin] 초기화 실패:', error);
    showToast('초기화 실패: ' + error.message, 'error');
  } finally {
    const btn = document.getElementById('resetUsageBtn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 초기화';
    }
  }
}

/**
 * 사용자 저장
 */
async function saveUser() {
  if (!editingUser) return;
  
  const plan = document.getElementById('modalPlan').value || 'free';
  const limit = parseInt(document.getElementById('modalLimit').value) || 3;
  const unlimitedStart = document.getElementById('modalUnlimitedStart').value || '';
  const unlimitedEnd = document.getElementById('modalUnlimitedEnd').value || '';
  const memo = document.getElementById('modalMemo').value || '';
  
  // 저장할 이메일 미리 저장 (closeModal 전에)
  const targetEmail = editingUser.email;
  
  const saveBtn = document.getElementById('modalSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';
  
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/users/${encodeURIComponent(targetEmail)}`;
    
    // 기존 문서 가져오기
    const getResponse = await fetch(url);
    let existingFields = {};
    
    if (getResponse.ok) {
      const existingDoc = await getResponse.json();
      existingFields = existingDoc.fields || {};
    }
    
    // 안전하게 필드 생성
    const stringField = (value) => ({ stringValue: value || '' });
    const intField = (value) => ({ integerValue: parseInt(value) || 0 });
    
    // 업데이트할 필드
    const updateFields = {
      email: stringField(targetEmail),
      displayName: stringField(existingFields.displayName?.stringValue || ''),
      photoURL: stringField(existingFields.photoURL?.stringValue || ''),
      createdAt: stringField(existingFields.createdAt?.stringValue || new Date().toISOString()),
      lastLoginAt: stringField(existingFields.lastLoginAt?.stringValue || new Date().toISOString()),
      todayCount: intField(existingFields.todayCount?.integerValue || 0),
      totalCount: intField(existingFields.totalCount?.integerValue || 0),
      plan: stringField(plan),
      limit: intField(limit),
      unlimitedStart: stringField(unlimitedStart),
      unlimitedEnd: stringField(unlimitedEnd),
      memo: stringField(memo)
    };
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: updateFields })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [Admin] Firestore 에러:', errorText);
      throw new Error('저장 실패');
    }
    
    console.log('✅ [Admin] 사용자 저장 완료:', targetEmail);
    
    // 로컬 users 배열 업데이트
    const userIndex = users.findIndex(u => u.email === targetEmail);
    if (userIndex !== -1) {
      users[userIndex].plan = plan;
      users[userIndex].limit = limit;
      users[userIndex].unlimitedStart = unlimitedStart;
      users[userIndex].unlimitedEnd = unlimitedEnd;
      users[userIndex].memo = memo;
    }
    
    showToast('저장 완료!', 'success');
    
    // 모달 닫기 (맨 마지막에)
    closeModal();
    
    // 필터 다시 적용하고 화면 갱신
    applyFilter();
    renderApp();
    
  } catch (error) {
    console.error('❌ [Admin] 저장 실패:', error);
    showToast('저장 실패: ' + error.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 저장';
    }
  }
}

/**
 * 토스트 표시
 */
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}


// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', init);
