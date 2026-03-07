// capture.js - 캡처 전용 페이지 스크립트
(function() {
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'renderHtml') {
      document.open();
      document.write(request.html);
      document.close();

      setTimeout(function() {
        document.fonts.ready.then(function() {
          sendResponse({
            ready: true,
            scrollHeight: document.documentElement.scrollHeight,
            clientHeight: window.innerHeight
          });
        });
      }, 2000);

      return true; // 비동기 응답
    }

    if (request.action === 'scrollTo') {
      window.scrollTo(0, request.y);
      sendResponse({ done: true });
      return;
    }
  });
})();
