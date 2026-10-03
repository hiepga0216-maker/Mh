'use strict';
// =====================================================================
// BACKEND DUY NHAT (Vercel Function) - Diem Truong My Hoa, Truong MN Bac Gianh
// Moi yeu cau goi toi:  /api?r=<ten-chuc-nang>
// Du lieu luu o Upstash Redis (them qua Vercel > Storage).
// Khoa 06:00 sang va mo chu ky moi 17:30 duoc "tu dong bu" ngay khi co
// nguoi truy cap dau tien sau moc gio -> khong can Cron Job.
// =====================================================================
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

const K = {
  students: 'myhoa:students',      // hash: id -> hoc sinh (JSON)
  meta: 'myhoa:meta',              // hash: lastResetDate, lastLockDate
  history: 'myhoa:history',        // mang lich su theo ngay
  urls: 'myhoa:messengerUrls',     // hash: classId -> link nhom chat
  cycleLock: 'myhoa:cycle-lock'    // khoa ngan xu ly trung lap
};
const CLASS_IDS = ['NT_A', 'NT_B', 'MAM_A', 'MAM_B', 'CHOI_A', 'CHOI_B', 'LA_A', 'LA_B'];
const MEAL_PRICE = 20000;
const PENDING_MARK = 'Mặc định';
const PENDING_NOTE = 'Chưa chọn - Chờ phụ huynh phản hồi';
const RESET_MINUTES = 17 * 60 + 30; // 17:30 mo chu ky moi
const LOCK_MINUTES = 6 * 60;        // 06:00 khoa chu ky

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- Redis ----------
let _redis = null;
function db() {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new HttpError(500, 'Chưa kết nối cơ sở dữ liệu Redis (thiếu biến môi trường). Hãy làm bước "Thêm cơ sở dữ liệu" trong hướng dẫn.');
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}
function parse(v) {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return v; } }
  return v;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Gio Viet Nam (UTC+7), khong phu thuoc may chu ----------
