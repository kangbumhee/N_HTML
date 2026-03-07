/**
 * 네이버 블로그 HTML 변환기 - Content Script
 * 
 * 주요 기능:
 * - 플로팅 UI 렌더링 및 관리
 * - HTML → 네이버 SE 에디터 형식 변환
 * - 드래그 이동 및 리사이즈 기능
 * - 사용자 인증 상태 관리
 */

(function() {
  'use strict';
  
  // 중복 주입 방지
  if (window.__naverBlogConverterInitialized) {
    return;
  }
  window.__naverBlogConverterInitialized = true;

  // 컬러 팔레트
  const COLORS = {
    primary: "#5B7FFF",
    primaryHover: "#4A6FEE",
    secondary: "#8B5CF6",
    success: "#22C55E",
    successHover: "#16A34A",
    danger: "#F87171",
    dangerHover: "#EF4444",
    warning: "#FBBF24",
    bgDark: "#1F2937",
    bgCard: "#FFFFFF",
    bgMain: "#F8FAFC",
    textPrimary: "#1F2937",
    textSecondary: "#6B7280",
    textMuted: "#9CA3AF",
    border: "#E5E7EB",
    inputBg: "#F9FAFB"
  };

  // 링크 설정
  const LINKS = {
    kakaoChat: "https://open.kakao.com/o/ssaNogdi",
    proUpgrade: "https://smartstore.naver.com/mumuriri/products/13099849483"
  };

  // EmailJS 설정 (무료: 월 200건)
  const EMAILJS_CONFIG = {
    serviceId: 'service_anhduso',      // EmailJS에서 발급받은 Service ID
    templateId: 'template_j8v2p0m',    // EmailJS에서 발급받은 Template ID  
    publicKey: 'frH_GVbDS8v-gcxmS'     // EmailJS에서 발급받은 Public Key
  };

  // 관리자 이메일
  const ADMIN_EMAIL = 'kbhjjan@gmail.com';

  // UI 상태
  const UI_STATE = {
    NOT_LOGGED_IN: 'NOT_LOGGED_IN',
    LOGGED_IN: 'LOGGED_IN',
    LIMIT_REACHED: 'LIMIT_REACHED'
  };

  // 전역 변수
  let currentState = UI_STATE.NOT_LOGGED_IN;
  let currentUser = null;
  let currentUsage = { count: 0, limit: 3, plan: 'free' };
  let noticeList = []; // 최근 공지 5개
  let activeNotice = null; // 현재 활성 공지
  let noticeExpanded = false; // 드롭다운 열림 여부
  let container = null;
  let isMinimized = false;
  let isDragging = false;
  
  // 원본 HTML 저장 (붙여넣기 시 캡처)
  let originalPastedHtml = '';
  let originalPastedText = '';
  let isResizing = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;
  let resizeDirection = '';

  /**
   * UUID 생성 (SE 에디터용)
   */
  // ========== HTML 파싱 관련 함수들 (순서 중요!) ==========

  /**
   * 1. UUID 생성
   */
  function generateSeUuid() {
    return 'SE-' + crypto.randomUUID();
  }

  /**
   * 2. 스타일 문자열 파싱
   */
  function parseStyleString(styleStr) {
    const style = {};
    if (!styleStr) return style;
    
    const rules = styleStr.split(';');
    rules.forEach(rule => {
      const [prop, value] = rule.split(':').map(s => s?.trim());
      if (prop && value) {
        const camelProp = prop.replace(/-([a-z])/g, g => g[1].toUpperCase());
        style[camelProp] = value;
      }
    });
    
    return style;
  }

  /**
   * 3. CSS 색상을 HEX로 변환
   */
  function colorToHex(color) {
    if (!color) return null;
    
    if (color.startsWith('#')) return color.toUpperCase();
    
    const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
      const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
      const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`.toUpperCase();
    }
    
    const colorMap = {
      'red': '#FF0000', 'blue': '#0000FF', 'green': '#008000',
      'yellow': '#FFFF00', 'orange': '#FFA500', 'purple': '#800080',
      'black': '#000000', 'white': '#FFFFFF', 'gray': '#808080',
      'pink': '#FFC0CB', 'brown': '#A52A2A', 'cyan': '#00FFFF'
    };
    
    return colorMap[color.toLowerCase()] || null;
  }

  /**
   * 4. 폰트 크기를 SE fontSizeCode로 변환 (fs17~fs23은 테이블 셀에서 11px로 축소되므로 우회)
   */
  function fontSizeToCode(size) {
    if (!size) return 'fs16';
    const px = parseInt(size);
    if (px >= 30) return 'fs30';
    if (px >= 28) return 'fs28';
    if (px >= 26) return 'fs26';
    if (px >= 24) return 'fs24';
    if (px >= 16) return 'fs16';
    if (px >= 15) return 'fs15';
    if (px >= 13) return 'fs13';
    return 'fs11';
  }

  /**
   * 5. 제목 태그를 폰트 크기로 변환
   */
  function headingToFontSize(tagName) {
    const map = {
      'H1': 'fs28', 'H2': 'fs24', 'H3': 'fs24',
      'H4': 'fs16', 'H5': 'fs16', 'H6': 'fs15'
    };
    return map[tagName.toUpperCase()] || 'fs16';
  }

  /**
   * 5-1. 색상 밝기 판별 (다크 테마 감지용)
   */
  function isColorDark(color) {
    let hex = colorToHex(color);
    if (!hex) return false;
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 60;
  }

  /**
   * 5-2. CSS 변수 추출 (:root)
   */
  function extractCssVars(html) {
    const vars = {};
    const rootMatch = html.match(/:root\s*\{([^}]+)\}/);
    if (rootMatch) {
      rootMatch[1].split(';').forEach(rule => {
        const parts = rule.split(':').map(s => s.trim());
        if (parts.length === 2 && parts[0].startsWith('--')) {
          vars[parts[0]] = parts[1];
        }
      });
    }
    return vars;
  }

  /**
   * 5-3. CSS 변수를 실제 값으로 치환
   */
  function resolveCssVar(value, vars) {
    if (!value) return value;
    return value.replace(/var\(([^)]+)\)/g, (match, varName) => {
      return vars[varName.trim()] || match;
    });
  }

  /**
   * 5-4. 테마 감지 (다크/라이트/플레인)
   */
  function detectTheme(html) {
    const vars = extractCssVars(html);

    function tryHex(val) {
      if (!val) return null;
      val = val.trim();
      if (val.startsWith('#')) return val;
      var m = val.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
      if (m) return '#' + [m[1], m[2], m[3]].map(function(x) { return ('0' + parseInt(x).toString(16)).slice(-2); }).join('');
      return colorToHex(val);
    }

    function getBodyBg() {
      var m1 = html.match(/body\s*\{[^}]*?background-color\s*:\s*([^;}\s]+)/);
      if (m1) {
        var resolved = resolveCssVar(m1[1], vars);
        var hex = tryHex(resolved);
        if (hex) return hex;
      }
      var m2 = html.match(/body\s*\{[^}]*?background\s*:\s*([^;}\s]+)/);
      if (m2) {
        var resolved2 = resolveCssVar(m2[1], vars);
        var hex2 = tryHex(resolved2);
        if (hex2) return hex2;
      }
      return null;
    }

    var bgFromVar = vars['--bg'] ? tryHex(resolveCssVar(vars['--bg'], vars)) : null;
    var bgFromBody = getBodyBg();
    var bg = bgFromVar || bgFromBody || null;
    if (bg) vars['--bg'] = bg;

    if (bg && isColorDark(bg)) {
      return { type: 'dark', vars: vars, bgColor: bg };
    }

    var hasVars = Object.keys(vars).length > 0;
    var hasStyleTag = /<style[\s>]/i.test(html);
    var hasStyledClasses = /\.hero|\.disclaimer|\.quote|\.cta|\.timeline|\.inv-group|\.table-wrap/.test(html);

    if (hasVars || hasStyledClasses || hasStyleTag) {
      return { type: 'light', vars: vars, bgColor: bg || '#FFFFFF' };
    }

    return { type: 'plain', vars: vars, bgColor: null };
  }

  /**
   * 5-5. 다크 테마 전용 텍스트 노드 추출 (재귀)
   */
  function extractDarkTextNodes(element, inheritedStyle, cssVars) {
    const nodes = [];
    element.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent;
        if (text && text.trim()) {
          nodes.push(createDarkTextNode(text, inheritedStyle));
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tagName = child.tagName.toUpperCase();
        const childStyle = { ...inheritedStyle };
        const inlineStyle = parseStyleString(child.getAttribute('style'));

        if (tagName === 'STRONG' || tagName === 'B') childStyle.bold = true;
        if (tagName === 'EM' || tagName === 'I') childStyle.italic = true;
        if (tagName === 'U') childStyle.underline = true;
        if (tagName === 'S' || tagName === 'DEL' || tagName === 'STRIKE') childStyle.strikeThrough = true;

        if (inlineStyle.color) {
          const resolved = resolveCssVar(inlineStyle.color, cssVars);
          childStyle.fontColor = colorToHex(resolved);
        }
        if (inlineStyle.fontWeight === 'bold' || parseInt(inlineStyle.fontWeight) >= 600) childStyle.bold = true;
        if (inlineStyle.fontSize) childStyle.fontSize = fontSizeToCode(inlineStyle.fontSize);

        const childNodes = extractDarkTextNodes(child, childStyle, cssVars);
        nodes.push(...childNodes);
      }
    });
    return nodes;
  }

  /**
   * 5-6. 다크 텍스트 노드 생성 (SE 형식, fontColor 사용)
   */
  function createDarkTextNode(text, style) {
    const nodeStyle = {
      "@ctype": "nodeStyle",
      "fontSizeCode": style.fontSize || "fs16",
      "fontFamily": "nanumgothic"
    };
    if (style.bold) nodeStyle.bold = true;
    if (style.italic) nodeStyle.italic = true;
    if (style.underline) nodeStyle.underline = true;
    if (style.strikeThrough) nodeStyle.strikeThrough = true;
    if (style.fontColor) nodeStyle.fontColor = style.fontColor;
    if (style.backgroundColor) nodeStyle.backgroundColor = style.backgroundColor;

    return {
      "@ctype": "textNode",
      "id": generateSeUuid(),
      "value": text,
      "style": nodeStyle
    };
  }

  /**
   * 5-7. 다크 테마 테이블 컴포넌트 생성
   */
  function createDarkTableComponent(rows, cssVars) {
    if (!rows || rows.length === 0) return null;
    const columnCount = rows[0].length;
    const colWidth = Math.floor(100 / columnCount);
    const nB = "border-style:solid;border-width:0px 0px 1px 0px;border-color:" + (cssVars['--border'] || '#252b3b') + ";";
    const headerBg = '#1e2436';
    const cellBg = cssVars['--bg'] || '#0d0f14';
    const accentColor = cssVars['--accent'] || '#4f8ef7';

    return {
      "@ctype": "table",
      "id": generateSeUuid(),
      "layout": "default",
      "width": 100,
      "columnCount": columnCount,
      "borderStyleName": "none",
      "borderInlineStyle": "border-style:none;border-width:0px;border-color:rgb(210,210,210);",
      "rows": rows.map((row, rowIndex) => ({
        "@ctype": "tableRow",
        "id": generateSeUuid(),
        "cells": row.map((cell, colIndex) => ({
          "@ctype": "tableCell",
          "id": generateSeUuid(),
          "colSpan": 1,
          "rowSpan": 1,
          "width": colWidth,
          "height": 36,
          "backgroundColor": rowIndex === 0 ? headerBg : cellBg,
          "borderInlineStyle": nB,
          "value": [{
            "@ctype": "paragraph",
            "id": generateSeUuid(),
            "style": { "@ctype": "paragraphStyle", "align": "left", "lineHeight": 1.6 },
            "nodes": [{
              "@ctype": "textNode",
              "id": generateSeUuid(),
              "value": cell.text || "",
              "style": {
                "@ctype": "nodeStyle",
                "fontSizeCode": "fs15",
                "fontFamily": "nanumgothic",
                "bold": cell.style?.bold || rowIndex === 0,
                "fontColor": rowIndex === 0 ? accentColor : '#c0c4d4'
              }
            }]
          }]
        }))
      }))
    };
  }

  /**
   * 5-8. 다크 경고 박스 생성
   */
  function createDarkWarnBox(text, cssVars) {
    const warnColor = cssVars['--warn'] || '#f7c948';
    return {
      "@ctype": "table",
      "id": generateSeUuid(),
      "layout": "default",
      "align": "left",
      "width": 100,
      "columnCount": 1,
      "borderStyleName": "none",
      "borderInlineStyle": "border-style:none;border-width:0px;border-color:rgb(210,210,210);",
      "rows": [{"@ctype": "tableRow", "id": generateSeUuid(), "cells": [{
        "@ctype": "tableCell",
        "id": generateSeUuid(),
        "colSpan": 1, "rowSpan": 1, "width": 100, "height": 36,
        "backgroundColor": "#1a1e2b",
        "borderInlineStyle": "border-style:solid;border-width:0px 0px 0px 3px;border-color:" + warnColor + ";",
        "value": [{
          "@ctype": "paragraph",
          "id": generateSeUuid(),
          "style": {"@ctype": "paragraphStyle", "align": "left", "lineHeight": 1.6},
          "nodes": [{
            "@ctype": "textNode",
            "id": generateSeUuid(),
            "value": text,
            "style": {"@ctype": "nodeStyle", "fontSizeCode": "fs15", "fontFamily": "nanumgothic", "fontColor": "#c8ccd8"}
          }]
        }]
      }]}]
    };
  }

  /**
   * 5-9. 1열 다크 블록 생성
   */
  function createDarkBlock(paragraphs, cssVars) {
    const bgColor = cssVars['--bg'] || '#0d0f14';
    return {
      "@ctype": "table",
      "id": generateSeUuid(),
      "layout": "default",
      "align": "left",
      "width": 100,
      "columnCount": 1,
      "borderStyleName": "none",
      "borderInlineStyle": "border-style:none;border-width:0px;border-color:rgb(210,210,210);",
      "rows": [{"@ctype": "tableRow", "id": generateSeUuid(), "cells": [{
        "@ctype": "tableCell",
        "id": generateSeUuid(),
        "colSpan": 1, "rowSpan": 1, "width": 100, "height": 43,
        "backgroundColor": bgColor,
        "borderInlineStyle": "border-style:none;border-width:0px;border-color:rgb(210,210,210);",
        "value": paragraphs
      }]}]
    };
  }

  /**
   * 6. 요소에서 정렬 스타일 추출
   */
  function getAlignment(element) {
    const style = element.getAttribute('style') || '';
    if (style.includes('text-align: center') || style.includes('text-align:center')) return 'center';
    if (style.includes('text-align: right') || style.includes('text-align:right')) return 'right';
    return 'left';
  }

  /**
   * 7. 텍스트 노드 생성 (createParagraph보다 먼저!)
   */
  function createTextNode(text, style = {}) {
    const nodeStyle = {
      "@ctype": "nodeStyle",
      "fontSizeCode": style.fontSize || "fs16",
      "fontFamily": style.fontFamily || "nanumgothic"
    };
    
    if (style.bold) nodeStyle.bold = true;
    if (style.italic) nodeStyle.italic = true;
    if (style.underline) nodeStyle.underline = true;
    if (style.strikeThrough) nodeStyle.strikeThrough = true;
    if (style.color) nodeStyle.color = style.color;
    if (style.backgroundColor) nodeStyle.backgroundColor = style.backgroundColor;
    
    const node = {
      "@ctype": "textNode",
      "id": generateSeUuid(),
      "value": text,
      "style": nodeStyle
    };
    
    return node;
  }

  /**
   * 8. 단락(paragraph) 생성
   */
  function createParagraph(nodes, align = 'left') {
    return {
      "@ctype": "paragraph",
      "id": generateSeUuid(),
      "style": {
        "@ctype": "paragraphStyle",
        "align": align,
        "lineHeight": 1.8
      },
      "nodes": nodes.length > 0 ? nodes : [createTextNode(' ')]
    };
  }

  /**
   * 9. 텍스트 컴포넌트 생성
   */
  function createTextComponent(paragraphs) {
    return {
      "@ctype": "text",
      "layout": "default",
      "id": generateSeUuid(),
      "value": Array.isArray(paragraphs) ? paragraphs : [paragraphs]
    };
  }

  /**
   * 10. 구분선 컴포넌트 생성
   */
  function createHorizontalLine() {
    return {
      "@ctype": "horizontalLine",
      "id": generateSeUuid(),
      "layout": "default"
    };
  }

  /**
   * 11. OG 링크 컴포넌트 생성
   */
  function createOgLinkComponent(url, text) {
    // URL에서 도메인 추출
    let domain = '';
    try {
      const urlObj = new URL(url);
      domain = urlObj.hostname.replace('www.', '');
    } catch (e) {
      domain = url;
    }
    
    return {
      "@ctype": "oglink",
      "id": generateSeUuid(),
      "layout": "image",
      "title": text || domain,
      "domain": domain,
      "link": url,
      "thumbnail": null,
      "description": "",
      "video": false
    };
  }

  /**
   * 12. 표 컴포넌트 생성
   */
  function createTableComponent(rows) {
    if (!rows || rows.length === 0) return null;
    
    const columnCount = rows[0].length;
    const colWidth = Math.floor(100 / columnCount);
    
    return {
      "@ctype": "table",
      "id": generateSeUuid(),
      "layout": "default",
      "width": 100,
      "columnCount": columnCount,
      "borderStyleName": "thinLine",
      "rows": rows.map((row, rowIndex) => ({
        "@ctype": "tableRow",
        "id": generateSeUuid(),
        "cells": row.map((cell, colIndex) => ({
          "@ctype": "tableCell",
          "id": generateSeUuid(),
          "colSpan": 1,
          "rowSpan": 1,
          "width": colWidth,
          "height": 43,
          "backgroundColor": rowIndex === 0 ? "#F5F5F5" : null,
          "verticalAlign": "middle",
          "value": [
            {
              "@ctype": "paragraph",
              "id": generateSeUuid(),
              "style": {
                "@ctype": "paragraphStyle",
                "align": "left",
                "lineHeight": 1.8
              },
              "nodes": [
                {
                  "@ctype": "textNode",
                  "id": generateSeUuid(),
                  "value": cell.text || "",
                  "style": {
                    "@ctype": "nodeStyle",
                    "fontSizeCode": "fs16",
                    "fontFamily": "nanumgothic",
                    "bold": cell.style?.bold || rowIndex === 0
                  }
                }
              ]
            }
          ]
        }))
      }))
    };
  }

  /**
   * 12. 요소에서 텍스트 노드들 추출 (재귀)
   */
  function extractTextNodes(element, inheritedStyle = {}) {
    const nodes = [];
    
    element.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent;
        if (text && text.trim()) {
          nodes.push(createTextNode(text, inheritedStyle));
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tagName = child.tagName.toUpperCase();
        const childStyle = { ...inheritedStyle };
        
        const inlineStyle = parseStyleString(child.getAttribute('style'));
        
        if (tagName === 'STRONG' || tagName === 'B') childStyle.bold = true;
        if (tagName === 'EM' || tagName === 'I') childStyle.italic = true;
        if (tagName === 'U') childStyle.underline = true;
        if (tagName === 'S' || tagName === 'DEL' || tagName === 'STRIKE') childStyle.strikeThrough = true;
        
        // A 태그는 텍스트만 추출 (OG 링크는 별도 처리)
        if (tagName === 'A') {
          const childNodes = extractTextNodes(child, childStyle);
          nodes.push(...childNodes);
          return;
        }
        
        if (inlineStyle.color) childStyle.color = colorToHex(inlineStyle.color);
        if (inlineStyle.backgroundColor) childStyle.backgroundColor = colorToHex(inlineStyle.backgroundColor);
        if (inlineStyle.fontWeight === 'bold' || parseInt(inlineStyle.fontWeight) >= 600) childStyle.bold = true;
        if (inlineStyle.fontStyle === 'italic') childStyle.italic = true;
        if (inlineStyle.textDecoration?.includes('underline')) childStyle.underline = true;
        if (inlineStyle.textDecoration?.includes('line-through')) childStyle.strikeThrough = true;
        if (inlineStyle.fontSize) childStyle.fontSize = fontSizeToCode(inlineStyle.fontSize);
        
        const childNodes = extractTextNodes(child, childStyle);
        nodes.push(...childNodes);
      }
    });
    
    return nodes;
  }

  /**
   * 13. 테이블 요소 파싱
   */
  function parseTable(tableElement) {
    const rows = [];
    
    tableElement.querySelectorAll('tr').forEach((tr, rowIndex) => {
      const cells = [];
      
      tr.querySelectorAll('th, td').forEach(cell => {
        const isHeader = cell.tagName === 'TH' || rowIndex === 0;
        
        cells.push({
          text: cell.textContent?.trim() || "",
          style: {
            bold: isHeader
          }
        });
      });
      
      if (cells.length > 0) {
        rows.push(cells);
      }
    });
    
    return rows;
  }

  // ═══════════════════════════════════════════════════════
  //  [확장] HTML 스크린샷 → 이미지 업로드 → SE 이미지 컴포넌트
  // ═══════════════════════════════════════════════════════

  function getBlogId() {
    var m = location.href.match(/blogId=([^&]+)/);
    if (m) return m[1];
    var p = location.pathname.match(/\/([^\/]+)\//);
    return p ? p[1] : null;
  }

  async function getSeToken(blogId) {
    var res = await fetch(
      'https://blog.naver.com/PostWriteFormSeOptions.naver?blogId=' + blogId + '&categoryNo=0',
      { credentials: 'include' }
    );
    var data = await res.json();
    return data.result.token;
  }

  function getUploadSessionKey(seToken) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://platform.editor.naver.com/api/blogpc001/v1/photo-uploader/session-key');
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('Pragma', 'no-cache');
      xhr.setRequestHeader('Se-Authorization', seToken);
      xhr.setRequestHeader('SE-App-Id', 'SE-' + crypto.randomUUID());
      xhr.withCredentials = true;
      xhr.onload = function() {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data.sessionKey) resolve(data.sessionKey);
          else reject(new Error('세션키 획득 실패'));
        } catch (e) { reject(e); }
      };
      xhr.onerror = function() { reject(new Error('세션키 요청 실패')); };
      xhr.send();
    });
  }

  async function uploadImageBlob(sessionKey, blogId, blob, fileName) {
    var uploadUrl = 'https://blog.upphoto.naver.com/' + sessionKey +
      '/simpleUpload/0?userId=' + blogId +
      '&extractExif=true&extractAnimatedCnt=false&extractAnimatedInfo=true' +
      '&autorotate=true&extractDominantColor=false&type=&customQuery=' +
      '&denyAnimatedImage=false&skipXcamFiltering=false';

    var fd = new FormData();
    fd.append('image', blob, fileName);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.withCredentials = true;
    var p = new Promise(function(resolve, reject) {
      xhr.onload = function() {
        if (xhr.status !== 200) { reject(new Error('업로드 실패: ' + xhr.status)); return; }
        var resp = xhr.responseText;
        var urlVal = resp.match(/<url>([^<]+)<\/url>/);
        if (!urlVal) { reject(new Error('업로드 응답 파싱 실패')); return; }
        resolve({
          url: urlVal[1],
          path: urlVal[1],
          width: parseInt((resp.match(/<width>(\d+)<\/width>/) || [0, 0])[1]),
          height: parseInt((resp.match(/<height>(\d+)<\/height>/) || [0, 0])[1]),
          fileSize: parseInt((resp.match(/<fileSize>(\d+)<\/fileSize>/) || [0, 0])[1]),
          fileName: (resp.match(/<fileName>([^<]+)<\/fileName>/) || [0, fileName])[1]
        });
      };
      xhr.onerror = function() { reject(new Error('업로드 요청 실패')); };
    });
    xhr.send(fd);
    return p;
  }

  async function ensureHtml2Canvas() {
    if (typeof html2canvas !== 'undefined') return;
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function htmlToScreenshotBlob(htmlString, width) {
    width = width || 700;
    await ensureHtml2Canvas();

    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:99999;width:' + width + 'px;';
    wrapper.innerHTML = htmlString;
    document.body.appendChild(wrapper);

    await new Promise(function(r) { setTimeout(r, 500); });

    var target = wrapper.firstElementChild || wrapper;
    var canvas = await html2canvas(target, {
      backgroundColor: null,
      scale: 2,
      useCORS: true,
      logging: false,
      width: width
    });

    document.body.removeChild(wrapper);

    return new Promise(function(resolve) {
      canvas.toBlob(resolve, 'image/png');
    });
  }

  async function waitForCDN(url, maxAttempts) {
    maxAttempts = maxAttempts || 10;
    for (var i = 0; i < maxAttempts; i++) {
      await new Promise(function(r) { setTimeout(r, 2000); });
      try {
        var res = await fetch(url, { method: 'HEAD' });
        if (res.status === 200) return true;
      } catch (e) {}
    }
    return false;
  }

  function createImageComponent(imgInfo) {
    var domain = 'https://blogfiles.pstatic.net';
    var fullSrc = domain + imgInfo.url + '?type=w1';
    var displayW = Math.min(imgInfo.width, 700);
    var displayH = Math.round(imgInfo.height * displayW / imgInfo.width);

    return {
      "id": generateSeUuid(),
      "layout": "default",
      "src": fullSrc,
      "internalResource": true,
      "represent": false,
      "path": imgInfo.path,
      "domain": domain,
      "fileSize": imgInfo.fileSize,
      "width": displayW,
      "widthPercentage": 0,
      "height": displayH,
      "originalWidth": imgInfo.width,
      "originalHeight": imgInfo.height,
      "fileName": imgInfo.fileName,
      "caption": null,
      "format": "normal",
      "displayFormat": "normal",
      "imageLoaded": true,
      "contentMode": "fit",
      "origin": { "srcFrom": "local", "@ctype": "imageOrigin" },
      "ai": false,
      "@ctype": "image"
    };
  }

  async function htmlBlockToImageComponent(htmlBlock, fileName, blogId, seToken, sessionKey) {
    var blob = await htmlToScreenshotBlob(htmlBlock, 700);

    if (!sessionKey) {
      if (!seToken) seToken = await getSeToken(blogId);
      sessionKey = await getUploadSessionKey(seToken);
    }

    var imgInfo = await uploadImageBlob(sessionKey, blogId, blob, fileName || 'converted-block.png');

    var fullSrc = 'https://blogfiles.pstatic.net' + imgInfo.url + '?type=w1';
    await waitForCDN(fullSrc, 10);

    return createImageComponent(imgInfo);
  }

  function needsScreenshot(element) {
    var style = element.getAttribute('style') || '';
    var className = element.className || '';

    var complexCSS = /gradient|flex|grid|filter|transform|border-radius|backdrop|clip-path|animation|@keyframes|background-image|box-shadow/i;
    if (complexCSS.test(style)) return true;
    if (element.querySelector('style')) return true;
    if (element.querySelector('svg, canvas, video')) return true;
    if (element.tagName === 'FIGURE' && element.querySelector('svg, canvas')) return true;
    if (element.querySelector('progress, meter')) return true;
    if (element.tagName === 'DETAILS') return true;
    if (/hero|card|banner|stats|timeline|glass|neon/i.test(className)) return true;
    return false;
  }

  async function convertHtmlToNaverComponents(html, onProgress) {
    var blogId = getBlogId();
    if (!blogId) throw new Error('블로그 ID를 찾을 수 없습니다. 네이버 블로그 글쓰기 페이지에서 실행해주세요.');

    if (onProgress) onProgress('인증 토큰 획득 중...');
    var seToken = await getSeToken(blogId);
    var sessionKey = await getUploadSessionKey(seToken);

    if (onProgress) onProgress('HTML 분석 중...');

    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    var body = doc.body;

    var styleSheets = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];
    var stylePrefix = styleSheets.join('\n');
    var linkTags = html.match(/<link[^>]*>/gi) || [];
    var linkPrefix = linkTags.join('\n');

    var hasStyleTag = styleSheets.length > 0;
    var hasCSSVars = /:root\s*\{/.test(html);

    if (hasStyleTag || hasCSSVars) {
      if (onProgress) onProgress('스타일 HTML 감지 → 섹션별 분할 변환 시작...');

      var components = [];
      var screenshotIdx = 0;
      var children = Array.from(body.children);

      async function screenshotBlock(blockHtml, fileName) {
        screenshotIdx++;
        var fullHtml = '<html><head><meta charset="UTF-8">' + linkPrefix + stylePrefix + '</head><body style="margin:0;padding:0;">' + blockHtml + '</body></html>';
        var blob = await htmlToScreenshotBlob(fullHtml, 700);
        var imgInfo = await uploadImageBlob(sessionKey, blogId, blob, fileName || ('section-' + screenshotIdx + '.png'));
        var fullSrc = 'https://blogfiles.pstatic.net' + imgInfo.url + '?type=w1';
        await waitForCDN(fullSrc, 8);
        return createImageComponent(imgInfo);
      }

      function extractSeoText(element) {
        var text = element.textContent.replace(/\s+/g, ' ').trim();
        if (!text || text.length < 5) return null;
        var tag = element.tagName ? element.tagName.toUpperCase() : '';
        var isHeading = /^H[1-6]$/.test(tag);
        var style = {};
        if (isHeading) {
          style.fontSize = headingToFontSize(tag);
          style.bold = true;
        } else {
          style.fontSize = 'fs16';
        }
        var nodes = [];
        var extracted = extractTextNodes(element, style);
        if (extracted.length > 0) nodes = extracted;
        else nodes = [createTextNode(text, style)];
        return createTextComponent([createParagraph(nodes)]);
      }

      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        var tag = child.tagName ? child.tagName.toUpperCase() : '';

        if (onProgress) onProgress('섹션 변환 중... (' + (i + 1) + '/' + children.length + ')');

        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META' || tag === 'NOSCRIPT') continue;

        var childText = child.textContent.replace(/\s+/g, ' ').trim();
        var childStyle = child.getAttribute('style') || '';
        var childClass = child.className || '';
        var childInner = child.innerHTML || '';

        var isVisual = false;
        if (/hero|stats|grid|card|highlight|banner|gradient|glass|neon|timeline/i.test(childClass)) isVisual = true;
        if (/gradient|flex|grid|animation|transform|clip-path|backdrop|border-radius/i.test(childStyle)) isVisual = true;
        if (child.querySelector && (
          child.querySelector('.hero, .stats-grid, .stat-item, .highlight-card, .tags, .scroll-indicator, .author-avatar') ||
          child.querySelector('svg, canvas, video, progress, meter') ||
          child.querySelector('[class*="grid"], [class*="flex"], [class*="card"], [class*="stat"], [class*="hero"]')
        )) isVisual = true;
        if (/display\s*:\s*(flex|grid)/i.test(childInner) || /display\s*:\s*(flex|grid)/i.test(childStyle)) isVisual = true;
        if ((tag === 'SECTION' || tag === 'ARTICLE' || tag === 'DIV') && child.children && child.children.length > 0) {
          var innerClasses = child.innerHTML;
          if (/stat-|grid|hero|highlight|card|avatar|scroll-indicator|tags/i.test(innerClasses)) isVisual = true;
        }

        if (isVisual) {
          try {
            var imgComp = await screenshotBlock(child.outerHTML, 'visual-' + screenshotIdx + '.png');
            if (components.length === 0) imgComp.represent = true;
            components.push(imgComp);
          } catch (e) { console.warn('스크린샷 실패:', e.message); }

          if (childText.length > 10) {
            var subElements = child.querySelectorAll ? child.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,span,div') : [];
            var seoAdded = false;
            subElements.forEach(function(sub) {
              var subText = sub.textContent.replace(/\s+/g, ' ').trim();
              if (subText.length > 10) {
                if (subText === childText && subElements.length > 1) return;
                var seoComp = extractSeoText(sub);
                if (seoComp) { components.push(seoComp); seoAdded = true; }
              }
            });
            if (!seoAdded && childText.length > 10) {
              components.push(createTextComponent([createParagraph([createTextNode(childText, { fontSize: 'fs16' })])]));
            }
          }
          components.push(createHorizontalLine());
        } else {
          if (tag === 'HR') {
            components.push(createHorizontalLine());
            continue;
          }
          if (tag === 'TABLE') {
            var rows = parseTable(child);
            if (rows.length > 0) {
              var tComp = createTableComponent(rows);
              if (tComp) components.push(tComp);
            }
            continue;
          }
          if (/^H[1-6]$/.test(tag)) {
            var hNodes = extractTextNodes(child, { fontSize: headingToFontSize(tag), bold: true });
            if (hNodes.length > 0) components.push(createTextComponent([createParagraph(hNodes, getAlignment(child))]));
            continue;
          }
          if (tag === 'BLOCKQUOTE') {
            try {
              var bqImg = await screenshotBlock(child.outerHTML, 'quote-' + screenshotIdx + '.png');
              components.push(bqImg);
            } catch (e) {}
            var bqNodes = extractTextNodes(child, { italic: true });
            if (bqNodes.length > 0) {
              bqNodes.unshift(createTextNode('┃ ', { bold: true, color: '#6B7280' }));
              components.push(createTextComponent([createParagraph(bqNodes)]));
            }
            continue;
          }
          if (tag === 'UL' || tag === 'OL') {
            var isOrd = tag === 'OL';
            child.querySelectorAll(':scope > li').forEach(function(li, idx) {
              var prefix = isOrd ? (idx + 1) + '. ' : '• ';
              var liNodes = extractTextNodes(li);
              if (liNodes.length > 0) {
                liNodes[0].value = prefix + liNodes[0].value;
                components.push(createTextComponent([createParagraph(liNodes)]));
              }
            });
            continue;
          }
          if (tag === 'IMG') {
            var imgSrc = child.getAttribute('src');
            if (imgSrc) {
              try {
                var imgRes = await fetch(imgSrc);
                var imgBlob = await imgRes.blob();
                var imgName = imgSrc.split('/').pop().split('?')[0] || 'image.png';
                var imgInfo = await uploadImageBlob(sessionKey, blogId, imgBlob, imgName);
                await waitForCDN('https://blogfiles.pstatic.net' + imgInfo.url + '?type=w1', 5);
                components.push(createImageComponent(imgInfo));
              } catch (e) {
                components.push(createTextComponent([createParagraph([createTextNode('[이미지: ' + (child.getAttribute('alt') || imgSrc) + ']')])]));
              }
            }
            continue;
          }
          if (tag === 'FIGURE') {
            var figImg = child.querySelector('img');
            var figCap = child.querySelector('figcaption');
            if (figImg && figImg.getAttribute('src')) {
              try {
                var fRes = await fetch(figImg.getAttribute('src'));
                var fBlob = await fRes.blob();
                var fName = figImg.getAttribute('src').split('/').pop().split('?')[0] || 'figure.png';
                var fInfo = await uploadImageBlob(sessionKey, blogId, fBlob, fName);
                await waitForCDN('https://blogfiles.pstatic.net' + fInfo.url + '?type=w1', 5);
                components.push(createImageComponent(fInfo));
              } catch (e) {}
            }
            if (figCap) {
              var capNodes = extractTextNodes(figCap, { fontSize: 'fs13', color: '#6B7280' });
              if (capNodes.length > 0) components.push(createTextComponent([createParagraph(capNodes)]));
            }
            continue;
          }
          if (tag === 'A' && child.getAttribute('href')) {
            var href = child.getAttribute('href');
            if (href.startsWith('http')) components.push(createOgLinkComponent(href, child.textContent.trim()));
            continue;
          }
          if (tag === 'SVG' || tag === 'CANVAS') {
            try {
              var svgComp = await screenshotBlock(child.outerHTML, 'svg-' + screenshotIdx + '.png');
              components.push(svgComp);
            } catch (e) {}
            continue;
          }
          if (tag === 'FOOTER') {
            var footerNodes = extractTextNodes(child, { fontSize: 'fs13', color: '#6B7280' });
            if (footerNodes.length > 0) {
              components.push(createHorizontalLine());
              components.push(createTextComponent([createParagraph(footerNodes, 'center')]));
            }
            continue;
          }
          if (tag === 'FORM' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') continue;

          if (child.children && child.children.length > 0) {
            var subChildren = Array.from(child.children);
            for (var j = 0; j < subChildren.length; j++) {
              var sub = subChildren[j];
              var subTag = sub.tagName ? sub.tagName.toUpperCase() : '';
              var subClass = sub.className || '';
              var subStyle = sub.getAttribute('style') || '';
              var subInner = sub.innerHTML || '';

              var subIsVisual = false;
              if (/hero|stats|grid|card|highlight|banner|tags|avatar/i.test(subClass)) subIsVisual = true;
              if (/gradient|flex|grid|animation|transform/i.test(subStyle)) subIsVisual = true;
              if (sub.querySelector && sub.querySelector('.stat-item, .highlight-card, .tag, .hero-content, .scroll-indicator, [class*="grid"], [class*="stat"]')) subIsVisual = true;
              if (/display\s*:\s*(flex|grid)/i.test(subInner) || /display\s*:\s*(flex|grid)/i.test(subStyle)) subIsVisual = true;

              if (subIsVisual) {
                try {
                  var subImg = await screenshotBlock(sub.outerHTML, 'sub-' + screenshotIdx + '.png');
                  if (components.length === 0 || !components.some(function(c) { return c.represent; })) subImg.represent = true;
                  components.push(subImg);
                } catch (e) {}
                var subText = sub.textContent.replace(/\s+/g, ' ').trim();
                if (subText.length > 10) {
                  var subSubs = sub.querySelectorAll ? sub.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,span,div') : [];
                  subSubs.forEach(function(s) {
                    var sText = s.textContent.replace(/\s+/g, ' ').trim();
                    if (sText.length > 10 && sText !== subText) {
                      var sc = extractSeoText(s);
                      if (sc) components.push(sc);
                    }
                  });
                }
                components.push(createHorizontalLine());
              } else {
                if (/^H[1-6]$/.test(subTag)) {
                  var shNodes = extractTextNodes(sub, { fontSize: headingToFontSize(subTag), bold: true });
                  if (shNodes.length > 0) components.push(createTextComponent([createParagraph(shNodes)]));
                } else if (subTag === 'BLOCKQUOTE') {
                  try {
                    var sbqImg = await screenshotBlock(sub.outerHTML, 'bq-' + screenshotIdx + '.png');
                    components.push(sbqImg);
                  } catch (e) {}
                  var sbqNodes = extractTextNodes(sub, { italic: true });
                  if (sbqNodes.length > 0) {
                    sbqNodes.unshift(createTextNode('┃ ', { bold: true, color: '#6B7280' }));
                    components.push(createTextComponent([createParagraph(sbqNodes)]));
                  }
                } else if (subTag === 'UL' || subTag === 'OL') {
                  var sIsOrd = subTag === 'OL';
                  sub.querySelectorAll(':scope > li').forEach(function(li, idx) {
                    var prefix = sIsOrd ? (idx + 1) + '. ' : '• ';
                    var liNodes = extractTextNodes(li);
                    if (liNodes.length > 0) {
                      liNodes[0].value = prefix + liNodes[0].value;
                      components.push(createTextComponent([createParagraph(liNodes)]));
                    }
                  });
                } else if (subTag === 'HR') {
                  components.push(createHorizontalLine());
                } else if (subTag === 'P' || subTag === 'DIV' || subTag === 'SPAN' || subTag === 'ARTICLE' || subTag === 'SECTION' || subTag === 'HEADER' || subTag === 'MAIN' || subTag === 'ASIDE' || subTag === 'NAV') {
                  if (sub.children && sub.children.length > 0 && sub.querySelector && sub.querySelector('[class*="grid"], [class*="stat"], [class*="card"], [class*="hero"], [class*="highlight"], [class*="tag"]')) {
                    try {
                      var deepImg = await screenshotBlock(sub.outerHTML, 'deep-' + screenshotIdx + '.png');
                      components.push(deepImg);
                    } catch (e) {}
                    var deepText = sub.textContent.replace(/\s+/g, ' ').trim();
                    if (deepText.length > 10) {
                      components.push(createTextComponent([createParagraph([createTextNode(deepText, { fontSize: 'fs16' })])]));
                    }
                  } else {
                    var pNodes = extractTextNodes(sub);
                    if (pNodes.length > 0) components.push(createTextComponent([createParagraph(pNodes)]));
                  }
                } else if (subTag === 'FOOTER') {
                  var ftNodes = extractTextNodes(sub, { fontSize: 'fs13', color: '#6B7280' });
                  if (ftNodes.length > 0) {
                    components.push(createHorizontalLine());
                    components.push(createTextComponent([createParagraph(ftNodes, 'center')]));
                  }
                } else {
                  var genNodes = extractTextNodes(sub);
                  if (genNodes.length > 0) components.push(createTextComponent([createParagraph(genNodes)]));
                }
              }
            }
          } else {
            if (childText.length > 0) {
              var leafNodes = extractTextNodes(child);
              if (leafNodes.length > 0) {
                components.push(createTextComponent([createParagraph(leafNodes, getAlignment(child))]));
              }
            }
          }
        }
      }

      if (components.length === 0) return parseHtmlToComponents(html);
      if (onProgress) onProgress('완료!');
      return components;
    }

    var components = [];
    var screenshotIndex = 0;
    var children = Array.from(body.children);

    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var tag = child.tagName.toUpperCase();

      if (onProgress) onProgress('변환 중... (' + (i + 1) + '/' + children.length + ')');

      if (needsScreenshot(child)) {
        screenshotIndex++;
        try {
          var blockHtml = child.outerHTML;
          var styleTag = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi);
          if (styleTag) blockHtml = styleTag.join('\n') + '\n' + blockHtml;
          var imgComp2 = await htmlBlockToImageComponent(
            blockHtml, 'block-' + screenshotIndex + '.png', blogId, seToken, sessionKey
          );
          components.push(imgComp2);
        } catch (e) {
          console.warn('스크린샷 실패, 텍스트로 대체:', e.message);
          var fallbackNodes = extractTextNodes(child);
          if (fallbackNodes.length > 0) {
            components.push(createTextComponent([createParagraph(fallbackNodes)]));
          }
        }
        continue;
      }

      if (tag === 'IMG') {
        var imgSrc = child.getAttribute('src');
        if (imgSrc) {
          try {
            var imgRes = await fetch(imgSrc);
            var imgBlob = await imgRes.blob();
            var imgName = imgSrc.split('/').pop().split('?')[0] || 'image.png';
            var imgInfo2 = await uploadImageBlob(sessionKey, blogId, imgBlob, imgName);
            var fullUrl = 'https://blogfiles.pstatic.net' + imgInfo2.url + '?type=w1';
            await waitForCDN(fullUrl, 5);
            components.push(createImageComponent(imgInfo2));
          } catch (e) {
            console.warn('이미지 업로드 실패:', e.message);
            var altText = child.getAttribute('alt') || imgSrc;
            components.push(createTextComponent([createParagraph([createTextNode('[이미지: ' + altText + ']')])]));
          }
        }
        continue;
      }

      if (tag === 'FIGURE') {
        var figImg = child.querySelector('img');
        var figCaption = child.querySelector('figcaption');
        if (figImg && figImg.getAttribute('src')) {
          try {
            var figRes = await fetch(figImg.getAttribute('src'));
            var figBlob = await figRes.blob();
            var figName = figImg.getAttribute('src').split('/').pop().split('?')[0] || 'figure.png';
            var figInfo = await uploadImageBlob(sessionKey, blogId, figBlob, figName);
            await waitForCDN('https://blogfiles.pstatic.net' + figInfo.url + '?type=w1', 5);
            components.push(createImageComponent(figInfo));
          } catch (e) { console.warn('figure 이미지 실패:', e.message); }
        }
        if (figCaption) {
          var capNodes = extractTextNodes(figCaption, { fontSize: 'fs13', color: '#6B7280' });
          if (capNodes.length > 0) {
            components.push(createTextComponent([createParagraph(capNodes)]));
          }
        }
        continue;
      }

      if (tag === 'HR') {
        components.push(createHorizontalLine());
        continue;
      }

      if (tag === 'TABLE') {
        var rows = parseTable(child);
        if (rows.length > 0) {
          var tComp = createTableComponent(rows);
          if (tComp) components.push(tComp);
        }
        continue;
      }

      if (/^H[1-6]$/.test(tag)) {
        var hNodes = extractTextNodes(child, { fontSize: headingToFontSize(tag), bold: true });
        if (hNodes.length > 0) {
          components.push(createTextComponent([createParagraph(hNodes, getAlignment(child))]));
        }
        continue;
      }

      if (tag === 'UL' || tag === 'OL') {
        var isOrd = tag === 'OL';
        child.querySelectorAll(':scope > li').forEach(function(li, idx) {
          var prefix = isOrd ? (idx + 1) + '. ' : '• ';
          var liNodes = extractTextNodes(li);
          if (liNodes.length > 0) {
            liNodes[0].value = prefix + liNodes[0].value;
            components.push(createTextComponent([createParagraph(liNodes)]));
          }
        });
        continue;
      }

      if (tag === 'BLOCKQUOTE') {
        var bqNodes = extractTextNodes(child, { italic: true });
        if (bqNodes.length > 0) {
          bqNodes.unshift(createTextNode('┃ ', { bold: true, color: '#6B7280' }));
          components.push(createTextComponent([createParagraph(bqNodes)]));
        }
        continue;
      }

      if (tag === 'PRE' || tag === 'CODE') {
        var codeText = child.textContent.trim();
        if (codeText) {
          components.push(createTextComponent([
            createParagraph([createTextNode(codeText, { fontSize: 'fs15', color: '#E8EAF0' })])
          ]));
        }
        continue;
      }

      if (tag === 'A' && child.getAttribute('href')) {
        var href = child.getAttribute('href');
        if (href.startsWith('http')) {
          components.push(createOgLinkComponent(href, child.textContent.trim()));
        }
        continue;
      }

      if (tag === 'SVG' || tag === 'CANVAS') {
        screenshotIndex++;
        try {
          var svgComp = await htmlBlockToImageComponent(
            child.outerHTML, 'svg-' + screenshotIndex + '.png', blogId, seToken, sessionKey
          );
          components.push(svgComp);
        } catch (e) { console.warn('SVG/Canvas 캡처 실패:', e.message); }
        continue;
      }

      if (tag === 'VIDEO') {
        var videoSrc = child.getAttribute('src') || (child.querySelector('source') && child.querySelector('source').src) || '';
        if (videoSrc) {
          components.push(createTextComponent([createParagraph([createTextNode('🎬 동영상: ' + videoSrc)])]));
        }
        continue;
      }

      if (tag === 'DETAILS') {
        var summary = child.querySelector('summary');
        if (summary) {
          var sumNodes = extractTextNodes(summary, { bold: true });
          sumNodes.unshift(createTextNode('▼ ', { bold: true }));
          components.push(createTextComponent([createParagraph(sumNodes)]));
        }
        var detailNodes = extractTextNodes(child);
        if (detailNodes.length > 0) {
          components.push(createTextComponent([createParagraph(detailNodes)]));
        }
        continue;
      }

      if (tag === 'FORM' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') continue;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META') continue;

      var textNodes = extractTextNodes(child);
      if (textNodes.length > 0) {
        var align = getAlignment(child);
        components.push(createTextComponent([createParagraph(textNodes, align)]));
      }
    }

    if (components.length === 0) {
      return parseHtmlToComponents(html);
    }

    if (onProgress) onProgress('완료!');
    return components;
  }

  /**
   * 14. HTML을 SE 에디터 컴포넌트 배열로 변환 (메인 함수 - 맨 마지막!)
   */
  function parseHtmlToComponents(html) {
    // 테마 감지 (다크/라이트/플레인)
    const themeInfo = detectTheme(html);

    // 다크 또는 라이트 스타일 → 유니버설 파서 (megaCell)
    if (themeInfo.type === 'dark' || themeInfo.type === 'light') {
      return parseUniversalToComponents(html, themeInfo.vars, themeInfo.type, themeInfo.bgColor);
    }

    // 플레인 HTML만 기존 파서
    const components = [];

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const body = doc.body;
    
    const processNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) {
          const paragraph = createParagraph([createTextNode(text)]);
          components.push(createTextComponent([paragraph]));
        }
        return;
      }
      
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      
      const tagName = node.tagName.toUpperCase();
      
      // a 태그가 단독으로 있는 경우 (블록 레벨) OG 링크로 변환
      if (tagName === 'A' && node.getAttribute('href')) {
        const href = node.getAttribute('href');
        const text = node.textContent.trim();
        
        // http:// 또는 https://로 시작하는 링크만 OG 링크로
        if (href.startsWith('http://') || href.startsWith('https://')) {
          components.push(createOgLinkComponent(href, text));
          return;
        }
      }
      
      if (tagName === 'HR') {
        components.push(createHorizontalLine());
        return;
      }
      
      if (tagName === 'TABLE') {
        const rows = parseTable(node);
        if (rows.length > 0) {
          const tableComp = createTableComponent(rows);
          if (tableComp) components.push(tableComp);
        }
        return;
      }
      
      if (/^H[1-6]$/.test(tagName)) {
        const textNodes = extractTextNodes(node, {
          fontSize: headingToFontSize(tagName),
          bold: true
        });
        
        if (textNodes.length > 0) {
          const align = getAlignment(node);
          const paragraph = createParagraph(textNodes, align);
          components.push(createTextComponent([paragraph]));
        }
        return;
      }
      
      if (tagName === 'UL' || tagName === 'OL') {
        const isOrdered = tagName === 'OL';
        
        node.querySelectorAll(':scope > li').forEach((li, index) => {
          const prefix = isOrdered ? `${index + 1}. ` : '• ';
          const textNodes = extractTextNodes(li);
          
          if (textNodes.length > 0) {
            textNodes[0].value = prefix + textNodes[0].value;
            const paragraph = createParagraph(textNodes);
            components.push(createTextComponent([paragraph]));
          }
        });
        return;
      }
      
      if (tagName === 'P' || tagName === 'DIV' || tagName === 'BLOCKQUOTE') {
        // p나 div 안에 a 태그만 있는 경우 OG 링크로 변환
        const links = node.querySelectorAll('a[href]');
        const textContent = node.textContent.trim();
        
        if (links.length > 0) {
          // 각 링크를 OG 링크 카드로 변환
          links.forEach(link => {
            const href = link.getAttribute('href');
            const linkText = link.textContent.trim();
            
            if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
              components.push(createOgLinkComponent(href, linkText));
            }
          });
          
          // 링크 외의 텍스트가 있으면 텍스트 컴포넌트로 추가
          const nonLinkText = textContent.replace(/https?:\/\/[^\s]+/g, '').trim();
          if (nonLinkText && nonLinkText !== Array.from(links).map(l => l.textContent).join('')) {
            const textNodes = extractTextNodes(node);
            if (textNodes.length > 0) {
              const align = getAlignment(node);
              const paragraph = createParagraph(textNodes, align);
              components.push(createTextComponent([paragraph]));
            }
          }
          return;
        }
        
        // 링크가 없는 일반 텍스트 처리 (기존 코드 유지)
        const textNodes = extractTextNodes(node);
        
        if (textNodes.length > 0) {
          const align = getAlignment(node);
          const paragraph = createParagraph(textNodes, align);
          components.push(createTextComponent([paragraph]));
        }
        return;
      }
      
      if (tagName === 'BR') {
        return;
      }
      
      // 기타 요소
      Array.from(node.childNodes).forEach(processNode);
    };
    
    Array.from(body.childNodes).forEach(processNode);
    
    if (components.length === 0) {
      const text = body.textContent.trim();
      if (text) {
        const paragraph = createParagraph([createTextNode(text)]);
        components.push(createTextComponent([paragraph]));
      }
    }

    return components;
  }

  /**
   * 15. 유니버설 파서 — 블로그에 들어갈 수 있는 모든 HTML 요소 처리
   *     다크/라이트 자동 대응, 단일 megaCell, 모바일 흰줄 제거
   */
  function parseUniversalToComponents(html, cssVars, themeType, bgColor) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    var body = doc.body;
    var isDark = (themeType === 'dark');

    // ══════════════════════════════════════════════
    //  색상 시스템
    // ══════════════════════════════════════════════
    function rgbaToHex(val) {
      if (!val) return null;
      val = val.trim();
      if (val.startsWith('#')) return val;
      var m = val.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
      if (m) return '#' + [m[1],m[2],m[3]].map(function(x){return('0'+parseInt(x).toString(16)).slice(-2)}).join('');
      return null;
    }

    function getColor(varName, darkFB, lightFB) {
      var val = cssVars[varName];
      if (!val) return isDark ? darkFB : lightFB;
      val = val.trim();
      var hex = rgbaToHex(val) || colorToHex(val);
      return hex || (isDark ? darkFB : lightFB);
    }

    function brightness(hex) {
      if (!hex) return 128;
      hex = hex.replace('#','');
      if (hex.length===3) hex=hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
      return 0.299*parseInt(hex.substr(0,2),16)+0.587*parseInt(hex.substr(2,2),16)+0.114*parseInt(hex.substr(4,2),16);
    }

    if (bgColor && typeof bgColor === 'string') {
      var _res = resolveCssVar(bgColor, cssVars);
      var _hex = rgbaToHex(_res) || colorToHex(_res);
      if (_hex) bgColor = _hex;
    }

    var C = {
      bg:      bgColor || (isDark ? '#0d0f14' : '#FFFFFF'),
      accent:  getColor('--accent',  '#4f8ef7', '#6d28d9'),
      accent2: getColor('--accent2', '#7ee8a2', '#059669'),
      warn:    getColor('--warn',    '#f7c948', '#d97706'),
      text:    getColor('--text',    '#e8eaf0', '#1a1a2e'),
      muted:   getColor('--muted',   '#8891a8', '#6b7294'),
      border:  getColor('--border',  '#252b3b', '#e2e5ef'),
      pink:    getColor('--pink',    '#c084fc', '#db2777'),
      cyan:    getColor('--cyan',    '#67e8f9', '#0891b2'),
      code:    isDark ? '#1e2436' : '#f3f4f8',
      codeTx:  isDark ? '#e8eaf0' : '#1a1a2e',
      imgBdr:  isDark ? '#333355' : '#d0d0e0'
    };
    C.body  = isDark ? '#c8ccd8' : '#3d3d56';
    C.table = isDark ? '#c0c4d4' : '#4a4a66';

    var bBr = brightness(C.border);
    if (isDark && bBr > 200) C.border = '#333355';
    if (!isDark && bBr < 50) C.border = '#d0d0e0';

    // ══════════════════════════════════════════════
    //  기본 빌더
    // ══════════════════════════════════════════════
    var P = [];

    function uid() { return generateSeUuid(); }

    function tn(text, opts) {
      opts = opts || {};
      var s = {"@ctype":"nodeStyle","fontSizeCode":opts.fs||"fs16","fontFamily":"nanumgothic"};
      if (opts.b) s.bold = true;
      if (opts.i) s.italic = true;
      if (opts.u) s.underline = true;
      if (opts.st) s.strikeThrough = true;
      if (opts.fc) s.fontColor = opts.fc;
      return {"@ctype":"textNode","id":uid(),"value":text,"style":s};
    }

    function pg(nodes, align, lh) {
      return {
        "@ctype":"paragraph","id":uid(),
        "style":{"@ctype":"paragraphStyle","align":align||"left","lineHeight":lh||1.8},
        "nodes":(nodes&&nodes.length>0)?nodes:[tn("\u00A0",{fs:"fs11",fc:C.bg})]
      };
    }

    function sp(h) { return pg([tn("\u00A0",{fs:"fs11",fc:C.bg})],null,h||0.8); }

    function hrLine() {
      var ch=isDark?'━':'─'; var line='';
      for(var i=0;i<36;i++) line+=ch;
      return pg([tn(line,{fs:"fs11",fc:C.border})],null,1.0);
    }

    function warnPg(text, color) {
      return pg([tn("  ┃ ",{fs:"fs15",b:true,fc:color||C.warn}),tn(text,{fs:"fs13",fc:C.body})]);
    }

    // ── 텍스트 노드 재귀 추출 (인라인 요소 전부 처리) ──
    function extractNodes(el, inherited) {
      inherited = inherited || {};
      var nodes = [];
      el.childNodes.forEach(function(child) {
        if (child.nodeType === Node.TEXT_NODE) {
          var t = child.textContent;
          if (t && t.trim()) {
            nodes.push(tn(t, {
              fs:inherited.fs||"fs16", fc:inherited.fc||C.body,
              b:inherited.b, i:inherited.i, u:inherited.u, st:inherited.st
            }));
          }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          var tag = child.tagName.toUpperCase();
          var ci = Object.assign({}, inherited);
          var ist = parseStyleString(child.getAttribute('style'));

          if (tag==='STRONG'||tag==='B') ci.b=true;
          if (tag==='EM'||tag==='I') ci.i=true;
          if (tag==='U'||tag==='INS') ci.u=true;
          if (tag==='S'||tag==='DEL'||tag==='STRIKE') ci.st=true;
          if (tag==='SUB'||tag==='SUP') { }
          if (tag==='SMALL') { ci.fs = 'fs13'; }
          if (tag==='MARK') { ci.b=true; }
          if (tag==='CODE'||tag==='KBD'||tag==='VAR'||tag==='SAMP') { ci.fc=C.codeTx; ci.b=true; }
          if (tag==='ABBR') { }
          if (tag==='Q') {
            nodes.push(tn('"', {fs:ci.fs,fc:C.muted}));
            nodes.push.apply(nodes, extractNodes(child, ci));
            nodes.push(tn('"', {fs:ci.fs,fc:C.muted}));
            return;
          }
          if (tag==='CITE') { ci.i=true; ci.fc=C.muted; }
          if (tag==='A') { ci.fc = C.accent; ci.u = true; }
          if (tag==='BR') {
            nodes.push(tn('\n', {fs:ci.fs||"fs16",fc:ci.fc||C.body}));
            return;
          }
          if (tag==='WBR') return;

          if (ist.color) {
            var resolved = resolveCssVar(ist.color, cssVars);
            var hex = rgbaToHex(resolved) || colorToHex(resolved);
            if (hex) ci.fc = hex;
          }
          if (ist.fontWeight==='bold'||parseInt(ist.fontWeight)>=600) ci.b=true;
          if (ist.fontStyle==='italic') ci.i=true;
          if (ist.textDecoration) {
            if (ist.textDecoration.indexOf('underline')>=0) ci.u=true;
            if (ist.textDecoration.indexOf('line-through')>=0) ci.st=true;
          }
          if (ist.fontSize) ci.fs=fontSizeToCode(ist.fontSize);

          if (tag==='RUBY') {
            child.querySelectorAll('rt,rp').forEach(function(r){r.remove()});
          }

          nodes.push.apply(nodes, extractNodes(child, ci));
        }
      });
      return nodes;
    }

    // ── 테이블 → 카드형 ──
    function tableToCards(tableEl) {
      var caption = tableEl.querySelector('caption');
      if (caption) {
        P.push(pg([tn(caption.textContent.trim(),{fs:"fs15",b:true,fc:C.accent})],null,1.4));
        P.push(sp(0.4));
      }

      var rows=[];
      tableEl.querySelectorAll('tr').forEach(function(tr) {
        var cells=[];
        tr.querySelectorAll('th,td').forEach(function(cell){cells.push(cell.textContent.trim())});
        if(cells.length>0) rows.push(cells);
      });

      if(rows.length===0) return;
      if(rows.length===1) {
        P.push(pg([tn(rows[0].join('  ┃  '),{fs:"fs15",fc:C.table})]));
        return;
      }

      var headers=rows[0];
      var emojis=['📊','💰','🛰️','📈','📉','🏭','🔬','📡','📋','🔢','💼','🎯'];

      for (var r = 1; r < rows.length; r++) {
        var row = rows[r];
        var emoji = emojis[(r - 1) % emojis.length];
        P.push(pg([tn(emoji + ' ' + row[0], { fs: "fs15", b: true, fc: C.accent })], null, 1.4));
        var vn = [];
        for (var c = 1; c < row.length; c++) {
          if (c > 1) vn.push(tn('  →  ', { fs: "fs15", fc: C.border }));
          vn.push(tn(headers[c] + ' ', { fs: "fs15", fc: C.muted }));
          if (c === row.length - 1) vn.push(tn(row[c], { fs: "fs15", b: true, fc: C.accent2 }));
          else vn.push(tn(row[c], { fs: "fs15", fc: C.table }));
        }
        P.push(pg(vn, null, 1.6));
        P.push(sp(0.6));
      }
    }

    function timelineToCards(divEl) {
      divEl.querySelectorAll('.tl-item').forEach(function(item) {
        var dateEl = item.querySelector('.tl-date');
        var descEl = item.querySelector('.tl-desc');
        if (dateEl && descEl) {
          var dn = extractNodes(descEl, { fs: "fs15", fc: C.table });
          var an = [tn(dateEl.textContent.trim() + '  ', { fs: "fs15", b: true, fc: C.cyan || C.accent })];
          an.push.apply(an, dn);
          P.push(pg(an, null, 1.6));
        }
      });
    }

    function invGroupToParas(divEl) {
      var titleEl = divEl.querySelector('.inv-group-title');
      if (titleEl) {
        P.push(sp(0.4));
        P.push(pg([tn(titleEl.textContent.trim(), { fs: "fs15", b: true, fc: C.pink || C.accent })], null, 1.4));
      }
      divEl.querySelectorAll('.inv-item').forEach(function(item) {
        var spanEl = item.querySelector('span');
        if (spanEl) {
          var label = spanEl.textContent.trim();
          var rest = item.textContent.trim().replace(label, '').trim();
          P.push(pg([
            tn(label, { fs: "fs15", b: true, fc: C.text }),
            tn(' ' + rest, { fs: "fs15", fc: C.table })
          ]));
        } else {
          P.push(pg([tn(item.textContent.trim(), { fs: "fs15", fc: C.table })]));
        }
      });
      P.push(sp(0.4));
    }

    // ── 메인 노드 처리 ──
    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        var t = node.textContent.trim();
        if (t) P.push(pg([tn(t, { fc: C.body })]));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      var tag = node.tagName.toUpperCase();
      var cls = node.getAttribute('class') || '';

      if (['STYLE', 'SCRIPT', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'TEMPLATE'].indexOf(tag) >= 0) return;
      if (cls.indexOf('orb') >= 0) return;

      if (tag === 'TABLE') {
        P.push(sp(1.0));
        tableToCards(node);
        P.push(sp(0.4));
        return;
      }

      if (tag === 'HR') {
        P.push(sp(1.2));
        P.push(hrLine());
        P.push(sp(1.2));
        return;
      }

      if (/^H[1-6]$/.test(tag)) {
        P.push(sp(1.0));
        var fsMap = { 'H1': 'fs28', 'H2': 'fs24', 'H3': 'fs16', 'H4': 'fs15', 'H5': 'fs15', 'H6': 'fs15' };
        var fs = fsMap[tag] || 'fs16';
        var fc;
        if (tag === 'H1') fc = C.text;
        else if (tag === 'H2' || tag === 'H3') fc = C.accent;
        else fc = C.accent2;
        var hNodes = extractNodes(node, { fs: fs, b: true, fc: fc });
        if (hNodes.length > 0) P.push(pg(hNodes, null, 1.4));
        P.push(sp(0.6));
        return;
      }

      if (tag === 'BLOCKQUOTE') {
        var txt = node.textContent.trim();
        var qCls = node.getAttribute('class') || '';
        var bColor = C.warn;
        if (qCls.indexOf('info') >= 0) bColor = C.accent;
        if (qCls.indexOf('success') >= 0) bColor = C.accent2;
        if (qCls.indexOf('danger') >= 0 || qCls.indexOf('error') >= 0) bColor = isDark ? '#f87171' : '#dc2626';
        P.push(warnPg(txt, bColor));
        P.push(sp(0.6));
        return;
      }

      if (tag === 'PRE') {
        P.push(sp(0.6));
        var codeText = node.textContent;
        var codeLines = codeText.split('\n');
        codeLines.forEach(function(line) {
          P.push(pg([tn(line || '\u00A0', { fs: "fs13", fc: C.codeTx, b: false })], null, 1.2));
        });
        P.push(sp(0.6));
        return;
      }

      if (tag === 'A' && node.getAttribute('href')) {
        var href = node.getAttribute('href');
        if (href.indexOf('http') === 0) {
          var linkText = node.textContent.trim().split('\n')[0].trim();
          P.push(sp(0.8));
          P.push(pg([tn('🔗 ', { fs: "fs15", fc: C.accent }), tn(linkText || href, { fs: "fs15", b: true, fc: C.accent, u: true })]));
          P.push(sp(0.8));
        }
        return;
      }

      if (tag === 'DL') {
        node.querySelectorAll(':scope > dt, :scope > dd').forEach(function(item) {
          if (item.tagName === 'DT') P.push(pg([tn(item.textContent.trim(), { fs: "fs15", b: true, fc: C.text })]));
          else P.push(pg([tn('  ' + item.textContent.trim(), { fs: "fs15", fc: C.table })]));
        });
        return;
      }

      if (tag === 'FIGURE') {
        var img = node.querySelector('img');
        var figcap = node.querySelector('figcaption');
        if (img) {
          var alt = img.getAttribute('alt') || '';
          var src = img.getAttribute('src') || '';
          P.push(sp(0.6));
          P.push(pg([tn('🖼️ [이미지] ' + (alt || src), { fs: "fs13", fc: C.muted, i: true })]));
        }
        if (figcap) P.push(pg([tn(figcap.textContent.trim(), { fs: "fs13", fc: C.muted, i: true })], null, 1.4));
        P.push(sp(0.6));
        return;
      }

      if (tag === 'IMG') {
        P.push(pg([tn('🖼️ [이미지] ' + (node.getAttribute('alt') || node.getAttribute('src') || ''), { fs: "fs13", fc: C.muted, i: true })]));
        return;
      }

      if (tag === 'VIDEO') {
        P.push(pg([tn('🎬 [동영상] ' + (node.getAttribute('src') || node.getAttribute('poster') || '영상'), { fs: "fs13", fc: C.muted, i: true })]));
        return;
      }

      if (tag === 'AUDIO') {
        P.push(pg([tn('🎵 [오디오]', { fs: "fs13", fc: C.muted, i: true })]));
        return;
      }

      if (tag === 'IFRAME') {
        var isrc = node.getAttribute('src') || '';
        var ititle = node.getAttribute('title') || '';
        if (isrc.indexOf('youtube') >= 0 || isrc.indexOf('youtu.be') >= 0) {
          P.push(sp(0.6));
          P.push(pg([tn('▶️ [유튜브] ', { fs: "fs15", fc: C.accent }), tn(ititle || isrc, { fs: "fs15", fc: C.accent, u: true })]));
          P.push(sp(0.6));
        } else if (isrc.indexOf('map') >= 0 || isrc.indexOf('google.com/maps') >= 0) {
          P.push(pg([tn('🗺️ [지도] ' + (ititle || isrc), { fs: "fs13", fc: C.muted, i: true })]));
        } else {
          P.push(pg([tn('📎 [임베드] ' + (ititle || isrc), { fs: "fs13", fc: C.muted, i: true })]));
        }
        return;
      }

      if (tag === 'EMBED' || tag === 'OBJECT') {
        var esrc = node.getAttribute('src') || node.getAttribute('data') || '';
        P.push(pg([tn('📎 [임베드] ' + esrc, { fs: "fs13", fc: C.muted, i: true })]));
        return;
      }

      if (tag === 'DETAILS') {
        var summary = node.querySelector('summary');
        if (summary) {
          P.push(sp(0.6));
          P.push(pg([tn('▼ ' + summary.textContent.trim(), { fs: "fs15", b: true, fc: C.accent })]));
        }
        Array.from(node.childNodes).forEach(function(ch) {
          if (ch.nodeType === Node.ELEMENT_NODE && ch.tagName === 'SUMMARY') return;
          processNode(ch);
        });
        P.push(sp(0.6));
        return;
      }

      if (tag === 'ADDRESS') {
        P.push(pg([tn(node.textContent.trim(), { fs: "fs13", fc: C.muted, i: true })]));
        return;
      }

      if (tag === 'P') {
        var links = node.querySelectorAll('a[href]');
        if (links.length > 0) {
          links.forEach(function(link) {
            var href2 = link.getAttribute('href');
            if (href2 && (href2.indexOf('http://') === 0 || href2.indexOf('https://') === 0)) {
              P.push(pg([tn('🔗 ', { fs: "fs15", fc: C.accent }), tn(link.textContent.trim() || href2, { fs: "fs15", fc: C.accent, u: true })]));
            }
          });
          var pClone = node.cloneNode(true);
          pClone.querySelectorAll('a').forEach(function(a) { a.remove(); });
          var remainText = pClone.textContent.trim();
          if (remainText) {
            var rNodes = extractNodes(pClone, { fc: C.body });
            if (rNodes.length > 0) P.push(pg(rNodes));
          }
          return;
        }
        var pNodes = extractNodes(node, { fc: C.body });
        if (pNodes.length > 0) P.push(pg(pNodes));
        return;
      }

      if (tag === 'DIV') {
        if (cls.indexOf('wrap') >= 0 || cls.indexOf('container') >= 0 || cls.indexOf('wrapper') >= 0 || cls.indexOf('content') >= 0) {
          Array.from(node.childNodes).forEach(processNode);
          return;
        }
        if (cls.indexOf('table-wrap') >= 0 || cls.indexOf('table-container') >= 0 || cls.indexOf('table-responsive') >= 0) {
          var tbl = node.querySelector('table');
          if (tbl) { P.push(sp(1.0)); tableToCards(tbl); P.push(sp(0.4)); }
          return;
        }
        if (cls.indexOf('hero') >= 0 || cls.indexOf('banner') >= 0 || (cls.indexOf('header') >= 0 && cls.indexOf('header-') < 0)) {
          P.push(sp(1.0));
          var heroTag = node.querySelector('.hero-tag,.tag,.badge,.label');
          if (heroTag) P.push(pg([tn('  🚀 ' + heroTag.textContent.trim(), { fs: "fs13", b: true, fc: C.pink || C.accent })]));
          var h1 = node.querySelector('h1');
          if (h1) { P.push(sp(0.6)); P.push(pg([tn('  ' + h1.textContent.trim(), { fs: "fs28", b: true, fc: C.text })], null, 1.4)); }
          var h2 = node.querySelector('h2,.subtitle,.sub-title,.description');
          if (h2) { P.push(sp(0.4)); P.push(pg([tn('  ' + h2.textContent.trim(), { fs: "fs15", fc: C.muted })], null, 1.6)); }
          P.push(sp(1.0)); P.push(hrLine()); P.push(sp(0.6));
          return;
        }
        if (cls.indexOf('disclaimer') >= 0 || cls.indexOf('notice') >= 0 || cls.indexOf('warning') >= 0) {
          P.push(warnPg(node.textContent.trim(), C.muted));
          P.push(sp(1.0));
          return;
        }
        if (cls.indexOf('quote') >= 0 || cls.indexOf('callout') >= 0 || cls.indexOf('alert') >= 0 || cls.indexOf('info-box') >= 0 || cls.indexOf('note') >= 0) {
          var bC = C.warn;
          if (cls.indexOf('info') >= 0 || cls.indexOf('tip') >= 0) bC = C.accent;
          if (cls.indexOf('success') >= 0 || cls.indexOf('positive') >= 0) bC = C.accent2;
          if (cls.indexOf('danger') >= 0 || cls.indexOf('error') >= 0 || cls.indexOf('negative') >= 0) bC = isDark ? '#f87171' : '#dc2626';
          P.push(warnPg(node.textContent.trim(), bC));
          P.push(sp(0.6));
          return;
        }
        if (cls.indexOf('inv-group') >= 0 || cls.indexOf('card-group') >= 0) {
          invGroupToParas(node);
          return;
        }
        if (cls.indexOf('timeline') >= 0) { timelineToCards(node); return; }
        if (cls.indexOf('footer-note') >= 0 || cls.indexOf('footer') >= 0 || cls.indexOf('copyright') >= 0) {
          P.push(sp(1.0));
          P.push(pg([tn(node.textContent.trim(), { fs: "fs13", fc: C.muted })]));
          return;
        }
        if (cls.indexOf('cta') >= 0 || cls.indexOf('btn-wrap') >= 0 || cls.indexOf('button-wrap') >= 0) {
          var ctaA = node.querySelector('a') || node;
          var ctaHref = (ctaA.getAttribute && ctaA.getAttribute('href')) || '';
          var ctaText = node.textContent.trim().split('\n')[0].trim();
          P.push(sp(0.8));
          P.push(pg([tn('🔗 ', { fs: "fs15", fc: C.accent }), tn(ctaText || ctaHref, { fs: "fs15", b: true, fc: C.accent, u: true })]));
          P.push(sp(0.8));
          return;
        }
        if (cls.indexOf('code') >= 0 || cls.indexOf('highlight') >= 0 || cls.indexOf('syntax') >= 0) {
          var pre = node.querySelector('pre');
          if (pre) { processNode(pre); return; }
        }
        if (cls.indexOf('tab') >= 0 || cls.indexOf('accordion') >= 0) {
          Array.from(node.childNodes).forEach(processNode);
          return;
        }
        if (cls.indexOf('grid') >= 0 || cls.indexOf('row') >= 0 || cls.indexOf('col') >= 0 || cls.indexOf('flex') >= 0) {
          Array.from(node.childNodes).forEach(processNode);
          return;
        }

        if (node.querySelector('table,h1,h2,h3,h4,h5,h6,hr,ul,ol,dl,blockquote,div,p,pre,figure,details,section,article')) {
          Array.from(node.childNodes).forEach(processNode);
          return;
        }

        var dNodes = extractNodes(node, { fc: C.body });
        if (dNodes.length > 0) P.push(pg(dNodes));
        return;
      }

      if (['FORM', 'FIELDSET', 'LEGEND', 'LABEL', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'DATALIST', 'OUTPUT', 'METER', 'PROGRESS'].indexOf(tag) >= 0) {
        if (tag === 'FIELDSET' || tag === 'FORM') { Array.from(node.childNodes).forEach(processNode); return; }
        if (tag === 'LEGEND') { P.push(pg([tn(node.textContent.trim(), { fs: "fs15", b: true, fc: C.text })])); return; }
        var val = node.getAttribute('placeholder') || node.getAttribute('value') || node.textContent.trim();
        if (val) P.push(pg([tn('[' + val + ']', { fs: "fs13", fc: C.muted })]));
        return;
      }

      if (['SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'NAV', 'HEADER', 'FOOTER', 'DIALOG', 'HGROUP', 'SEARCH'].indexOf(tag) >= 0) {
        Array.from(node.childNodes).forEach(processNode);
        return;
      }

      if (tag === 'SPAN') {
        var sNodes = extractNodes(node, { fc: C.body });
        if (sNodes.length > 0) P.push(pg(sNodes));
        return;
      }

      if (tag === 'PICTURE') {
        var pImg = node.querySelector('img');
        if (pImg) processNode(pImg);
        return;
      }
      if (tag === 'SOURCE') return;

      if (tag === 'BR') return;

      if (tag === 'RUBY') {
        var rNodes = extractNodes(node, { fc: C.body });
        if (rNodes.length > 0) P.push(pg(rNodes));
        return;
      }
      if (tag === 'RT' || tag === 'RP') return;

      if (['MAP', 'AREA', 'SVG', 'CANVAS', 'MATH'].indexOf(tag) >= 0) return;

      if (tag === 'UL' || tag === 'OL') {
        var isOrd = (tag === 'OL');
        var idx = 0;
        node.querySelectorAll(':scope > li').forEach(function(li) {
          idx++;
          var prefix = isOrd ? idx + '. ' : '▸ ';
          var hasNested = li.querySelector('ul,ol');
          if (hasNested) {
            var directText = '';
            li.childNodes.forEach(function(cn) {
              if (cn.nodeType === Node.TEXT_NODE) directText += cn.textContent;
              else if (cn.nodeType === Node.ELEMENT_NODE && cn.tagName !== 'UL' && cn.tagName !== 'OL') directText += cn.textContent;
            });
            directText = directText.trim();
            if (directText) P.push(pg([tn(prefix + directText, { fs: "fs15", fc: C.table })]));
            li.querySelectorAll(':scope > ul, :scope > ol').forEach(function(nested) { processNode(nested); });
          } else {
            var liNodes = extractNodes(li, { fc: C.table });
            if (liNodes.length > 0) {
              liNodes[0].value = prefix + liNodes[0].value;
              P.push(pg(liNodes));
            }
          }
        });
        return;
      }

      if (tag === 'A' && node.getAttribute('href')) {
        var href3 = node.getAttribute('href');
        if (href3.indexOf('http://') === 0 || href3.indexOf('https://') === 0) {
          P.push(sp(0.8));
          P.push(pg([
            tn('🔗 ', { fs: "fs15", fc: C.accent }),
            tn(node.textContent.trim() || href3, { fs: "fs15", b: true, fc: C.accent, u: true })
          ]));
          P.push(sp(0.8));
          return;
        }
      }

      Array.from(node.childNodes).forEach(processNode);
    }

    // ── 실행 ──
    P.push(sp(1.0));

    Array.from(body.childNodes).forEach(function(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        var tag2 = node.tagName.toUpperCase();
        if (['STYLE', 'SCRIPT', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'TEMPLATE'].indexOf(tag2) >= 0) return;
      }
      processNode(node);
    });

    P.push(sp(1.0));

    // ── 단일 megaCell로 감싸기 ──
    var megaCell = {
      "@ctype": "table",
      "id": uid(),
      "layout": "default",
      "align": "left",
      "width": 100,
      "columnCount": 1,
      "borderStyleName": "none",
      "borderInlineStyle": "border-style:none;border-width:0px;border-color:rgb(210,210,210);",
      "rows": [{
        "@ctype": "tableRow",
        "id": uid(),
        "cells": [{
          "@ctype": "tableCell",
          "id": uid(),
          "colSpan": 1,
          "rowSpan": 1,
          "width": 100,
          "height": 43,
          "backgroundColor": C.bg,
          "borderInlineStyle": "border-style:none;border-width:0px;border-color:rgb(210,210,210);",
          "value": P
        }]
      }]
    };

    return [megaCell];
  }

  // ========== HTML 파싱 함수 끝 ==========

  // ========== 주입 스크립트 관련 ==========

  let injectedScriptReady = false;

  /**
   * 페이지에 injected.js 주입
   */
  function injectScript() {
    return new Promise((resolve) => {
      if (injectedScriptReady) {
        resolve();
        return;
      }
      
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.onload = () => {
        injectedScriptReady = true;
        script.remove();
        resolve();
      };
      script.onerror = (e) => {
        resolve(); // 에러여도 계속 진행
      };
      
      (document.head || document.documentElement).appendChild(script);
    });
  }

  /**
   * 주입된 스크립트에 요청 보내기
   */
  function sendToInjectedScript(action, data = {}) {
    return new Promise((resolve, reject) => {
      const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      
      const handler = (event) => {
        if (event.detail && event.detail.requestId === requestId) {
          window.removeEventListener('nbc_response', handler);
          
          if (event.detail.error) {
            reject(new Error(event.detail.error));
          } else {
            resolve(event.detail.result);
          }
        }
      };
      
      window.addEventListener('nbc_response', handler);
      
      // 요청 전송
      window.dispatchEvent(new CustomEvent('nbc_request', {
        detail: { action, data, requestId }
      }));
      
      // 타임아웃
      setTimeout(() => {
        window.removeEventListener('nbc_response', handler);
        reject(new Error('요청 타임아웃'));
      }, 10000);
    });
  }

  /**
   * Background와 메시지 통신
   */
  async function sendMessage(action, data = {}) {
    try {
      const response = await chrome.runtime.sendMessage({ action, ...data });
      return response;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 사용자 정보 로드
   */
  /**
   * 사용자 정보 로드
   */
  async function loadUser() {
    try {
      const response = await sendMessage('getUser');
      if (response.success && response.user) {
        currentUser = response.user;
        return true;
      }
    } catch (error) {
    }
    return false;
  }

  /**
   * 공지사항 로드
   */
  async function loadNotice() {
    try {
      const url = 'https://firestore.googleapis.com/v1/projects/naver-blog-converter/databases/(default)/documents/notices?pageSize=5&orderBy=createdAt%20desc';
      const res = await fetch(url);
      const data = await res.json();
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
        noticeList = noticeList.slice(0, 5);
        activeNotice = noticeList.find(n => n.active) || null;
      }
    } catch (e) {
      console.log('공지사항 로드 실패:', e);
    }
  }

  /**
   * 사용량 정보 로드
   */
  async function loadUsage() {
    try {
      const response = await sendMessage('checkUsage');
      
      // success가 false가 아니면 성공으로 간주
      if (response && response.success !== false) {
        currentUsage = {
          count: response.count ?? response.usage?.count ?? 0,
          limit: response.limit ?? response.usage?.limit ?? 3,
          plan: response.plan ?? response.usage?.plan ?? 'free',
          unlimited: response.unlimited ?? response.usage?.unlimited ?? false,
          unlimitedEnd: response.unlimitedEnd ?? response.usage?.unlimitedEnd ?? '',
          unlimitedStart: response.unlimitedStart ?? response.usage?.unlimitedStart ?? ''
        };
        return true;
      }
    } catch (error) {
    }
    return false;
  }

  /**
   * 토스트 알림 표시
   */
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `nbc-toast nbc-toast-${type}`;
    toast.textContent = message;
    
    const colors = {
      success: COLORS.success,
      error: COLORS.danger,
      warning: COLORS.warning
    };
    
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 12px 24px;
      background: ${colors[type]};
      color: white;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 2147483647;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: nbc-toast-in 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'nbc-toast-out 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  /**
   * 변환 진행 상태 표시
   */
  function updateStatus(message) {
    var statusEl = container ? container.querySelector('#nbc-status') : null;
    if (statusEl) {
      statusEl.textContent = message || '이미지+텍스트 자동 혼합 변환 지원';
      statusEl.style.display = 'block';
    }
    if (message) console.log('[변환기]', message);
  }

  /**
   * CSS 스타일 삽입
   */
  function injectStyles() {
    if (document.getElementById('nbc-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'nbc-styles';
    style.textContent = `
      @keyframes nbc-toast-in {
        from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      @keyframes nbc-toast-out {
        from { opacity: 1; }
        to { opacity: 0; }
      }
      
      #nbc-container {
        position: fixed;
        top: 50px;
        right: 50px;
        width: 480px;
        min-width: 400px;
        min-height: 350px;
        max-width: 90vw;
        max-height: 90vh;
        background: ${COLORS.bgCard};
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        z-index: 2147483646;
        font-family: system-ui, -apple-system, 'Malgun Gothic', sans-serif;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid ${COLORS.border};
      }
      
      #nbc-container.nbc-minimized {
        height: auto !important;
        min-height: auto !important;
      }
      
      #nbc-container.nbc-minimized .nbc-content {
        display: none !important;
      }
      
      #nbc-container.nbc-minimized .nbc-resize-handle {
        display: none !important;
      }
      
      .nbc-header {
        background: linear-gradient(135deg, ${COLORS.primary}, ${COLORS.secondary});
        padding: 14px 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: move;
        user-select: none;
      }
      
      .nbc-title {
        color: white;
        font-size: 15px;
        font-weight: 600;
      }
      
      .nbc-header-btns {
        display: flex;
        gap: 6px;
      }
      
      .nbc-header-btns button {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 16px;
        transition: background 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .nbc-header-btns button:hover {
        background: rgba(255,255,255,0.3);
      }
      
      .nbc-content {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
      }
      
      .nbc-user-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: ${COLORS.bgMain};
        border-bottom: 1px solid ${COLORS.border};
        gap: 12px;
        flex-wrap: wrap;
      }
      
      .nbc-user-info {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .nbc-user-avatar {
        width: 24px;
        height: 24px;
        border-radius: 50%;
      }
      
      .nbc-user-email {
        font-size: 13px;
        color: ${COLORS.textPrimary};
        font-weight: 500;
      }
      
      .nbc-usage-info {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: ${COLORS.textSecondary};
      }
      
      .nbc-usage-dots {
        display: flex;
        gap: 4px;
      }
      
      .nbc-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      
      .nbc-dot.filled {
        background: ${COLORS.success};
      }
      
      .nbc-dot.empty {
        background: ${COLORS.border};
      }
      
      .nbc-pro-status {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: linear-gradient(135deg, #f5f3ff, #ede9fe);
        border-radius: 8px;
        font-size: 13px;
      }
      .nbc-plan-badge {
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 4px;
        letter-spacing: 0.5px;
      }
      .nbc-pro-unlimited {
        color: #6d28d9;
        font-weight: 600;
      }
      .nbc-pro-expire {
        color: #8b8b8b;
        font-size: 12px;
        margin-left: auto;
      }
      
      .nbc-notice-wrapper {
        position: relative;
        margin-bottom: 8px;
      }
      .nbc-notice-bar {
        background: #1a1a2e;
        border-radius: 4px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        overflow: hidden;
      }
      .nbc-notice-badge {
        background: #ff4757;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 3px;
        flex-shrink: 0;
      }
      .nbc-notice-title {
        color: #ffd700;
        font-size: 12px;
        font-weight: 700;
        flex-shrink: 0;
        max-width: 100px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .nbc-notice-divider {
        color: #555;
        font-size: 12px;
        flex-shrink: 0;
      }
      .nbc-notice-scroll-area {
        flex: 1;
        overflow: hidden;
      }
      .nbc-notice-msg {
        color: #e0e0e0;
        font-size: 12px;
        white-space: nowrap;
        display: inline-block;
        animation: nbc-scroll 10s linear infinite;
      }
      .nbc-notice-arrow {
        color: #888;
        font-size: 10px;
        flex-shrink: 0;
        transition: transform 0.2s;
      }
      .nbc-notice-arrow.open {
        transform: rotate(180deg);
      }
      .nbc-notice-link {
        color: #ffd700 !important;
        text-decoration: underline !important;
      }
      .nbc-notice-link:hover {
        color: #fff !important;
      }
      .nbc-notice-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: #1a1a2e;
        border-radius: 0 0 4px 4px;
        border-top: 1px solid #333;
        max-height: 200px;
        overflow-y: auto;
        z-index: 100;
      }
      .nbc-notice-item {
        padding: 8px 12px;
        border-bottom: 1px solid #2a2a3e;
        cursor: pointer;
      }
      .nbc-notice-item:last-child {
        border-bottom: none;
      }
      .nbc-notice-item:hover {
        background: #2a2a3e;
      }
      .nbc-notice-item.active {
        border-left: 3px solid #ff4757;
      }
      .nbc-notice-item-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .nbc-notice-item-title {
        color: #ffd700;
        font-size: 12px;
        font-weight: 600;
      }
      .nbc-notice-item-date {
        color: #666;
        font-size: 10px;
      }
      .nbc-notice-item-body {
        margin-top: 6px;
        color: #ccc;
        font-size: 11px;
        line-height: 1.5;
      }
      .nbc-notice-item-body a {
        color: #ffd700 !important;
      }
      @keyframes nbc-scroll {
        0% { transform: translateX(100%); }
        100% { transform: translateX(-100%); }
      }
      
      .nbc-logout-btn {
        background: transparent;
        border: 1px solid ${COLORS.border};
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 11px;
        color: ${COLORS.textSecondary};
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .nbc-logout-btn:hover {
        background: ${COLORS.danger};
        color: white;
        border-color: ${COLORS.danger};
      }
      
      .nbc-input-area {
        flex: 1;
        padding: 16px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      
      .nbc-input {
        width: 100%;
        flex: 1;
        min-height: 150px;
        padding: 12px;
        border: 1px solid ${COLORS.border};
        border-radius: 8px;
        background: ${COLORS.inputBg};
        font-size: 14px;
        line-height: 1.6;
        color: ${COLORS.textPrimary};
        overflow-y: auto;
        outline: none;
        transition: border-color 0.2s;
        box-sizing: border-box;
      }
      
      .nbc-input::-webkit-scrollbar {
        width: 8px;
      }
      
      .nbc-input::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 4px;
      }
      
      .nbc-input::-webkit-scrollbar-thumb {
        background: #c1c1c1;
        border-radius: 4px;
      }
      
      .nbc-input::-webkit-scrollbar-thumb:hover {
        background: #a1a1a1;
      }
      
      .nbc-input:focus {
        border-color: ${COLORS.primary};
      }
      
      .nbc-input:empty:before {
        content: attr(data-placeholder);
        color: ${COLORS.textMuted};
      }
      
      .nbc-preview-bar {
        padding: 10px 16px;
        background: ${COLORS.bgMain};
        font-size: 12px;
        color: ${COLORS.textSecondary};
        border-top: 1px solid ${COLORS.border};
      }
      
      .nbc-actions {
        display: flex;
        justify-content: space-between;
        padding: 12px 16px;
        gap: 12px;
      }
      
      .nbc-btn-clear {
        padding: 10px 20px;
        border: 1px solid ${COLORS.border};
        background: white;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        color: ${COLORS.textSecondary};
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .nbc-btn-clear:hover {
        background: ${COLORS.bgMain};
      }
      
      .nbc-btn-convert {
        flex: 1;
        padding: 10px 20px;
        border: none;
        background: linear-gradient(135deg, ${COLORS.success}, ${COLORS.successHover});
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        color: white;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .nbc-btn-convert:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
      }
      
      .nbc-btn-convert:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
      
      .nbc-footer {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border-top: 1px solid ${COLORS.border};
        font-size: 12px;
      }
      
      .nbc-footer a {
        color: ${COLORS.textSecondary};
        text-decoration: none;
        transition: color 0.2s;
      }
      
      .nbc-footer a:hover {
        color: ${COLORS.primary};
      }
      
      .nbc-divider {
        color: ${COLORS.border};
      }
      
      .nbc-resize-handle {
        position: absolute;
        z-index: 10;
        background: transparent;
      }
      
      .nbc-resize-e { right: 0; top: 50px; bottom: 10px; width: 6px; cursor: ew-resize; }
      .nbc-resize-w { left: 0; top: 50px; bottom: 10px; width: 6px; cursor: ew-resize; }
      .nbc-resize-s { bottom: 0; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
      .nbc-resize-n { top: 50px; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
      .nbc-resize-se { right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; }
      .nbc-resize-sw { left: 0; bottom: 0; width: 16px; height: 16px; cursor: nesw-resize; }
      .nbc-resize-ne { right: 0; top: 50px; width: 16px; height: 16px; cursor: nesw-resize; }
      .nbc-resize-nw { left: 0; top: 50px; width: 16px; height: 16px; cursor: nwse-resize; }
      
      .nbc-login-screen {
        padding: 40px 30px;
        text-align: center;
      }
      
      .nbc-logo {
        font-size: 48px;
        margin-bottom: 16px;
      }
      
      .nbc-login-screen h1 {
        font-size: 20px;
        color: ${COLORS.textPrimary};
        margin: 0 0 8px 0;
      }
      
      .nbc-desc {
        font-size: 13px;
        color: ${COLORS.textSecondary};
        line-height: 1.6;
        margin-bottom: 24px;
      }
      
      .nbc-google-login-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 100%;
        padding: 12px;
        background: white;
        border: 1px solid ${COLORS.border};
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        color: ${COLORS.textPrimary};
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .nbc-google-login-btn:hover {
        background: ${COLORS.bgMain};
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      }
      
      .nbc-google-login-btn img {
        width: 18px;
        height: 18px;
      }
      
      .nbc-features {
        margin: 24px 0;
        font-size: 13px;
        color: ${COLORS.textSecondary};
      }
      
      .nbc-features p {
        margin: 6px 0;
      }
      
      .nbc-footer-links {
        margin-top: 16px;
      }
      
      .nbc-footer-links a {
        color: ${COLORS.textSecondary};
        text-decoration: none;
        font-size: 12px;
        transition: color 0.2s;
      }
      
      .nbc-footer-links a:hover {
        color: ${COLORS.primary};
      }
      
      .nbc-limit-screen {
        padding: 40px 30px;
        text-align: center;
      }
      
      .nbc-limit-header {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-bottom: 12px;
      }
      
      .nbc-limit-header-btn {
        background: transparent;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        width: 32px;
        height: 32px;
        cursor: pointer;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .nbc-limit-header-btn:hover {
        background: #f3f4f6;
      }
      
      .nbc-limit-icon {
        font-size: 48px;
        margin-bottom: 16px;
      }
      
      .nbc-limit-screen h2 {
        font-size: 18px;
        color: ${COLORS.textPrimary};
        margin: 0 0 8px 0;
      }
      
      .nbc-limit-screen p {
        font-size: 13px;
        color: ${COLORS.textSecondary};
        margin-bottom: 24px;
      }
      
      .nbc-pro-upgrade-btn {
        width: 100%;
        padding: 12px;
        background: linear-gradient(135deg, ${COLORS.secondary}, #7C3AED);
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        color: white;
        cursor: pointer;
        margin-bottom: 16px;
        transition: all 0.2s;
      }
      
      .nbc-pro-upgrade-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
      }
      
      .nbc-kakao-link {
        display: inline-block;
        margin-top: 16px;
        padding: 12px 24px;
        background: #FEE500;
        color: #000000;
        text-decoration: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        transition: all 0.2s;
      }
      
      .nbc-kakao-link:hover {
        background: #E6CF00;
        transform: translateY(-2px);
      }
      
      /* 소진 화면 링크 영역 */
      .nbc-limit-links {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 16px;
        align-items: center;
      }
      
      /* 인라인 의견보내기 버튼 */
      .nbc-feedback-inline-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 24px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .nbc-feedback-inline-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      }
      
      .nbc-feedback-inline-btn .icon {
        font-size: 16px;
        animation: nbc-pulse 2s ease-in-out infinite;
      }
      
      /* 푸터 의견보내기 버튼 */
      .nbc-footer-feedback-btn {
        background: none;
        border: none;
        color: ${COLORS.textSecondary};
        font-size: 12px;
        cursor: pointer;
        padding: 0;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: color 0.2s;
      }
      
      .nbc-footer-feedback-btn:hover {
        color: ${COLORS.primary};
      }
      
      .nbc-feedback-icon {
        animation: nbc-pulse 2s ease-in-out infinite;
        display: inline-block;
      }
      
      @keyframes nbc-pulse {
        0%, 100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.3);
        }
      }
      
      /* 피드백 모달 */
      .nbc-feedback-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease;
      }
      
      .nbc-feedback-modal.show {
        opacity: 1;
        visibility: visible;
      }
      
      .nbc-feedback-content {
        background: white;
        border-radius: 16px;
        padding: 24px;
        width: 90%;
        max-width: 450px;
        max-height: 80vh;
        overflow-y: auto;
        transform: translateY(20px);
        transition: transform 0.3s ease;
      }
      
      .nbc-feedback-modal.show .nbc-feedback-content {
        transform: translateY(0);
      }
      
      .nbc-feedback-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }
      
      .nbc-feedback-header h3 {
        font-size: 18px;
        color: #1f2937;
        margin: 0;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .nbc-feedback-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #6b7280;
        padding: 0;
        line-height: 1;
      }
      
      .nbc-feedback-close:hover {
        color: #1f2937;
      }
      
      .nbc-feedback-form .form-group {
        margin-bottom: 16px;
      }
      
      .nbc-feedback-form label {
        display: block;
        font-size: 14px;
        font-weight: 500;
        color: #374151;
        margin-bottom: 6px;
      }
      
      .nbc-feedback-form select,
      .nbc-feedback-form textarea {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s;
        font-family: inherit;
      }
      
      .nbc-feedback-form select:focus,
      .nbc-feedback-form textarea:focus {
        border-color: #667eea;
      }
      
      .nbc-feedback-form textarea {
        min-height: 120px;
        resize: vertical;
      }
      
      .nbc-feedback-actions {
        display: flex;
        gap: 12px;
        margin-top: 20px;
      }
      
      .nbc-feedback-actions button {
        flex: 1;
        padding: 12px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .nbc-feedback-cancel {
        background: #f3f4f6;
        border: 1px solid #d1d5db;
        color: #374151;
      }
      
      .nbc-feedback-cancel:hover {
        background: #e5e7eb;
      }
      
      .nbc-feedback-submit {
        background: linear-gradient(135deg, #667eea, #764ba2);
        border: none;
        color: white;
      }
      
      .nbc-feedback-submit:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      }
      
      .nbc-feedback-submit:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }
    `;
    
    document.head.appendChild(style);
  }

  /**
   * 로그인 화면 렌더링
   */
  function renderLoginScreen() {
    return `
      <div class="nbc-login-screen">
        <div class="nbc-logo">📝</div>
        <h1>네이버 블로그 HTML 변환기</h1>
        <p class="nbc-desc">HTML을 네이버 블로그 에디터 형식으로<br>자동 변환해주는 도구입니다</p>
        
        <button class="nbc-google-login-btn" id="nbc-google-login">
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <g fill="#000" fill-rule="evenodd">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
              <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.951H.957C.348 6.174 0 7.55 0 9s.348 2.826.957 4.049l3.007-2.342z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.951L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </g>
          </svg>
          Google로 로그인
        </button>
        
        <div class="nbc-features">
          <p>✨ 하루 3회 무료 사용</p>
          <p>✨ Pro 업그레이드 시 무제한</p>
        </div>
        
        <div class="nbc-footer-links">
          <a href="${LINKS.kakaoChat}" target="_blank">💬 문의하기</a>
        </div>
      </div>
    `;
  }

  /**
   * 메인 화면 렌더링
   */
  function renderMainScreen() {
    // ✅ 사용량 초기값 처리
    if (!currentUsage || typeof currentUsage.count !== 'number') {
      currentUsage = { count: 0, limit: 3, plan: 'free', unlimited: false };
    }

    const isPro = currentUsage.plan === 'pro' || currentUsage.plan === 'master';
    const isUnlimited = currentUsage.limit === -1 || currentUsage.unlimited || isPro;

    let usageHTML = '';

    if (isPro) {
      const planLabel = currentUsage.plan === 'master' ? 'MASTER' : 'PRO';
      const planColor = currentUsage.plan === 'master' ? '#e74c3c' : '#8b5cf6';
      const endDate = currentUsage.unlimitedEnd || '';
      
      // ✅ 남은 일수 계산
      let daysLeftText = '';
      if (endDate) {
        const now = new Date();
        const end = new Date(endDate);
        const diffMs = end.getTime() - now.getTime();
        const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (daysLeft > 0) {
          daysLeftText = `${daysLeft}일 남음`;
        } else {
          daysLeftText = '만료됨';
        }
      }

      usageHTML = `
        <div class="nbc-pro-status">
          <span class="nbc-plan-badge" style="background:${planColor};">${planLabel}</span>
          <span class="nbc-pro-unlimited">무제한 이용 중</span>
          ${daysLeftText ? `<span class="nbc-pro-expire">${daysLeftText}</span>` : ''}
        </div>
      `;
    } else {
      // ✅ Free 사용자 - 기존 점(dot) 표시
      const remaining = Math.max(0, currentUsage.limit - currentUsage.count);
      const usageDots = [];
      for (let i = 0; i < currentUsage.limit; i++) {
        usageDots.push(`<span class="nbc-dot ${i < remaining ? 'filled' : 'empty'}"></span>`);
      }
      const usageText = `(${remaining}/${currentUsage.limit})`;

      usageHTML = `
        <div class="nbc-usage-info">
          <span>오늘 남은 횟수:</span>
          <div class="nbc-usage-dots">${usageDots.join('')}</div>
          <span class="nbc-usage-text">${usageText}</span>
        </div>
      `;
    }

    return `
      <div class="nbc-content">
        ${activeNotice ? `
  <div class="nbc-notice-wrapper">
    <div class="nbc-notice-bar" id="nbc-notice-toggle">
      <span class="nbc-notice-badge">공지</span>
      <span class="nbc-notice-title">${activeNotice.title}</span>
      <span class="nbc-notice-divider">|</span>
      <div class="nbc-notice-scroll-area">
        <span class="nbc-notice-msg">${activeNotice.message.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener" class="nbc-notice-link">$1</a>')}</span>
      </div>
      <span class="nbc-notice-arrow" id="nbc-notice-arrow">▼</span>
    </div>
    <div class="nbc-notice-dropdown" id="nbc-notice-dropdown" style="display:none;">
      ${noticeList.map(n => `
        <div class="nbc-notice-item ${n.id === activeNotice.id ? 'active' : ''}" data-notice-id="${n.id}">
          <div class="nbc-notice-item-header">
            <span class="nbc-notice-item-title">${n.title}</span>
            <span class="nbc-notice-item-date">${n.createdAt ? new Date(n.createdAt).toLocaleDateString('ko-KR') : ''}</span>
          </div>
          <div class="nbc-notice-item-body" style="display:none;">
            <p>${n.message.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener" class="nbc-notice-link">$1</a>')}</p>
          </div>
        </div>
      `).join('')}
    </div>
  </div>
` : ''}
        <div class="nbc-user-bar">
          <div class="nbc-user-info">
            <img class="nbc-user-avatar" src="${currentUser.photoURL || ''}" alt="" onerror="this.style.display='none'">
            <span class="nbc-user-email">${currentUser.email}</span>
          </div>
          ${usageHTML}
          <button class="nbc-logout-btn" id="nbc-logout">로그아웃</button>
        </div>
        
        <div class="nbc-input-area">
          <div class="nbc-input" contenteditable="true" id="nbc-input" data-placeholder="HTML 또는 서식있는 텍스트를 붙여넣으세요..."></div>
        </div>
        
        <div class="nbc-preview-bar">
          📋 감지: <span id="nbc-stats">텍스트 0 | 표 0 | 링크 0</span>
        </div>
        
        <div class="nbc-actions">
          <button class="nbc-btn-clear" id="nbc-clear">🗑️ 지우기</button>
          <button class="nbc-btn-convert" id="nbc-convert">📤 블로그에 삽입</button>
        </div>
        <div id="nbc-status" style="padding:8px 12px;font-size:12px;color:#6B7280;text-align:center;min-height:20px;">이미지+텍스트 자동 혼합 변환 지원</div>
        <div style="padding:6px 12px;font-size:11px;color:#9CA3AF;text-align:center;background:#F0F9FF;border-radius:6px;margin:4px 8px;">
          📌 HTML을 넣으면 이미지·텍스트가 자동 배치되어<br>네이버 에디터에 바로 삽입됩니다
        </div>
        
        <div class="nbc-footer">
          <a href="${LINKS.kakaoChat}" target="_blank">💬 문의하기</a>
          <span class="nbc-divider">│</span>
          <button class="nbc-footer-feedback-btn" id="nbc-footer-feedback-btn">
            <span class="nbc-feedback-icon">📝</span> 의견 보내기
          </button>
          ${!isPro ? `<span class="nbc-divider">│</span><a href="${LINKS.proUpgrade}" target="_blank" rel="noopener" class="nbc-pro-link">⭐ Pro 업그레이드</a>` : ''}
        </div>
      </div>
      
      <div class="nbc-resize-handle nbc-resize-e"></div>
      <div class="nbc-resize-handle nbc-resize-w"></div>
      <div class="nbc-resize-handle nbc-resize-s"></div>
      <div class="nbc-resize-handle nbc-resize-n"></div>
      <div class="nbc-resize-handle nbc-resize-se"></div>
      <div class="nbc-resize-handle nbc-resize-sw"></div>
      <div class="nbc-resize-handle nbc-resize-ne"></div>
      <div class="nbc-resize-handle nbc-resize-nw"></div>
    `;
  }

  /**
   * 횟수 소진 화면 렌더링
   */
  /**
   * 횟수 소진 화면 렌더링
   */
  function renderLimitScreen() {
    return `
      <div class="nbc-limit-screen">
        <div class="nbc-limit-header">
          <button id="nbc-limit-refresh" class="nbc-limit-header-btn" title="새로고침">🔄</button>
          <button id="nbc-limit-close" class="nbc-limit-header-btn" title="닫기">✕</button>
        </div>
        <div class="nbc-limit-icon">⚠️</div>
        <h2>오늘 사용 횟수를 모두 사용했습니다</h2>
        <p>내일 자정(00:00)에 초기화됩니다</p>
        
        <button class="nbc-pro-upgrade-btn" id="nbc-pro-upgrade">⭐ Pro 업그레이드 (무제한)</button>
        
        <div class="nbc-limit-links">
          <a href="${LINKS.kakaoChat}" target="_blank" class="nbc-kakao-link">💬 카카오톡 문의</a>
          <button class="nbc-feedback-inline-btn" id="nbc-limit-feedback-btn">
            <span class="icon">📝</span>
            <span>의견 보내기</span>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * UI 상태에 따라 화면 렌더링
   */
  function renderUI() {
    if (!container) {
      return;
    }

    let content = '';
    let hasHeader = false;
    
    if (currentState === UI_STATE.NOT_LOGGED_IN) {
      content = renderLoginScreen();
      hasHeader = false;
    } else if (currentState === UI_STATE.LIMIT_REACHED) {
      content = renderLimitScreen();
      hasHeader = false;
    } else {
      content = renderMainScreen();
      hasHeader = true;
    }

    // 헤더가 있는 경우와 없는 경우를 구분하여 렌더링
    if (hasHeader) {
      const existingHeader = container.querySelector('.nbc-header');
      const existingContent = container.querySelector('.nbc-content');
      
      if (existingHeader && existingContent) {
        // 헤더는 유지하고 내용만 교체
        existingContent.outerHTML = content;
      } else {
        // 처음 렌더링하는 경우
        container.innerHTML = `
          <div class="nbc-header">
            <div class="nbc-header-left">
              <span class="nbc-title">📝 네이버 블로그 HTML 변환기</span>
            </div>
            <div class="nbc-header-btns">
              <button class="nbc-btn-minimize" id="nbc-minimize">─</button>
              <button class="nbc-btn-close" id="nbc-close">×</button>
            </div>
          </div>
          ${content}
        `;
      }
    } else {
      // 헤더가 없는 경우 (로그인 화면, 횟수 소진 화면)
      const existingHeader = container.querySelector('.nbc-header');
      if (existingHeader) {
        existingHeader.remove();
      }
      container.innerHTML = content;
    }

    // 이벤트 리스너 등록
    attachEventListeners();
  }

  /**
   * 이벤트 리스너 등록
   */
  function attachEventListeners() {
    // Google 로그인 버튼
    const googleLoginBtn = document.getElementById('nbc-google-login');
    if (googleLoginBtn) {
      googleLoginBtn.onclick = handleGoogleLogin;
    }

    // 로그아웃 버튼
    const logoutBtn = document.getElementById('nbc-logout');
    if (logoutBtn) {
      logoutBtn.onclick = handleLogout;
    }

    // 지우기 버튼
    const clearBtn = document.getElementById('nbc-clear');
    if (clearBtn) {
      clearBtn.onclick = () => {
        const input = document.getElementById('nbc-input');
        if (input) {
          input.innerHTML = '';
          originalPastedHtml = '';
          originalPastedText = '';
          updatePreview('');
        }
      };
    }

    // 변환 버튼
    const convertBtn = document.getElementById('nbc-convert');
    if (convertBtn) {
      convertBtn.disabled = false; // 명시적으로 false
      convertBtn.onclick = handleConvert;
    }

    // 입력 변경 감지
    const input = document.getElementById('nbc-input');
    if (input) {
      // 붙여넣기 이벤트 핸들러 - 원본 HTML 캡처
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        
        const clipboardData = e.clipboardData || window.clipboardData;
        
        let html = clipboardData.getData('text/html');
        let text = clipboardData.getData('text/plain');
        
        // 코드 하이라이팅 감지 (hljs, highlight, prism, code-block 등)
        const isCodeHighlighted = html && (
          html.includes('hljs-') ||
          html.includes('highlight-') ||
          html.includes('prism-') ||
          html.includes('code-block') ||
          html.includes('CodeMirror') ||
          html.includes('monaco-')
        );
        
        if (isCodeHighlighted) {
          // text/plain이 HTML 태그를 포함하면 그걸 사용
          if (text && text.includes('<') && text.includes('>')) {
            originalPastedHtml = text;
          } else {
            // 그래도 없으면 html에서 텍스트만 추출
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            originalPastedHtml = tempDiv.textContent || tempDiv.innerText;
          }
        } else if (html && html.trim()) {
          // 일반 HTML
          originalPastedHtml = html;
        } else if (text && text.trim()) {
          // HTML 없으면 텍스트 사용
          originalPastedHtml = text;
        }
        
        originalPastedText = text;
        
        // 화면에 표시 (미리보기용)
        if (originalPastedHtml) {
          // HTML 파싱해서 텍스트만 표시
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = originalPastedHtml;
          const displayText = tempDiv.textContent || tempDiv.innerText;
          input.innerText = displayText.substring(0, 500) + (displayText.length > 500 ? '...' : '');
          
          updatePreview(originalPastedHtml);
        }
      });

      // 입력 시 미리보기 업데이트 (직접 타이핑)
      let debounceTimer;
      input.addEventListener('input', () => {
        // 직접 타이핑하면 원본 HTML 초기화
        if (!originalPastedHtml) {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            const html = input.innerHTML;
            updatePreview(html);
          }, 300);
        }
      });

      // 포커스 시 placeholder 처리
      input.addEventListener('focus', () => {
        if (input.innerText.trim() === '') {
          input.innerHTML = '';
        }
      });
    }

    // 최소화 버튼
    const minimizeBtn = document.getElementById('nbc-minimize');
    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', () => {
        isMinimized = !isMinimized;
        const content = container.querySelector('.nbc-content');
        const resizeHandles = container.querySelectorAll('.nbc-resize-handle');
        
        if (isMinimized) {
          // 축소
          if (content) content.style.display = 'none';
          resizeHandles.forEach(h => h.style.display = 'none');
          container.style.height = 'auto';
          container.style.minHeight = 'auto';
          minimizeBtn.textContent = '□';
        } else {
          // 확대
          if (content) content.style.display = 'flex';
          resizeHandles.forEach(h => h.style.display = 'block');
          container.style.height = '';
          container.style.minHeight = '350px';
          minimizeBtn.textContent = '─';
        }
      });
    }

    // 닫기 버튼
    const closeBtn = document.getElementById('nbc-close');
    if (closeBtn) {
      closeBtn.onclick = () => {
        container.style.display = 'none';
      };
    }

    // Pro 업그레이드 버튼
    const proUpgradeBtn = document.getElementById('nbc-pro-upgrade');
    if (proUpgradeBtn) {
      proUpgradeBtn.onclick = () => {
        window.open(LINKS.proUpgrade, '_blank', 'noopener');
      };
    }

    // 소진 화면 새로고침 버튼
    const limitRefreshBtn = document.getElementById('nbc-limit-refresh');
    if (limitRefreshBtn) {
      limitRefreshBtn.addEventListener('click', async () => {
        // 서비스 워커에 강제 갱신 요청
        chrome.runtime.sendMessage({ 
          action: 'forceRefreshUsage', 
          email: currentUser?.email 
        }, async (response) => {
          await updateState();
          renderUI();
        });
      });
    }

    // 소진 화면 닫기 버튼
    const limitCloseBtn = document.getElementById('nbc-limit-close');
    if (limitCloseBtn) {
      limitCloseBtn.addEventListener('click', () => {
        const container = document.getElementById('nbc-container');
        if (container) {
          container.style.display = 'none';
        }
      });
    }

    // 소진 화면 의견보내기 버튼
    const limitFeedbackBtn = document.getElementById('nbc-limit-feedback-btn');
    if (limitFeedbackBtn) {
      limitFeedbackBtn.addEventListener('click', openFeedbackModal);
    }

    // 푸터 의견보내기 버튼
    const footerFeedbackBtn = document.getElementById('nbc-footer-feedback-btn');
    if (footerFeedbackBtn) {
      footerFeedbackBtn.addEventListener('click', openFeedbackModal);
    }

    // 공지 토글
    const noticeToggle = document.getElementById('nbc-notice-toggle');
    if (noticeToggle) {
      noticeToggle.addEventListener('click', (e) => {
        if (e.target.closest('.nbc-notice-link')) return; // 링크 클릭은 무시
        const dropdown = document.getElementById('nbc-notice-dropdown');
        const arrow = document.getElementById('nbc-notice-arrow');
        if (dropdown) {
          const isOpen = dropdown.style.display !== 'none';
          dropdown.style.display = isOpen ? 'none' : 'block';
          if (arrow) arrow.classList.toggle('open', !isOpen);
        }
      });
    }

    // 공지 아이템 클릭 (아코디언)
    const noticeItems = document.querySelectorAll('.nbc-notice-item');
    noticeItems.forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.nbc-notice-link')) return;
        const body = item.querySelector('.nbc-notice-item-body');
        if (body) {
          const isOpen = body.style.display !== 'none';
          // 다른 것들 닫기
          document.querySelectorAll('.nbc-notice-item-body').forEach(b => b.style.display = 'none');
          body.style.display = isOpen ? 'none' : 'block';
        }
      });
    });

    // 드래그 및 리사이즈 이벤트는 별도 함수에서 처리
    setupDragAndResize();
  }

  /**
   * 드래그 및 리사이즈 설정
   */
  function setupDragAndResize() {
    const header = container?.querySelector('.nbc-header');
    if (!header) return;

    // 드래그 시작
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.nbc-header-btns')) return;
      isDragging = true;
      dragStartX = e.clientX - container.offsetLeft;
      dragStartY = e.clientY - container.offsetTop;
      e.preventDefault();
    });

    // 리사이즈 핸들 이벤트
    const resizeHandles = container?.querySelectorAll('.nbc-resize-handle');
    resizeHandles?.forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizeDirection = handle.className.split(' ')[1].replace('nbc-resize-', '');
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeStartWidth = container.offsetWidth;
        resizeStartHeight = container.offsetHeight;
        e.preventDefault();
        e.stopPropagation();
      });
    });

    // 마우스 이동
    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const newX = e.clientX - dragStartX;
        const newY = e.clientY - dragStartY;
        
        // 화면 경계 체크
        const maxX = window.innerWidth - container.offsetWidth;
        const maxY = window.innerHeight - container.offsetHeight;
        
        container.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
        container.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
        container.style.right = 'auto';
        saveWindowPosition();
      } else if (isResizing) {
        const deltaX = e.clientX - resizeStartX;
        const deltaY = e.clientY - resizeStartY;
        
        let newWidth = resizeStartWidth;
        let newHeight = resizeStartHeight;
        
        if (resizeDirection.includes('e')) {
          newWidth = resizeStartWidth + deltaX;
        }
        if (resizeDirection.includes('w')) {
          newWidth = resizeStartWidth - deltaX;
        }
        if (resizeDirection.includes('s')) {
          newHeight = resizeStartHeight + deltaY;
        }
        if (resizeDirection.includes('n')) {
          newHeight = resizeStartHeight - deltaY;
        }
        
        // 최소/최대 크기 제한
        const minWidth = 400;
        const minHeight = 350;
        const maxWidth = window.innerWidth * 0.9;
        const maxHeight = window.innerHeight * 0.9;
        
        newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
        newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));
        
        container.style.width = newWidth + 'px';
        container.style.height = newHeight + 'px';
        
        if (resizeDirection.includes('w')) {
          const deltaWidth = newWidth - resizeStartWidth;
          container.style.left = (container.offsetLeft - deltaWidth) + 'px';
        }
        if (resizeDirection.includes('n')) {
          const deltaHeight = newHeight - resizeStartHeight;
          container.style.top = (container.offsetTop - deltaHeight) + 'px';
        }
        
        saveWindowPosition();
      }
    });

    // 마우스 업
    document.addEventListener('mouseup', () => {
      isDragging = false;
      isResizing = false;
    });
  }

  /**
   * 창 위치 저장
   */
  async function saveWindowPosition() {
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const position = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    
    try {
      await chrome.storage.local.set({ 'nbc_window_position': position });
    } catch (error) {
    }
  }

  /**
   * 창 위치 로드
   */
  async function loadWindowPosition() {
    try {
      const result = await chrome.storage.local.get('nbc_window_position');
      if (result.nbc_window_position && container) {
        const pos = result.nbc_window_position;
        container.style.left = pos.left + 'px';
        container.style.top = pos.top + 'px';
        if (pos.width) container.style.width = pos.width + 'px';
        if (pos.height) container.style.height = pos.height + 'px';
        container.style.right = 'auto';
      }
    } catch (error) {
    }
  }

  /**
   * Google 로그인 처리
   */
  async function handleGoogleLogin() {
    try {
      showToast('로그인 중...', 'info');
      const response = await sendMessage('login');
      
      if (response.success && response.user) {
        currentUser = response.user;
        await loadNotice();
        await loadUsage();
        updateState();
        showToast('로그인 성공!', 'success');
      } else {
        showToast(response.error || '로그인 실패', 'error');
      }
    } catch (error) {
      showToast('로그인 중 오류가 발생했습니다.', 'error');
    }
  }

  /**
   * 로그아웃 처리
   */
  async function handleLogout() {
    try {
      const response = await sendMessage('logout');
      if (response.success) {
        currentUser = null;
        currentUsage = { count: 0, limit: 3, plan: 'free' };
        updateState();
        showToast('로그아웃되었습니다.', 'success');
      }
    } catch (error) {
    }
  }

  /**
   * 상태 업데이트
   */
  async function updateState() {
    // 사용자 정보 확인
    const userLoaded = await loadUser();
    
    if (!userLoaded || !currentUser) {
      currentState = UI_STATE.NOT_LOGGED_IN;
      renderUI();
      return;
    }
    
    // 사용량 확인 - 캐시 없이 항상 새로 요청
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ 
        action: 'checkUsage', 
        email: currentUser.email 
      }, resolve);
    });
    
    if (response && response.success !== false) {
      currentUsage = {
        count: response.count ?? response.usage?.count ?? 0,
        limit: response.limit ?? response.usage?.limit ?? 3,
        plan: response.plan ?? response.usage?.plan ?? 'free',
        unlimited: response.unlimited ?? response.usage?.unlimited ?? false,
        unlimitedEnd: response.unlimitedEnd ?? response.usage?.unlimitedEnd ?? '',
        unlimitedStart: response.unlimitedStart ?? response.usage?.unlimitedStart ?? ''
      };
      
      // 상태 결정
      if (currentUsage.unlimited || currentUsage.limit === -1) {
        currentState = UI_STATE.LOGGED_IN;
      } else if (currentUsage.count >= currentUsage.limit) {
        currentState = UI_STATE.LIMIT_REACHED;
      } else {
        currentState = UI_STATE.LOGGED_IN;
      }
    } else {
      currentUsage = { count: 0, limit: 3, plan: 'free', unlimited: false };
      currentState = UI_STATE.LOGGED_IN;
    }
    
    renderUI();
  }

  /**
   * 미리보기 업데이트
   */
  /**
   * 미리보기 업데이트 (감지된 요소 수 표시)
   */
  function updatePreview(html) {
    const statsEl = document.getElementById('nbc-stats');
    if (!statsEl) return;
    
    if (!html || html.trim() === '') {
      statsEl.textContent = '텍스트 0 | 표 0 | 링크 0';
      return;
    }
    
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      const textCount = doc.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, span').length;
      const tableCount = doc.querySelectorAll('table').length;
      const linkCount = doc.querySelectorAll('a[href]').length;
      
      statsEl.textContent = `텍스트 ${textCount} | 표 ${tableCount} | 링크 ${linkCount}`;
    } catch (e) {
      statsEl.textContent = '파싱 중...';
    }
  }

  /**
   * 네이버 블로그 글쓰기 페이지인지 확인
   */
  async function isNaverBlogWritePage() {
    if (!window.location.href.includes('blog.naver.com')) {
      return false;
    }
    
    try {
      // 주입 스크립트 로드
      await injectScript();
      
      // 에디터 체크 요청
      const result = await sendToInjectedScript('checkEditor');
      
      return result && result.found;
      
    } catch (error) {
      return false;
    }
  }

  /**
   * 네이버 에디터에 컴포넌트 삽입
   * @param {Array} components - SE 에디터 컴포넌트 배열
   */
  async function insertToNaverEditor(components) {
    // 주입 스크립트 로드
    await injectScript();
    
    // 삽입 요청
    const result = await sendToInjectedScript('insertComponents', { components });
    
    return result;
  }

  /**
   * 변환 처리
   */
  async function handleConvert() {
    try {
      const input = document.getElementById('nbc-input');
      if (!input) {
        showToast('입력 영역을 찾을 수 없습니다.', 'error');
        return;
      }
      
      // 원본 HTML 또는 입력 내용 사용
      const htmlToConvert = originalPastedHtml || input.innerHTML;
      
      if (!htmlToConvert || htmlToConvert.trim() === '' || htmlToConvert === '<br>') {
        showToast('붙여넣을 내용이 없습니다.', 'error');
        return;
      }
      
      // 네이버 블로그 페이지 체크
      const isBlogPage = await isNaverBlogWritePage();
      if (!isBlogPage) {
        showToast('네이버 블로그 글쓰기 페이지에서 사용해주세요.', 'error');
        return;
      }
      
      // 사용량 확인
      const usageResponse = await sendMessage('checkUsage');
      if (!usageResponse || !usageResponse.success) {
        showToast('사용량 확인 중 오류가 발생했습니다.', 'error');
        return;
      }
      
      // 무제한이 아니고 횟수 초과면 제한 화면
      if (!usageResponse.unlimited && usageResponse.limit !== -1 && usageResponse.count >= usageResponse.limit) {
        showToast('오늘 사용 횟수를 모두 사용했습니다.', 'error');
        updateState();
        return;
      }
      
      // 변환 버튼 비활성화
      const convertBtn = document.getElementById('nbc-convert');
      if (convertBtn) {
        convertBtn.disabled = true;
        convertBtn.textContent = '변환 중...';
      }
      
      showToast('변환 중...', 'info');

      var components;
      try {
        updateStatus('변환 시작...');
        components = await convertHtmlToNaverComponents(htmlToConvert, function(msg) {
          updateStatus(msg);
        });
      } catch (e) {
        console.warn('이미지 포함 변환 실패, 기존 방식으로 대체:', e.message);
        updateStatus('⚠️ 이미지 없이 텍스트만 변환합니다...');
        try {
          components = parseHtmlToComponents(htmlToConvert);
        } catch (e2) {
          updateStatus('❌ 실패: ' + e2.message);
          showToast('변환 실패: ' + e2.message, 'error');
          if (convertBtn) { convertBtn.disabled = false; convertBtn.textContent = '📤 블로그에 삽입'; }
          return;
        }
        if (components && components.length > 0) {
          updateStatus('⚠️ 이미지 없이 텍스트만 삽입됨');
        }
      }

      if (!components || components.length === 0) {
        updateStatus('변환할 내용이 없습니다.');
        showToast('변환할 내용이 없습니다.', 'warning');
        if (convertBtn) {
          convertBtn.disabled = false;
          convertBtn.textContent = '📤 블로그에 삽입';
        }
        return;
      }

      // 네이버 에디터에 삽입
      await insertToNaverEditor(components);

      // 사용량 증가
      const response = await sendMessage('useConversion');
      if (response.success) {
        currentUsage = response.usage;
        updateState();
        updateStatus('✅ 삽입 완료! (' + components.length + '개 컴포넌트)');
        showToast('✅ 블로그에 삽입되었습니다!', 'success');
        
        // 입력 영역 초기화
        input.innerHTML = '';
        originalPastedHtml = '';
        originalPastedText = '';
        updatePreview('');
      } else {
        showToast(response.error || '사용량 증가 실패', 'error');
      }
      
      // 변환 버튼 활성화
      if (convertBtn) {
        convertBtn.disabled = false;
        convertBtn.textContent = '📤 블로그에 삽입';
      }
      
    } catch (error) {
      showToast('변환 중 오류가 발생했습니다: ' + error.message, 'error');
    } finally {
      // 변환 버튼 항상 활성화
      const convertBtn = document.getElementById('nbc-convert');
      if (convertBtn) {
        convertBtn.disabled = false;
        convertBtn.textContent = '📤 블로그에 삽입';
      }
    }
  }

  /**
   * UI 초기화
   */
  async function initUI() {
    // 스타일 삽입
    injectStyles();
    
    // 컨테이너 생성
    container = document.getElementById('nbc-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'nbc-container';
      document.body.appendChild(container);
    }
    
    // 창 위치 로드
    await loadWindowPosition();
    
    // 저장된 로그인 정보 자동 복원
    await loadUser();
    
    // 공지사항 로드
    await loadNotice();
    
    // 사용량 정보 및 상태 업데이트
    await updateState();
    
    // 피드백 모달 초기화 (한 번만)
    initFeedbackModal();
  }

  /**
   * UI 토글
   */
  async function toggleUI() {
    if (!container) {
      await initUI();
      return;
    }
    
    if (container.style.display === 'none' || !container.style.display) {
      // 열 때마다 상태 새로 확인
      await updateState();
      container.style.display = 'flex';
    } else {
      container.style.display = 'none';
    }
  }

  // 메시지 리스너
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggleUI') {
      toggleUI();
      sendResponse({ success: true });
    }
    return true;
  });

  // 전역 함수 노출
  window.toggleNaverBlogConverter = toggleUI;
  
  // 즉시 초기화 (페이지 로드 상태와 관계없이)
  /**
   * 피드백 모달 초기화 (한 번만 생성)
   */
  function initFeedbackModal() {
    // 기존 모달 있으면 제거
    const existingModal = document.getElementById('nbc-feedback-modal');
    if (existingModal) existingModal.remove();
    
    // 피드백 모달 생성
    const feedbackModal = document.createElement('div');
    feedbackModal.id = 'nbc-feedback-modal';
    feedbackModal.className = 'nbc-feedback-modal';
    feedbackModal.innerHTML = `
      <div class="nbc-feedback-content">
        <div class="nbc-feedback-header">
          <h3>💬 의견 보내기</h3>
          <button class="nbc-feedback-close" id="nbc-feedback-close">&times;</button>
        </div>
        
        <form class="nbc-feedback-form" id="nbc-feedback-form">
          <div class="form-group">
            <label>유형</label>
            <select id="nbc-feedback-type">
              <option value="bug">🐛 버그 신고</option>
              <option value="feature">💡 기능 제안</option>
              <option value="improve">✨ 개선 요청</option>
              <option value="other">📝 기타 의견</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>내용</label>
            <textarea id="nbc-feedback-message" placeholder="의견을 자유롭게 작성해주세요..."></textarea>
          </div>
          
          <div class="nbc-feedback-actions">
            <button type="button" class="nbc-feedback-cancel" id="nbc-feedback-cancel">취소</button>
            <button type="submit" class="nbc-feedback-submit" id="nbc-feedback-submit">보내기</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(feedbackModal);
    
    // 이벤트 리스너
    document.getElementById('nbc-feedback-close').addEventListener('click', () => {
      feedbackModal.classList.remove('show');
    });
    
    document.getElementById('nbc-feedback-cancel').addEventListener('click', () => {
      feedbackModal.classList.remove('show');
    });
    
    // 모달 바깥 클릭 시 닫기
    feedbackModal.addEventListener('click', (e) => {
      if (e.target === feedbackModal) {
        feedbackModal.classList.remove('show');
      }
    });
    
    // 폼 제출
    document.getElementById('nbc-feedback-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await submitFeedback();
    });
  }

  /**
   * 피드백 모달 열기
   */
  function openFeedbackModal() {
    const feedbackModal = document.getElementById('nbc-feedback-modal');
    if (feedbackModal) {
      feedbackModal.classList.add('show');
    }
  }

  /**
   * 피드백 제출
   */
  async function submitFeedback() {
    const type = document.getElementById('nbc-feedback-type').value;
    const message = document.getElementById('nbc-feedback-message').value.trim();
    
    if (!message) {
      showToast('내용을 입력해주세요.', 'error');
      return;
    }
    
    const submitBtn = document.getElementById('nbc-feedback-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = '전송 중...';
    
    try {
      // 사용자 정보 가져오기
      const userResult = await chrome.storage.local.get(['user']);
      const userEmail = userResult.user?.email || 'anonymous';
      
      // 피드백 데이터 구성
      const feedbackData = {
        type,
        message,
        userEmail,
        userAgent: navigator.userAgent,
        url: window.location.href,
        createdAt: new Date().toISOString()
      };
      
      // Firestore에 저장
      await saveFeedbackToFirestore(feedbackData);
      
      // EmailJS로 이메일 알림 전송
      await sendFeedbackNotification(feedbackData);
      
      showToast('의견이 전송되었습니다. 감사합니다! 🙏', 'success');
      
      // 폼 초기화 및 모달 닫기
      document.getElementById('nbc-feedback-message').value = '';
      document.getElementById('nbc-feedback-modal').classList.remove('show');
      
    } catch (error) {
      showToast('전송 실패. 다시 시도해주세요.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '보내기';
    }
  }

  /**
   * Firestore에 피드백 저장
   */
  async function saveFeedbackToFirestore(feedback) {
    const projectId = 'naver-blog-converter';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/feedbacks`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          type: { stringValue: feedback.type },
          message: { stringValue: feedback.message },
          userEmail: { stringValue: feedback.userEmail },
          userAgent: { stringValue: feedback.userAgent },
          url: { stringValue: feedback.url },
          createdAt: { stringValue: feedback.createdAt },
          status: { stringValue: 'new' }
        }
      })
    });
    
    if (!response.ok) {
      throw new Error('Firestore 저장 실패');
    }
    
    return await response.json();
  }

  /**
   * 피드백 알림 전송 (EmailJS 사용)
   */
  async function sendFeedbackNotification(feedback) {
    const EMAILJS_SERVICE_ID = 'service_anhduso';
    const EMAILJS_TEMPLATE_ID = 'template_j8v2p0m';
    const EMAILJS_PUBLIC_KEY = 'frH_GVbDS8v-gcxmS';
    
    try {
      const typeNames = {
        bug: '🐛 버그 신고',
        feature: '💡 기능 제안',
        improve: '✨ 개선 요청',
        other: '📝 기타 의견'
      };
      
      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: EMAILJS_SERVICE_ID,
          template_id: EMAILJS_TEMPLATE_ID,
          user_id: EMAILJS_PUBLIC_KEY,
          template_params: {
            title: '새로운 피드백',
            feedback_type: typeNames[feedback.type] || feedback.type,
            from_name: feedback.userEmail,
            from_email: feedback.userEmail,
            timestamp: new Date(feedback.createdAt).toLocaleString('ko-KR'),
            message: feedback.message
          }
        })
      });
      
    } catch (error) {
    }
  }

})();
