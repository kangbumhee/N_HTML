// injected.js - 페이지 컨텍스트에서 실행되는 스크립트

(function() {
  'use strict';
  
  console.log('✅ [Injected] 네이버 블로그 변환기 주입 스크립트 로드됨');
  
  // content.js로부터 메시지 수신
  window.addEventListener('nbc_request', function(event) {
    const { action, data, requestId } = event.detail;
    console.log('📨 [Injected] 요청 수신:', action, requestId);
    
    let result = null;
    let error = null;
    
    try {
      if (action === 'checkEditor') {
        result = checkNaverEditor();
      } else if (action === 'insertComponents') {
        result = insertComponentsToEditor(data.components);
      }
    } catch (e) {
      error = e.message;
      console.error('❌ [Injected] 에러:', e);
    }
    
    // 결과 전송
    window.dispatchEvent(new CustomEvent('nbc_response', {
      detail: { requestId, result, error }
    }));
  });
  
  /**
   * 네이버 SE 에디터 존재 확인
   */
  function checkNaverEditor() {
    console.log('🔍 [Injected] SE 에디터 체크');
    
    // iframe에서 SE 찾기
    const mainFrame = document.querySelector('iframe[name="mainFrame"]');
    if (mainFrame && mainFrame.contentWindow) {
      try {
        const SE = mainFrame.contentWindow.SE;
        if (SE && SE.launcher && SE.launcher._editors && SE.launcher._editors.blogpc001) {
          console.log('✅ [Injected] iframe에서 SE 발견');
          return { found: true, location: 'iframe' };
        }
      } catch (e) {
        console.log('⚠️ [Injected] iframe 접근 에러:', e.message);
      }
    }
    
    // 메인에서 SE 찾기
    if (typeof SE !== 'undefined' && SE.launcher && SE.launcher._editors) {
      console.log('✅ [Injected] 메인에서 SE 발견');
      return { found: true, location: 'main' };
    }
    
    console.log('❌ [Injected] SE 에디터 없음');
    return { found: false };
  }
  
  /**
   * SE 에디터용 UUID 생성
   */
  function generateSeUuid() {
    return 'SE-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : createFallbackUuid());
  }
  function createFallbackUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 빈 텍스트 컴포넌트 생성 (엔터 한 칸)
   */
  function createEmptyTextComponent() {
    const compId = generateSeUuid();
    const paraId = generateSeUuid();
    const nodeId = generateSeUuid();
    return {
      id: compId,
      layout: 'default',
      value: [{
        id: paraId,
        nodes: [{
          id: nodeId,
          value: '',
          '@ctype': 'textNode'
        }],
        style: { align: 'left', lineHeight: 1.8, '@ctype': 'paragraphStyle' },
        '@ctype': 'paragraph'
      }],
      '@ctype': 'text'
    };
  }

  /**
   * 컴포넌트를 SE 에디터에 삽입 (현재 커서 위치 또는 본문 맨 뒤)
   */
  function insertComponentsToEditor(components) {
    const inputCount = components ? components.length : 0;
    if (!components || inputCount === 0) {
      throw new Error('삽입할 컴포넌트가 없습니다.');
    }

    let SE = null;
    let editor = null;
    const mainFrame = document.querySelector('iframe[name="mainFrame"]');
    if (mainFrame && mainFrame.contentWindow) {
      try {
        SE = mainFrame.contentWindow.SE;
      } catch (e) {}
    }
    if (!SE && typeof window.SE !== 'undefined') {
      SE = window.SE;
    }
    if (!SE || !SE.launcher || !SE.launcher._editors) {
      throw new Error('SE 에디터를 찾을 수 없습니다.');
    }
    editor = SE.launcher._editors.blogpc001;
    if (!editor) {
      const keys = Object.keys(SE.launcher._editors);
      if (keys.length > 0) editor = SE.launcher._editors[keys[0]];
    }
    if (!editor) {
      throw new Error('에디터 인스턴스를 찾을 수 없습니다.');
    }

    const data = editor.getDocumentData();
    const existing = data.document.components || [];

    let pos = null;
    try {
      if (editor._virtualEditable && typeof editor._virtualEditable.getCurrentCursorPosition === 'function') {
        pos = editor._virtualEditable.getCurrentCursorPosition();
      }
    } catch (e) {}

    const compId = pos && pos.start && pos.start.compId;
    const compIndex = compId !== undefined && compId !== null
      ? existing.findIndex(function(c) { return c.id === compId; })
      : -1;

    const cursorInBody = compIndex >= 1;

    let newComponents;
    if (cursorInBody) {
      const insertAtIndex = compIndex + 1;
      newComponents = existing.slice(0, insertAtIndex).concat(components, existing.slice(insertAtIndex));
    } else {
      const emptyLine = createEmptyTextComponent();
      newComponents = existing.concat([emptyLine], components);
    }

    // 첫 번째 이미지를 대표 이미지로 설정
    var foundRepresent = false;
    newComponents.forEach(function(c) {
      if (c['@ctype'] === 'image') {
        if (!foundRepresent) {
          c.represent = true;
          foundRepresent = true;
        } else {
          c.represent = false;
        }
      }
    });

    data.document.components = newComponents;
    editor.setDocumentData(data);

    return {
      success: true,
      inputCount: inputCount,
      totalCount: newComponents.length,
      insertedAt: cursorInBody ? 'cursor' : 'end'
    };
  }
  
  console.log('✅ [Injected] 이벤트 리스너 등록 완료');
})();