function ymd(d) { return d.toISOString().slice(0, 10); }
function vnNow() {
  const d = new Date(Date.now() + 7 * 3600000);
  return { date: ymd(d), hour: d.getUTCHours(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() };
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function dowOf(dateStr) { return new Date(dateStr + 'T00:00:00Z').getUTCDay(); }
// Ngay mo chu ky gan nhat (17:30). Chieu Thu 6 (5) va Thu 7 (6) khong mo chu ky.
function latestResetDate(now) {
  let d = now.minutes >= RESET_MINUTES ? now.date : addDays(now.date, -1);
  while (dowOf(d) === 5 || dowOf(d) === 6) d = addDays(d, -1);
  return d;
}

// ---------- Tien ich du lieu ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function maskPhones(text) { // chi hien 3 so dau + 4 so cuoi
  return String(text == null ? '' : text).replace(/\d{8,12}/g, (m) => m.slice(0, 3) + '*'.repeat(m.length - 7) + m.slice(-4));
}
function money(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function pad(n) { return String(n).padStart(2, '0'); }
function newId(i) { return Date.now() * 1000 + (i === undefined ? Math.floor(Math.random() * 1000) : i); }

async function listStudents() {
  const h = (await db().hgetall(K.students)) || {};
  return Object.values(h).map(parse).filter((s) => s && typeof s === 'object')
    .sort((a, b) => (Number(a.id) - Number(b.id)) || 0);
}
async function getStudent(id) {
  const s = parse(await db().hget(K.students, String(id)));
  return s && typeof s === 'object' ? s : null;
}
async function putStudents(map) {
  if (Object.keys(map).length) await db().hset(K.students, map);
}
function maskedCopy(s) { return Object.assign({}, s, { parentInfo: maskPhones(s.parentInfo) }); }
function pendingState(s) {
  return Object.assign({}, s, {
    mealStatus: 'PENDING', reportTime: PENDING_MARK, isPresent: true, fineCharged: false,
    deductionAmount: 0, absenceReason: '', note: PENDING_NOTE
  });
}
function newStudent(name, classId, parentInfo, id) {
  return pendingState({ id, name, classId, parentInfo });
}

async function archive(label, students) {
  let history = parse(await db().get(K.history));
  if (!Array.isArray(history)) history = [];
  history = history.filter((h) => h.date !== label);
  const byClass = {}; // chi tiet theo lop de doi chieu tien tru
  for (const s of students) {
    const c = byClass[s.classId] || (byClass[s.classId] = { eating: 0, absent: 0, deduction: 0 });
    if (s.mealStatus === 'EATING') c.eating++;
    if (s.mealStatus === 'ABSENT') c.absent++;
    c.deduction += s.deductionAmount || 0;
  }
  history.push({
    date: label,
    totalEating: students.filter((s) => s.mealStatus === 'EATING').length,
    totalAbsent: students.filter((s) => s.mealStatus === 'ABSENT').length,
    totalDeduction: students.reduce((sum, s) => sum + (s.deductionAmount || 0), 0),
    byClass
  });
  history.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (history.length > 120) history = history.slice(history.length - 120);
  await db().set(K.history, history);
}

async function doLock() {
  const students = await listStudents();
  const map = {};
  students.forEach((s) => {
    if (s.reportTime === PENDING_MARK) {
      map[String(s.id)] = Object.assign({}, s, {
        mealStatus: 'ABSENT', isPresent: false, fineCharged: true, deductionAmount: MEAL_PRICE,
        absenceReason: 'Báo muộn (Tự động - Không phản hồi)',
        note: 'Quá hạn 06:00 sáng, không phản hồi -> Hệ thống tự động chuyển Báo muộn -> Trừ ' + money(MEAL_PRICE) + 'đ (Không hoàn lại)',
        reportTime: '06:00 (Hệ thống tự khóa)'
      });
    }
  });
  await putStudents(map);
}

// Tu dong bu: mo chu ky moi (17:30) va khoa (06:00) neu chua duoc thuc hien.
let _cycleOk = ''; // nho (trong 1 may chu dang chay) la chu ky nay da xong -> bo qua truy van Redis
async function ensureCycle() {
  const r = db();
  const now = vnNow();
  const R = latestResetDate(now);
  const M = addDays(R, 1); // ngay an cua chu ky hien tai
  const lockDue = now.date > M || (now.date === M && now.minutes >= LOCK_MINUTES);
  const key = R + '|' + M + '|' + lockDue;
  if (_cycleOk === key) return;
  const upToDate = (m) => m.lastResetDate >= R && (!lockDue || m.lastLockDate >= M);

  let meta = (await r.hgetall(K.meta)) || {};
  if (upToDate(meta)) { _cycleOk = key; return; }

  const got = await r.set(K.cycleLock, '1', { nx: true, ex: 30 });
  if (!got) { // co yeu cau khac dang xu ly -> doi toi da ~5 giay
    for (let i = 0; i < 12; i++) {
      await sleep(400);
      meta = (await r.hgetall(K.meta)) || {};
      if (upToDate(meta)) { _cycleOk = key; return; }
    }
    return;
  }
  try {
    meta = (await r.hgetall(K.meta)) || {};
    if (upToDate(meta)) { _cycleOk = key; return; }
    let resetNow = false;
    if (!meta.lastResetDate || meta.lastResetDate < R) {
      if (meta.lastResetDate && !(meta.lastLockDate >= addDays(meta.lastResetDate, 1))) {
        await doLock(); // chu ky cu chua kip khoa (khong ai truy cap sau 06:00) -> chot ngay truoc khi xoa
      }
      const students = await listStudents();
      if (meta.lastResetDate && students.length) await archive(addDays(meta.lastResetDate, 1), students);
      const map = {};
      students.forEach((s) => { map[String(s.id)] = pendingState(s); });
      await putStudents(map);
      await r.hset(K.meta, { lastResetDate: R });
      resetNow = true;
    }
    if (lockDue && !(meta.lastLockDate >= M)) {
      // Neu chu ky vua duoc mo muon (qua gio khoa) thi phu huynh chua co co hoi chon -> KHONG tru tien.
      if (!resetNow) await doLock();
      await r.hset(K.meta, { lastLockDate: M });
    }
    _cycleOk = key;
  } finally {
    await r.del(K.cycleLock);
  }
}

// ---------- Mat khau quan tri (khong phan biet hoa/thuong, co gioi han nhap sai) ----------
function sha(s) { return crypto.createHash('sha256').update(String(s == null ? '' : s).toLowerCase()).digest(); }
// Mật khẩu CỐ ĐỊNH cho cả Bước 4 (link nhóm chat) và Bước 5 (quản lý học sinh). Muốn đổi: sửa đúng dòng này.
const ADMIN_PASSWORD = 'admin';
async function checkPassword(req, area, password) {
  const expected = ADMIN_PASSWORD;
  const r = db();
  const ip = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || 'unknown').split(',')[0].trim();
  const key = 'myhoa:fail:' + ip;
  const fails = Number(await r.get(key)) || 0;
  if (fails >= 10) throw new HttpError(429, 'Nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.');
  if (!crypto.timingSafeEqual(sha(password), sha(expected))) {
    const n = await r.incr(key);
    if (n === 1) await r.expire(key, 900);
    throw new HttpError(401, 'Mật khẩu không đúng!');
  }
  if (fails > 0) await r.del(key);
}

function readBody(req) {
  try {
    const b = req.body;
    if (b == null || b === '') return {};
    return typeof b === 'string' ? JSON.parse(b) : b;
  } catch (e) {
    throw new HttpError(400, 'Dữ liệu gửi lên không hợp lệ.');
  }
}
function cleanName(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 100);
  if (!s) throw new HttpError(400, 'Tên học sinh không được để trống.');
  return esc(s);
}
function cleanClass(v, fallback) {
  if (CLASS_IDS.includes(v)) return v;
  if (fallback) return fallback;
  throw new HttpError(400, 'Lớp không hợp lệ.');
}

