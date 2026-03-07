// injected.js - 페이지 컨텍스트에서 실행되는 스크립트
(function() {
  'use strict';

  console.log('✅ [Injected] 네이버 블로그 변환기 주입 스크립트 로드됨');

  window.addEventListener('nbc_request', function(event) {
    const { action, data, requestId } = event.detail;
    console.log('📨 [Injected] 요청 수신:', action, requestId);

    if (action === 'checkEditor') {
      sendResponse(requestId, checkNaverEditor(), null);
    } else if (action === 'insertComponents') {
      try {
        var result = insertComponentsToEditor(data.components);
        sendResponse(requestId, result, null);
      } catch (e) {
        sendResponse(requestId, null, e.message);
      }
    } else if (action === 'screenshotAndUpload') {
      handleScreenshotAndUpload(data, requestId);
    } else if (action === 'fullPageScreenshot') {
      handleFullPageScreenshot(data, requestId);
    }
  });

  function sendResponse(requestId, result, error) {
    window.dispatchEvent(new CustomEvent('nbc_response', {
      detail: { requestId, result, error }
    }));
  }

  function checkNaverEditor() {
    const mainFrame = document.querySelector('iframe[name="mainFrame"]');
    if (mainFrame && mainFrame.contentWindow) {
      try {
        const SE = mainFrame.contentWindow.SE;
        if (SE && SE.launcher && SE.launcher._editors && SE.launcher._editors.blogpc001) {
          return { found: true, location: 'iframe' };
        }
      } catch (e) {}
    }
    if (typeof SE !== 'undefined' && SE.launcher && SE.launcher._editors) {
      return { found: true, location: 'main' };
    }
    return { found: false };
  }

  function generateSeUuid() {
    return 'SE-' + (crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      }));
  }

  function createEmptyTextComponent() {
    return {
      id: generateSeUuid(), layout: 'default',
      value: [{ id: generateSeUuid(), nodes: [{ id: generateSeUuid(), value: '', '@ctype': 'textNode' }],
        style: { align: 'left', lineHeight: 1.8, '@ctype': 'paragraphStyle' }, '@ctype': 'paragraph' }],
      '@ctype': 'text'
    };
  }

  function insertComponentsToEditor(components) {
    if (!components || components.length === 0) throw new Error('삽입할 컴포넌트가 없습니다.');

    var SE_ref = null;
    var mainFrame = document.querySelector('iframe[name="mainFrame"]');
    if (mainFrame && mainFrame.contentWindow) { try { SE_ref = mainFrame.contentWindow.SE; } catch (e) {} }
    if (!SE_ref && typeof SE !== 'undefined') SE_ref = SE;
    if (!SE_ref || !SE_ref.launcher || !SE_ref.launcher._editors) throw new Error('SE 에디터를 찾을 수 없습니다.');

    var editor = SE_ref.launcher._editors.blogpc001;
    if (!editor) {
      var keys = Object.keys(SE_ref.launcher._editors);
      if (keys.length > 0) editor = SE_ref.launcher._editors[keys[0]];
    }
    if (!editor) throw new Error('에디터 인스턴스를 찾을 수 없습니다.');

    var data = editor.getDocumentData();
    var existing = data.document.components || [];

    var pos = null;
    try { if (editor._virtualEditable && typeof editor._virtualEditable.getCurrentCursorPosition === 'function') pos = editor._virtualEditable.getCurrentCursorPosition(); } catch (e) {}
    var compId = pos && pos.start && pos.start.compId;
    var compIndex = compId != null ? existing.findIndex(function(c) { return c.id === compId; }) : -1;
    var cursorInBody = compIndex >= 1;

    var newComponents;
    if (cursorInBody) {
      var idx = compIndex + 1;
      newComponents = existing.slice(0, idx).concat(components, existing.slice(idx));
    } else {
      newComponents = existing.concat([createEmptyTextComponent()], components);
    }

    var foundRepresent = false;
    newComponents.forEach(function(c) {
      if (c['@ctype'] === 'image') {
        c.represent = !foundRepresent;
        foundRepresent = true;
      }
    });

    data.document.components = newComponents;
    editor.setDocumentData(data);

    return { success: true, inputCount: components.length, totalCount: newComponents.length, insertedAt: cursorInBody ? 'cursor' : 'end' };
  }

  var html2canvasLoaded = false;

  function ensureHtml2Canvas() {
    if (html2canvasLoaded || typeof html2canvas !== 'undefined') {
      html2canvasLoaded = true;
      return Promise.resolve();
    }
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = function() { html2canvasLoaded = true; resolve(); };
      s.onerror = function() { reject(new Error('html2canvas 로드 실패')); };
      document.head.appendChild(s);
    });
  }

  function uploadBlob(sessionKey, blogId, blob, fileName) {
    var url = 'https://blog.upphoto.naver.com/' + sessionKey +
      '/simpleUpload/0?userId=' + blogId +
      '&extractExif=true&extractAnimatedCnt=false&extractAnimatedInfo=true' +
      '&autorotate=true&extractDominantColor=false&type=&customQuery=' +
      '&denyAnimatedImage=false&skipXcamFiltering=false';
    var fd = new FormData(); fd.append('image', blob, fileName);
    return new Promise(function(res, rej) {
      var x = new XMLHttpRequest();
      x.open('POST', url); x.withCredentials = true;
      x.onload = function() {
        if (x.status !== 200) { rej(new Error('업로드 ' + x.status)); return; }
        var r = x.responseText, u = r.match(/<url>([^<]+)<\/url>/);
        if (!u) { rej(new Error('파싱 실패')); return; }
        res({
          url: u[1], path: u[1],
          width: parseInt((r.match(/<width>(\d+)<\/width>/) || [0, 0])[1]),
          height: parseInt((r.match(/<height>(\d+)<\/height>/) || [0, 0])[1]),
          fileSize: parseInt((r.match(/<fileSize>(\d+)<\/fileSize>/) || [0, 0])[1]),
          fileName: (r.match(/<fileName>([^<]+)<\/fileName>/) || [0, fileName])[1]
        });
      };
      x.onerror = function() { rej(new Error('네트워크 에러')); };
      x.send(fd);
    });
  }

  async function waitCDN(url, max) {
    for (var i = 0; i < (max || 8); i++) {
      await new Promise(function(r) { setTimeout(r, 1500); });
      try { var h = await fetch(url, { method: 'HEAD' }); if (h.status === 200) return true; } catch (e) {}
    }
    return false;
  }

  function makeImageComponent(info) {
    var domain = 'https://blogfiles.pstatic.net';
    var dw = Math.min(info.width, 700), dh = Math.round(info.height * dw / info.width);
    return {
      id: generateSeUuid(), layout: 'default', src: domain + info.url + '?type=w1',
      internalResource: true, represent: false, path: info.path, domain: domain,
      fileSize: info.fileSize, width: dw, widthPercentage: 0, height: dh,
      originalWidth: info.width, originalHeight: info.height, fileName: info.fileName,
      caption: null, format: 'normal', displayFormat: 'normal', imageLoaded: true,
      contentMode: 'fit', origin: { srcFrom: 'local', '@ctype': 'imageOrigin' },
      ai: false, '@ctype': 'image'
    };
  }

  async function handleScreenshotAndUpload(data, requestId) {
    try {
      await ensureHtml2Canvas();
      var htmlStr = data.htmlStr;
      var fileName = data.fileName || 'section.png';
      var bgColor = data.bgColor || '#0a0a0f';
      var sessionKey = data.sessionKey;
      var blogId = data.blogId;

      var wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:99999;width:700px;overflow:visible;';
      var bodyMatch = htmlStr.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      var styleMatch = htmlStr.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];
      var linkMatch = htmlStr.match(/<link[^>]*>/gi) || [];
      if (styleMatch.length > 0 || linkMatch.length > 0) {
        var sc = document.createElement('div'); sc.innerHTML = styleMatch.join('\n') + linkMatch.join('\n');
        wrapper.appendChild(sc);
      }
      var cd = document.createElement('div');
      cd.innerHTML = bodyMatch ? bodyMatch[1] : htmlStr;
      wrapper.appendChild(cd);
      document.body.appendChild(wrapper);

      await new Promise(function(r) { setTimeout(r, 1200); });
      var target = cd.firstElementChild || cd;
      if (target.offsetHeight === 0) target = cd;

      var canvas = await html2canvas(target, {
        backgroundColor: bgColor, scale: 2, useCORS: true, allowTaint: true, logging: false,
        width: 700, height: Math.max(target.offsetHeight, 100)
      });
      document.body.removeChild(wrapper);

      var blob = await new Promise(function(r) { canvas.toBlob(r, 'image/png'); });
      if (!blob) throw new Error('캡처 실패');

      var info = await uploadBlob(sessionKey, blogId, blob, fileName);
      var src = 'https://blogfiles.pstatic.net' + info.url + '?type=w1';
      await waitCDN(src, 8);

      var comp = makeImageComponent(info);
      sendResponse(requestId, {
        success: true, component: comp,
        blobSize: blob.size, canvasWidth: canvas.width, canvasHeight: canvas.height
      }, null);
    } catch (e) {
      console.error('❌ [Injected] 스크린샷 에러:', e);
      sendResponse(requestId, null, e.message);
    }
  }

  async function handleFullPageScreenshot(data, requestId) {
    try {
      await ensureHtml2Canvas();
      var htmlStr = data.htmlStr;
      var sessionKey = data.sessionKey;
      var blogId = data.blogId;

      var wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:99999;width:700px;overflow:visible;';
      var bodyMatch = htmlStr.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      var styleMatch = htmlStr.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];
      var linkMatch = htmlStr.match(/<link[^>]*>/gi) || [];
      if (styleMatch.length > 0 || linkMatch.length > 0) {
        var sc = document.createElement('div'); sc.innerHTML = styleMatch.join('\n') + linkMatch.join('\n');
        wrapper.appendChild(sc);
      }
      var cd = document.createElement('div');
      cd.innerHTML = bodyMatch ? bodyMatch[1] : htmlStr;
      wrapper.appendChild(cd);
      document.body.appendChild(wrapper);

      await new Promise(function(r) { setTimeout(r, 1500); });

      var canvas = await html2canvas(cd, {
        backgroundColor: data.bgColor || '#ffffff', scale: 2, useCORS: true, allowTaint: true,
        logging: false, width: 700
      });
      document.body.removeChild(wrapper);

      var blob = await new Promise(function(r) { canvas.toBlob(r, 'image/png'); });
      if (!blob) throw new Error('캡처 실패');

      var info = await uploadBlob(sessionKey, blogId, blob, 'full-page.png');
      var src = 'https://blogfiles.pstatic.net' + info.url + '?type=w1';
      await waitCDN(src, 10);

      var comp = makeImageComponent(info);
      sendResponse(requestId, {
        success: true, component: comp,
        blobSize: blob.size, canvasWidth: canvas.width, canvasHeight: canvas.height
      }, null);
    } catch (e) {
      console.error('❌ [Injected] 전체 캡처 에러:', e);
      sendResponse(requestId, null, e.message);
    }
  }

  console.log('✅ [Injected] 이벤트 리스너 등록 완료 (스크린샷 파이프라인 포함)');
})();
