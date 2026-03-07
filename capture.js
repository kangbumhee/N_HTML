(function() {
  // document.write 대신 iframe 사용으로 리스너 유지
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'renderHtml') {
      var iframe = document.getElementById('render-frame');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'render-frame';
        iframe.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;margin:0;padding:0;';
        document.body.innerHTML = '';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.body.style.overflow = 'hidden';
        document.body.appendChild(iframe);
      }

      iframe.srcdoc = request.html;

      iframe.onload = function() {
        setTimeout(function() {
          try {
            var iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            var scrollH = iframeDoc.documentElement.scrollHeight;
            iframe.style.height = scrollH + 'px';
            document.body.style.overflow = 'auto';
            document.documentElement.style.overflow = 'auto';

            sendResponse({
              ok: true,
              scrollHeight: scrollH,
              clientHeight: window.innerHeight
            });
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
        }, 2500);
      };

      return true; // 비동기 응답
    }

    if (request.action === 'scrollTo') {
      window.scrollTo(0, request.y);
      sendResponse({ ok: true });
      return;
    }

    if (request.action === 'getDimensions') {
      var iframe = document.getElementById('render-frame');
      var scrollH = 0;
      if (iframe) {
        try {
          scrollH = iframe.contentDocument.documentElement.scrollHeight;
        } catch (e) {
          scrollH = iframe.offsetHeight;
        }
      }
      sendResponse({
        scrollHeight: Math.max(scrollH, document.documentElement.scrollHeight),
        clientHeight: window.innerHeight
      });
      return;
    }
  });

  chrome.runtime.sendMessage({ action: 'capturePageLoaded' });
})();