// ---------- Cac chuc nang ----------
async function routeData({ query }) {
  await ensureCycle();
  const resource = query.resource;
  if (resource === 'students') { // che so dien thoai o phia may chu (khong the xem lai qua mang)
    return (await listStudents()).map((s) => Object.assign({}, s, { parentInfo: maskPhones(s.parentInfo) }));
  }
  if (resource === 'history') {
    const h = parse(await db().get(K.history));
    return Array.isArray(h) ? h : [];
  }
  if (resource === 'messenger-status') { // chi tra ve true/false, KHONG tra ve link that
    const urls = (await db().hgetall(K.urls)) || {};
    const status = {};
    CLASS_IDS.forEach((id) => { status[id] = Boolean(urls[id] && String(urls[id]).trim()); });
    return status;
  }
  throw new HttpError(400, 'Thiếu hoặc sai tham số "resource" (students | history | messenger-status).');
}

async function routeToggleMeal({ body }) {
  const { studentId, newStatus } = body;
  if (studentId === undefined || studentId === null || !['EATING', 'ABSENT'].includes(newStatus)) {
    throw new HttpError(400, 'Thiếu studentId hoặc newStatus không hợp lệ.');
  }
  const now = vnNow();
  if (!(now.hour >= 18 || now.hour < 6)) { // chi cho chon trong khung 18:00 - 06:00
    throw new HttpError(403, 'Đã qua 06:00 sáng! Cổng báo cơm chỉ mở từ 18:00 đến 06:00 sáng hôm sau, hệ thống đã khóa không thể thay đổi lựa chọn.');
  }
  await ensureCycle();
  const s = await getStudent(studentId);
  if (!s) throw new HttpError(404, 'Không tìm thấy học sinh.');
  const t = pad(now.hour) + ':' + pad(now.minutes % 60);
  s.mealStatus = newStatus;
  s.isPresent = newStatus === 'EATING';
  s.reportTime = t;
  s.fineCharged = false;
  s.deductionAmount = 0;
  s.absenceReason = '';
  s.note = newStatus === 'EATING'
    ? 'Đăng ký ăn lúc ' + t
    : 'Báo nghỉ trong khung chuẩn (18:00 - 06:00) (Không trừ tiền)';
  await putStudents({ [String(s.id)]: s });
  return maskedCopy(s);
}

