/**
 * HACHIHI Network & Electrical Designer — Google Apps Script Webhook
 *
 * Hướng dẫn cài đặt:
 * 1. Mở Google Sheet muốn lưu nhật ký -> Tiện ích mở rộng (Extensions) -> Apps Script.
 * 2. Dán toàn bộ mã này vào tệp Code.gs và lưu lại.
 * 3. Vào Cài đặt dự án (Project Settings) -> Thuộc tính tập lệnh (Script properties):
 *    - Thêm thuộc tính: SERECT_SHEET = <chuỗi bí mật dài, ngẫu nhiên>
 *    - (Tùy chọn) Thêm SHEET_NAME = Tracking nếu muốn ghi vào sheet tên cụ thể; mặc định ghi vào sheet đầu tiên.
 * 4. Bấm Triển khai (Deploy) -> Tùy chọn triển khai mới (New deployment) -> Loại: Ứng dụng web (Web app):
 *    - Thực thi dưới dạng (Execute as): Tôi (Me)
 *    - Người có quyền truy cập (Who has access): Bất kỳ ai (Anyone)
 * 5. Sao chép URL Web app (dạng https://script.google.com/macros/s/.../exec)
 *    và cấu hình URL_SHEET + SERECT_SHEET trên Vercel rồi Redeploy.
 *
 * Lưu ý: Mỗi lần chỉnh sửa tệp Code.gs, phải Deploy thêm một version mới để thay đổi có hiệu lực.
 */

var SHEET_HEADERS = [
  'time',
  'ip',
  'Quốc gia',
  'Thành Phố',
  'VisitID',
  'SessionID',
  'Action',
  'detail',
  'device',
  'language',
  'resolution'
];

var ALLOWED_ACTIONS = {
  visit: true,
  template: true,
  save: true,
  export: true
};

function timingSafeEqual_(a, b) {
  var strA = String(a || '');
  var strB = String(b || '');
  if (!strA || !strB) return false;
  var maxLen = Math.max(strA.length, strB.length);
  var diff = strA.length ^ strB.length;
  for (var i = 0; i < maxLen; i++) {
    var codeA = i < strA.length ? strA.charCodeAt(i) : 0;
    var codeB = i < strB.length ? strB.charCodeAt(i) : 0;
    diff |= codeA ^ codeB;
  }
  return diff === 0;
}

function sanitizeCell_(value, maxLen) {
  var str = value === null || value === undefined ? '' : String(value);
  str = str.replace(/[\r\n\0]+/g, ' ').trim();
  if (maxLen && str.length > maxLen) {
    str = str.slice(0, maxLen);
  }
  if (!str) return '';
  // Guard Google Sheets formula injection without double-prefixing if server already prefixed "'"
  if (str.charAt(0) !== "'" && /^[\s\t]*[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return str;
}

function getConfiguredSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('SERECT_SHEET') || props.getProperty('SECRET_SHEET') || '';
  return String(secret).trim();
}

function getTargetSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  var props = PropertiesService.getScriptProperties();
  var configuredName = String(props.getProperty('SHEET_NAME') || '').trim();
  var sheet = configuredName ? ss.getSheetByName(configuredName) : null;
  if (!sheet) {
    sheet = ss.getSheets()[0] || ss.insertSheet(configuredName || 'Tracking');
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SHEET_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return jsonResponse_({ ok: true, service: 'hachihi-tracker' });
}

function doPost(e) {
  var lock = null;
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ ok: true, skipped: true });
    }

    var expectedSecret = getConfiguredSecret_();
    if (!expectedSecret) {
      return jsonResponse_({ ok: true, skipped: true });
    }

    var payload = JSON.parse(e.postData.contents);
    if (!payload || typeof payload !== 'object') {
      return jsonResponse_({ ok: true, skipped: true });
    }

    if (!timingSafeEqual_(payload.secret, expectedSecret)) {
      return jsonResponse_({ ok: true, skipped: true });
    }

    var action = sanitizeCell_(payload.action, 32);
    var visitId = sanitizeCell_(payload.visitId, 80);
    var sessionId = sanitizeCell_(payload.sessionId, 80);
    if (!ALLOWED_ACTIONS[action] || !visitId || !sessionId) {
      return jsonResponse_({ ok: true, skipped: true });
    }

    var row = [
      sanitizeCell_(payload.time, 40),
      sanitizeCell_(payload.ip, 64),
      sanitizeCell_(payload.country, 64),
      sanitizeCell_(payload.city, 100),
      visitId,
      sessionId,
      action,
      sanitizeCell_(payload.detail, 300),
      sanitizeCell_(payload.device, 120),
      sanitizeCell_(payload.language, 32),
      sanitizeCell_(payload.resolution, 32)
    ];

    lock = LockService.getScriptLock();
    lock.waitLock(3000);

    var sheet = getTargetSheet_();
    if (!sheet) {
      return jsonResponse_({ ok: true, skipped: true });
    }
    sheet.appendRow(row);
    return jsonResponse_({ ok: true });
  } catch (_err) {
    return jsonResponse_({ ok: true, skipped: true });
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (_releaseErr) {
        // ignore lock release failure
      }
    }
  }
}