async function routeUpdateReason({ body }) {
  const { studentId } = body;
  if (studentId === undefined || studentId === null) throw new HttpError(400, 'Thiếu studentId.');
  await ensureCycle();
  const s = await getStudent(studentId);
  if (!s) throw new HttpError(404, 'Không tìm thấy học sinh.');
  if (s.mealStatus !== 'ABSENT' || s.fineCharged) {
    throw new HttpError(409, 'Chỉ cập nhật được lý do cho bé đã báo nghỉ đúng giờ.');
  }
  const reason = esc(String(body.reason || '').trim().slice(0, 300));
  s.absenceReason = reason;
  s.note = 'Báo nghỉ (' + (reason || 'không rõ lý do') + ') lúc ' + s.reportTime;
  await putStudents({ [String(s.id)]: s });
  return maskedCopy(s);
}

// Giao vien diem danh (khong mat khau - giong thiet ke ban dau cua tab Giao Vien)
async function routeSaveStudent({ body }) {
  const updates = Array.isArray(body) ? body : [body];
  if (!updates.length || updates.length > 50 || !updates[0] || updates[0].id === undefined) {
    throw new HttpError(400, 'Thiếu dữ liệu học sinh.');
  }
  await ensureCycle();
  const map = {}; // chi cho phep doi o diem danh (isPresent); khong cho sua trang thai an / tien tru
  for (const u of updates) {
    if (!u || u.id === undefined) continue;
    const s = await getStudent(u.id);
    if (!s) continue;
    if (u.isPresent !== undefined) s.isPresent = !!u.isPresent;
    map[String(s.id)] = s;
  }
  await putStudents(map);
  return { success: true };
}

async function routeAdminStudents({ req, body }) {
  await checkPassword(req, 'student', body.password);
  await ensureCycle();
  const { action, payload } = body;
  const r = db();

  if (action === 'add') {
    const s = newStudent(cleanName(payload && payload.name), cleanClass(payload && payload.classId),
      esc(String((payload && payload.parentInfo) || '').slice(0, 200)), newId());
    await putStudents({ [String(s.id)]: s });
    return maskedCopy(s);
  }
  if (action === 'bulkImport') {
    const items = Array.isArray(payload) ? payload : [];
    if (!items.length || items.length > 500) throw new HttpError(400, 'Danh sách nhập phải có từ 1 đến 500 dòng.');
    const base = Date.now() * 1000;
    const map = {};
    items.forEach((it, i) => {
      const s = newStudent(cleanName(it.name), cleanClass(it.classId, 'MAM_A'),
        esc(String(it.parentInfo || '').slice(0, 200)), base + i);
      map[String(s.id)] = s;
    });
    await putStudents(map);
    return { added: items.length };
  }
  if (action === 'edit') {
    const s = await getStudent(payload && payload.id);
    if (!s) throw new HttpError(404, 'Không tìm thấy học sinh.');
    s.name = cleanName(payload.name);
    s.classId = cleanClass(payload.classId);
    const incoming = esc(String(payload.parentInfo || '').slice(0, 200));
    if (incoming !== maskPhones(s.parentInfo)) s.parentInfo = incoming; // chua sua o SDT -> giu nguyen so that
    await putStudents({ [String(s.id)]: s });
    return maskedCopy(s);
  }
  if (action === 'exportAll') { // sao luu day du (co so dien thoai that) - can mat khau
    return await listStudents();
  }
  if (action === 'delete') {
    await r.hdel(K.students, String(payload && payload.id));
    return { success: true };
  }
  if (action === 'reset') { // khoi tao lai chu ky thu cong: tat ca ve "Chua chon"
    const students = await listStudents();
    if (students.length) await archive(addDays(latestResetDate(vnNow()), 1), students);
    const map = {};
    students.forEach((s) => { map[String(s.id)] = pendingState(s); });
    await putStudents(map);
    return { success: true };
  }
  if (action === 'replaceAll') { // khoi phuc tu file sao luu
    const list = Array.isArray(payload) ? payload : [];
    if (list.length > 1000) throw new HttpError(400, 'File sao lưu quá lớn.');
    const map = {};
    list.forEach((it, i) => {
      if (!it || typeof it !== 'object') return;
      const id = it.id !== undefined && it.id !== null && it.id !== '' ? it.id : newId(i);
      const s = Object.assign({}, it, { id });
      s.name = String(s.name == null ? '' : s.name).slice(0, 100);
      if (!s.name) return;
      if (!CLASS_IDS.includes(s.classId)) s.classId = 'MAM_A';
      if (!['PENDING', 'EATING', 'ABSENT'].includes(s.mealStatus)) s.mealStatus = 'PENDING';
      map[String(id)] = s;
    });
    const existing = Object.keys((await r.hgetall(K.students)) || {});
    await putStudents(map);
    const stale = existing.filter((k) => !(k in map));
    if (stale.length) await r.hdel(K.students, ...stale);
    return { success: true, count: Object.keys(map).length };
  }
  throw new HttpError(400, 'Action không hợp lệ.');
}

async function routeAdminMessenger({ req, body }) {
  await checkPassword(req, 'chat', body.password);
  const classId = cleanClass(body.classId);
  const url = String(body.url || '').trim();
  if (url && !/^https?:\/\/\S+$/i.test(url)) throw new HttpError(400, 'Link nhóm phải bắt đầu bằng https://');
  if (url) await db().hset(K.urls, { [classId]: url });
  else await db().hdel(K.urls, classId);
  return { success: true };
}

async function routeSendReminder({ body }) {
  const classId = cleanClass(body.classId);
  const messageText = String(body.messageText || '').slice(0, 1000);
  const rawUrl = String((await db().hget(K.urls, classId)) || '').trim();
  if (!rawUrl) throw new HttpError(404, 'Lớp này chưa được cấu hình link nhóm!');
  let finalUrl = rawUrl;
  let prefilled = false;
  try {
    const parsed = new URL(rawUrl);
    if (/(^|\.)m\.me$/.test(parsed.hostname) || /(^|\.)messenger\.com$/.test(parsed.hostname)) {
      parsed.searchParams.set('text', messageText);
      finalUrl = parsed.toString();
      prefilled = true;
    }
  } catch (e) { /* link khong hop le: tra ve nguyen ban */ }
  return { url: finalUrl, prefilled };
}

async function routeVerifyPassword({ req, body }) {
  await checkPassword(req, body.area === 'chat' ? 'chat' : 'student', body.password);
  return { success: true };
}

const ROUTES = {
  'data': { method: 'GET', run: routeData },
  'toggle-meal': { method: 'POST', run: routeToggleMeal },
  'update-reason': { method: 'POST', run: routeUpdateReason },
  'save-student': { method: 'POST', run: routeSaveStudent },
  'admin-students': { method: 'POST', run: routeAdminStudents },
  'admin-messenger': { method: 'POST', run: routeAdminMessenger },
  'send-reminder': { method: 'POST', run: routeSendReminder },
  'verify-password': { method: 'POST', run: routeVerifyPassword }
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const route = String((req.query && req.query.r) || '');
    const entry = ROUTES[route];
    if (!entry) throw new HttpError(404, 'Không tìm thấy chức năng: ' + route);
    if (req.method !== entry.method) throw new HttpError(405, 'Sai phương thức gọi.');
    const body = entry.method === 'POST' ? readBody(req) : {};
    const out = await entry.run({ req, query: req.query || {}, body });
    res.status(200).json(out);
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Lỗi máy chủ: ' + e.message });
  }
};
