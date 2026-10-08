/* 빠름판 PWA — app.js (바닐라 JS, 빌드 없음) */
'use strict';

/* ================= 설정 ================= */
// ★ GAS 웹앱(/exec) 주소를 여기에 입력. 비어 있으면 "서버 연결 필요" 안내 표시.
const API_BASE = 'https://script.google.com/macros/s/AKfycbwB-IjWtNuB0tppY9-xdBr79EeyTJ16EZ1Nr-DhKbWalPUppsTUFmWVWSSajmeYam9x/exec';

/* ================= 유틸 ================= */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n) => (+n || 0).toLocaleString('ko-KR') + '원';
const fmtN = (n) => (+n || 0).toLocaleString('ko-KR');
const pad2 = (n) => String(n).padStart(2, '0');
const WD = ['일','월','화','수','목','금','토'];
function dateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()); }
function todayStr() { return dateStr(new Date()); }
function monthStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth()+1); }
function parseD(s) { return new Date(s + 'T12:00:00'); }
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, 2200);
}
// 수요일 기준 주 시작일
function weekStartOf(ds) {
  const d = parseD(ds); const diff = (d.getDay() - 3 + 7) % 7;
  d.setDate(d.getDate() - diff); return dateStr(d);
}
function weekDates(ws) {
  const out = []; const d = parseD(ws);
  for (let i = 0; i < 7; i++) { const x = new Date(d); x.setDate(d.getDate() + i); out.push(dateStr(x)); }
  return out;
}
const shortRange = (ws, we) => ws.slice(2).replace(/-/g,'.') + '~' + we.slice(5).replace(/-/g,'.');
const shortDay = (ds) => { const d = parseD(ds); return ds.slice(5).replace(/-/g,'.') + ' ' + WD[d.getDay()]; };

/* 공제 계산 (서버와 동일 공식 — 미리보기/클라이언트 표시용) */
const DEF_RATES = { sanjae_rate: 0.71192, goyong_rate: 0.6472, call_fee: 0 };
function calcDed(total, count, s) {
  s = s || {};
  const sr = (s.sanjae_rate != null && s.sanjae_rate !== '') ? +s.sanjae_rate : DEF_RATES.sanjae_rate;
  const gr = (s.goyong_rate != null && s.goyong_rate !== '') ? +s.goyong_rate : DEF_RATES.goyong_rate;
  const cf = +(s.call_fee || 0);
  const income = Math.floor(total * 0.03 / 10) * 10;
  const resident = Math.floor(total * 0.003 / 10) * 10;
  const sanjae = Math.floor(total * sr / 100);
  const goyong = Math.floor(total * gr / 100);
  const callfee = count * cf;
  const ded = income + resident + sanjae + goyong + callfee;
  return { income, resident, sanjae, goyong, callfee, total: ded, pay: total - ded };
}

/* ================= 테마 ================= */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('pp-theme', t); } catch (e) {}
  $('themeBtn').textContent = (t === 'dark') ? '☀️' : '🌙';
  $('metaTheme').setAttribute('content', (t === 'dark') ? '#121212' : '#f2f2f2');
}

/* ================= API ================= */
let TOKEN = null;
try { TOKEN = localStorage.getItem('pp-token'); } catch (e) {}

/* JSONP API 클라이언트 (GAS TextOutput은 setHeader 미지원 → CORS 불가, JSONP만 가능)
   규격: API_BASE?fn=xxx&args=<JSON 배열>&callback=cbName
   args는 반드시 배열(positional). 서버 시그니처 (token, ...) 순서. */
function api(fn, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!API_BASE) { const err = new Error('NO_API'); err.noApi = true; reject(err); return; }
    const cb = 'cb' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    const s = document.createElement('script');
    let done = false;
    const cleanup = () => {
      try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      if (s.parentNode) s.parentNode.removeChild(s);
    };
    const timer = setTimeout(() => {
      if (done) return; done = true; cleanup();
      reject(new Error('TIMEOUT'));
    }, timeoutMs || 30000);
    window[cb] = (data) => {
      if (done) return; done = true; clearTimeout(timer); cleanup();
      if (!data || !data.ok) reject(new Error((data && data.error) || 'API_ERROR'));
      else resolve(data);
    };
    s.onerror = () => {
      if (done) return; done = true; clearTimeout(timer); cleanup();
      reject(new Error('NETWORK_ERROR'));
    };
    s.src = API_BASE + '?fn=' + encodeURIComponent(fn) +
      '&args=' + encodeURIComponent(JSON.stringify(args || [])) +
      '&callback=' + cb;
    document.head.appendChild(s);
  });
}
function needApi() {
  document.querySelectorAll('.apiWarnBox').forEach((w) => {
    w.classList.remove('hidden');
    w.textContent = '⚠️ 서버(API_BASE)가 설정되지 않았습니다. app.js의 API_BASE를 입력하세요.';
  });
}

/* ---- 대용량 POST (사진 OCR용): 숨은 form → iframe → postMessage ---- */
function apiPost(fn, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!API_BASE) { reject(new Error('NO_API')); return; }
    const cb = 'cb' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    const iframe = document.createElement('iframe');
    iframe.name = 'pf' + cb;
    iframe.style.display = 'none';
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = API_BASE;
    form.target = iframe.name;
    form.style.display = 'none';
    const add = (k, v) => {
      const i = document.createElement('input');
      i.type = 'hidden'; i.name = k; i.value = v;
      form.appendChild(i);
    };
    add('fn', fn);
    add('args', JSON.stringify(args || []));
    add('cb', cb);
    const cleanup = () => {
      window.removeEventListener('message', onMsg);
      try { form.remove(); } catch (e) {}
      try { iframe.remove(); } catch (e) {}
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('TIMEOUT')); }, timeoutMs || 180000);
    const onMsg = (ev) => {
      try {
        if (ev.source !== iframe.contentWindow) return;
      } catch (e) { return; }
      let d = null;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (!d || d.cb !== cb) return;
      clearTimeout(timer); cleanup();
      if (d.ok) resolve(d); else reject(new Error(d.error || 'API_ERROR'));
    };
    window.addEventListener('message', onMsg);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    try { form.submit(); }
    catch (e) { clearTimeout(timer); cleanup(); reject(e); }
  });
}

/* ================= 상태 ================= */
let ME = null;            // {user_id, name, role}
let SETTINGS = Object.assign({}, DEF_RATES);  // 내(또는 조회 대상) 요율
let USERS = [];           // admin용 직원 목록
let PLATFORM = '전체';
let EX_CAT = '주유';
let CUR_VIEW = 'login';
let WEEKS = [], WEEKS_REF = null, WEEKS_END = false;

function targetId() {
  const sel = $('staffSel');
  if (ME && ME.role === 'admin' && sel && sel.value) return sel.value;
  return ME ? ME.user_id : null;
}

/* ================= 화면 전환 ================= */
const VIEWS = ['login','signup','home','weeks','expenses','record','admin'];
function showView(v) {
  CUR_VIEW = v;
  VIEWS.forEach((x) => $('view-' + x).classList.toggle('hidden', x !== v));
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
  window.scrollTo(0, 0);
  if (v === 'home') loadHome();
  else if (v === 'weeks') loadWeeks(true);
  else if (v === 'expenses') loadExpenses();
  else if (v === 'record') initRecordForm();
  else if (v === 'admin') loadAdmin();
}
function showApp() {
  $('view-login').classList.add('hidden');
  $('view-signup').classList.add('hidden');
  $('appHeader').classList.remove('hidden');
  $('mainView').classList.remove('hidden');
  $('tabbar').classList.remove('hidden');
}

/* ================= 인증 ================= */
async function doLogin() {
  const name = $('loginName').value.trim();
  const pw = $('loginPw').value;
  if (!name || !pw) { toast('이름과 비밀번호를 입력하세요'); return; }
  try {
    const r = await api('apiLogin', [name, pw, $('rememberMe').checked]);
    TOKEN = r.token;
    try { localStorage.setItem('pp-token', TOKEN); } catch (e) {}
    await boot();
  } catch (e) {
    if (e.noApi) { needApi(); return; }
    toast(e.message === 'PENDING' ? '승인 대기 중입니다' : '로그인 실패');
  }
}
async function doLogout() {
  try { await api('apiLogout', [TOKEN]); } catch (e) {}
  TOKEN = null;
  try { localStorage.removeItem('pp-token'); } catch (e) {}
  ME = null; USERS = [];
  $('appHeader').classList.add('hidden');
  $('mainView').classList.add('hidden');
  $('tabbar').classList.add('hidden');
  $('view-login').classList.remove('hidden');
  $('loginPw').value = '';
}
async function doSignup() {
  const name = $('suName').value.trim();
  const pw = $('suPw').value;
  if (!name || pw.length < 4) { toast('이름과 4자 이상 비밀번호를 입력하세요'); return; }
  try {
    await api('apiSignupRequest', [name, pw]);
    $('signupForm').classList.add('hidden');
    $('signupDone').classList.remove('hidden');
  } catch (e) { toast(e.noApi ? '서버 연결 필요' : '신청 실패: ' + e.message); }
}
async function boot() {
  const me = await api('apiMe', [TOKEN]);
  ME = me.user || me;
  showApp();
  const isAdmin = ME.role === 'admin';
  $('adminBtn').classList.toggle('hidden', !isAdmin);
  $('staffSel').classList.toggle('hidden', !isAdmin);
  if (isAdmin) {
    try {
      const r = await api('apiUsers', [TOKEN]);
      USERS = r.users || [];
      const opts = ['<option value="">전체 직원</option>'].concat(USERS.map((u) =>
        '<option value="' + esc(u.user_id) + '">' + esc(u.name) + '</option>')).join('');
      $('staffSel').innerHTML = opts;
    } catch (e) { /* 직원 목록 실패해도 계속 */ }
  }
  await refreshSettings();
  showView('home');
}
async function refreshSettings() {
  try {
    const r = await api('apiGetSettings', [TOKEN, targetId()]);
    SETTINGS = Object.assign({}, DEF_RATES, r.settings || r);
  } catch (e) { SETTINGS = Object.assign({}, DEF_RATES); }
}

/* ================= 홈 ================= */
async function loadHome() {
  if (!API_BASE) { needApi(); return; }
  try {
    const r = await api('apiGetHome', [TOKEN, targetId()]);
    renderHome(r);
  } catch (e) { toast('불러오기 실패'); }
}
function renderHome(r) {
  r = r || {};
  const w = r.week || {};
  const m = r.month || {};
  if (w.week_start) $('homeWeekRange').textContent = shortRange(w.week_start, w.week_end);
  const wt = +(w.total_amount || 0), wc = +(w.total_count || 0);
  $('homeTotal').textContent = fmt(wt);
  $('homeCount').textContent = fmtN(wc) + '건';
  $('homeUnit').textContent = wc ? fmtN(Math.round(wt / wc / 10) * 10) : '-';
  $('homePay').textContent = (w.expected_payment != null) ? fmt(w.expected_payment) : fmt(calcDed(wt, wc, SETTINGS).pay);

  const mm = monthStr();
  $('homeMonthTitle').textContent = mm.slice(5) + '월';
  const mt = +(m.total_amount || 0);
  $('homeMonthAmt').textContent = fmt(mt);
  const tgt = +(r.target || 0);
  $('homeTarget').textContent = tgt ? ('목표 ' + fmt(tgt)) : '목표 미설정';
  const pct = tgt ? Math.min(100, Math.round(mt / tgt * 100)) : 0;
  $('homePct').textContent = tgt ? pct + '%' : '';
  $('homeProg').style.width = pct + '%';

  const list = r.recent || [];
  $('recentList').innerHTML = list.length ? list.map((x) =>
    '<div class="recentRow"><span>' + esc(x.date) + ' <span class="sub">' + esc(x.platform || '') + '</span></span>' +
    '<span class="amt">' + fmt(x.amount) + ' <span class="sub">' + fmtN(x.count) + '건</span></span></div>'
  ).join('') : '<div style="color:var(--muted);font-size:14px">기록이 없습니다</div>';
}
async function saveTarget() {
  const amt = parseInt($('targetInput').value, 10) || 0;
  if (!amt) { toast('목표 금액을 입력하세요'); return; }
  try {
    await api('apiSetTarget', [TOKEN, monthStr(), amt, targetId()]);
    toast('저장됨'); $('targetInput').value = ''; loadHome();
  } catch (e) { toast('저장 실패'); }
}

/* ================= 주별 내역 (배달판 클론) ================= */
function setPlatform(p) {
  PLATFORM = p;
  document.querySelectorAll('#platSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.p === p));
  loadWeeks(true);
}
async function loadWeeks(reset) {
  if (!API_BASE) { needApi(); return; }
  if (reset) { WEEKS = []; WEEKS_REF = todayStr(); WEEKS_END = false; $('weeksList').innerHTML = ''; }
  if (WEEKS_END) return;
  try {
    const r = await api('apiGetWeeks', [TOKEN, WEEKS_REF, 12, targetId(), PLATFORM]);
    const got = r.weeks || [];
    WEEKS = WEEKS.concat(got);
    if (got.length < 12) WEEKS_END = true;
    else {
      const last = got[got.length - 1];
      const d = parseD(last.week_start); d.setDate(d.getDate() - 1);
      WEEKS_REF = dateStr(d);
    }
    renderWeeks();
    $('moreWeeks').classList.toggle('hidden', WEEKS_END || !WEEKS.length);
  } catch (e) { toast('불러오기 실패'); }
}
function sumBoxHtml(w) {
  const t = +w.total_amount || 0, c = +w.total_count || 0;
  const d = calcDed(t, c, SETTINGS);
  // 서버가 계산값을 주면 우선 사용 (표시 정합성)
  const v = {
    income: (w.income_tax != null ? +w.income_tax : d.income),
    resident: (w.resident_tax != null ? +w.resident_tax : d.resident),
    sanjae: (w.sanjae != null ? +w.sanjae : d.sanjae),
    goyong: (w.goyong != null ? +w.goyong : d.goyong),
    callfee: (w.callfee != null ? +w.callfee : d.callfee),
  };
  v.total = v.income + v.resident + v.sanjae + v.goyong + v.callfee;
  v.pay = t - v.total;
  const callRow = v.callfee
    ? '<div class="r"><span class="lb">콜수수료</span><span class="v">' + fmt(v.callfee) + '</span></div>' : '';
  // 평균: 운행일수 기준
  const workDays = (w.days || []).filter((x) => (+x.amount || 0) > 0 || (+x.count || 0) > 0).length || 1;
  const avgAmt = Math.round(t / workDays / 100) * 100;
  const avgCnt = Math.round(c / workDays * 10) / 10;
  const row = (lb, val) => '<div class="r"><span class="lb">' + lb + '</span><span class="v">' + val + '</span></div>';
  return '<div class="sumBox"><div class="col">' +
    row('배달금액', fmt(w.delivery_amount != null ? w.delivery_amount : t)) +
    row('프로모션', fmt(w.promotion || 0)) +
    row('배달건수', fmtN(c) + '건') +
    row('배달단가', fmtN(w.avg_unit != null ? w.avg_unit : (c ? Math.round(t / c / 10) * 10 : 0))) +
    row('평균금액', fmt(avgAmt)) +
    row('평균건수', avgCnt + '건') +
    '</div><div class="col">' +
    row('소득세', fmt(v.income)) +
    row('주민세', fmt(v.resident)) +
    row('산재보험', fmt(v.sanjae)) +
    row('고용보험', fmt(v.goyong)) +
    callRow +
    row('공제합계', fmt(v.total)) +
    '<div class="r hl"><span class="lb">지급예정</span><span class="v">' + fmt(v.pay) + '</span></div>' +
    '</div></div>';
}
function dayRowsHtml(w) {
  const byDate = {};
  (w.days || []).forEach((d) => { byDate[d.date] = d; });
  return weekDates(w.week_start).map((ds) => {
    const d = parseD(ds);
    const cls = d.getDay() === 6 ? 'sat' : (d.getDay() === 0 ? 'sun' : '');
    const rec = byDate[ds];
    let vals;
    if (rec && ((+rec.amount || 0) > 0 || (+rec.count || 0) > 0)) {
      const amt = +rec.amount || 0, cnt = +rec.count || 0;
      const unit = cnt ? Math.round(amt / cnt / 10) * 10 : 0;
      const promo = (+rec.promotion || 0)
        ? '<br><span class="promoBadge">+ ' + fmtN(rec.promotion) + '</span>' : '';
      vals = '<span class="vals">' + fmt(amt) + ' ' + fmtN(cnt) + '건 <span class="unit">(' + fmtN(unit) + ')</span>' + promo + '</span>';
    } else {
      vals = '<span class="empty">- - -</span>';
    }
    return '<div class="dayRow"><span class="d ' + cls + '">' + shortDay(ds) + '</span>' + vals + '</div>';
  }).join('');
}
function renderWeeks() {
  const el = $('weeksList');
  if (!WEEKS.length) {
    el.innerHTML = '<div class="card" style="color:var(--muted)">기록이 없습니다</div>';
    return;
  }
  el.innerHTML = WEEKS.map((w, i) => {
    const t = +w.total_amount || 0, c = +w.total_count || 0;
    const unit = c ? Math.round(t / c / 10) * 10 : 0;
    return '<div class="weekCard" id="wc' + i + '">' +
      '<div class="weekHead" data-i="' + i + '">' +
      '<span class="range">' + shortRange(w.week_start, w.week_end) + '</span>' +
      '<span class="sum">' + fmt(t) + ' <span class="cnt">' + fmtN(c) + '건</span> <span class="unit">(' + fmtN(unit) + ')</span></span>' +
      '</div>' +
      '<div class="weekBody">' + sumBoxHtml(w) + dayRowsHtml(w) + '</div>' +
      '</div>';
  }).join('');
  el.querySelectorAll('.weekHead').forEach((h) => {
    h.addEventListener('click', () => $('wc' + h.dataset.i).classList.toggle('open'));
  });
}

/* ================= 지출 ================= */
function setExCat(c) {
  EX_CAT = c;
  document.querySelectorAll('#exCatSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.c === c));
}
async function loadExpenses() {
  if (!API_BASE) { needApi(); return; }
  const mm = monthStr();
  $('exMonthTitle').textContent = mm.slice(5) + '월';
  try {
    const r = await api('apiGetExpenses', [TOKEN, mm, targetId()]);
    const list = r.expenses || [];
    const total = list.reduce((a, x) => a + (+x.amount || 0), 0);
    $('exTotal').textContent = fmt(total);
    $('expList').innerHTML = list.length ? list.map((x) =>
      '<div class="expRow"><span><span class="catTag cat-' + esc(x.category) + '">' + esc(x.category) + '</span>' +
      esc(x.date ? x.date.slice(5) : '') + ' ' + esc(x.memo || '') + '</span>' +
      '<span><b>' + fmt(x.amount) + '</b> <button class="btnDanger" data-d="' + esc(x.date) + '" data-c="' + esc(x.category) + '" data-a="' + esc(x.amount) + '">삭제</button></span></div>'
    ).join('') : '<div style="color:var(--muted);font-size:14px">지출이 없습니다</div>';
    $('expList').querySelectorAll('.btnDanger').forEach((b) => b.addEventListener('click', () => delExpense(b)));
  } catch (e) { toast('불러오기 실패'); }
}
async function saveExpense() {
  const d = $('exDate').value, amt = parseInt($('exAmount').value, 10) || 0;
  if (!d || !amt) { toast('날짜와 금액을 입력하세요'); return; }
  try {
    await api('apiSaveExpense', [TOKEN, { date: d, category: EX_CAT, amount: amt, memo: $('exMemo').value.trim(), user_id: targetId() }]);
    toast('저장됨'); $('exAmount').value = ''; $('exMemo').value = ''; loadExpenses();
  } catch (e) { toast('저장 실패'); }
}
async function delExpense(btn) {
  if (!confirm('삭제할까요?')) return;
  try {
    await api('apiDeleteExpense', [TOKEN, { date: btn.dataset.d, category: btn.dataset.c, amount: +btn.dataset.a, user_id: targetId() }]);
    toast('삭제됨'); loadExpenses();
  } catch (e) { toast('삭제 실패'); }
}

/* ================= 기록 입력 ================= */
function initRecordForm() {
  if (!$('rcDate').value) $('rcDate').value = todayStr();
  previewRecord();
}
function readRecordForm() {
  const amount = parseInt($('rcAmount').value, 10) || 0;
  const promo = parseInt($('rcPromo').value, 10) || 0;
  return {
    date: $('rcDate').value,
    platform: $('rcPlat').value,
    amount: amount + promo,
    delivery_amount: amount,
    promotion: promo,
    count: parseInt($('rcCount').value, 10) || 0,
    distance: parseFloat($('rcDist').value) || 0,
    memo: $('rcMemo').value.trim(),
    user_id: targetId()
  };
}
function previewRecord() {
  const r = readRecordForm();
  if (!r.amount && !r.count) { $('rcPreview').innerHTML = ''; return; }
  const d = calcDed(r.amount, r.count, SETTINGS);
  $('rcPreview').innerHTML = '<div class="ocrBox">예상 공제 <b>' + fmt(d.total) + '</b> · 지급예정 <b>' + fmt(d.pay) + '</b></div>';
}
async function saveRecord() {
  const r = readRecordForm();
  if (!r.date || (!r.amount && !r.count)) { toast('날짜와 금액/건수를 입력하세요'); return; }
  try {
    await api('apiSaveRecord', [TOKEN, r]);
    toast('저장됨');
    ['rcAmount','rcPromo','rcCount','rcDist','rcMemo'].forEach((id) => { $(id).value = ''; });
    previewRecord();
  } catch (e) { toast('저장 실패'); }
}
async function delRecord() {
  const d = $('rcDate').value, p = $('rcPlat').value;
  if (!d || !confirm(d + ' ' + p + ' 기록을 삭제할까요?')) return;
  try {
    await api('apiDeleteRecord', [TOKEN, d, p, targetId()]);
    toast('삭제됨');
  } catch (e) { toast('삭제 실패'); }
}

/* ---- 오늘의기록 OCR: 사진 선택 → 추출 → 자동입력 → 서버에서 즉시 삭제 ---- */
function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      let w = img.width, h = img.height;
      if (Math.max(w, h) > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      resolve(cv.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
async function handlePhoto(file) {
  if (!file) return;
  const t0 = Date.now();
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    const el = $('ocrStatus').firstChild;
    if (el) el.innerHTML = '<span class="spin">⏳</span> 사진에서 기록 읽는 중… ' + s + '초';
  }, 1000);
  $('ocrStatus').innerHTML = '<div class="ocrBox"><span class="spin">⏳</span> 사진에서 기록 읽는 중… 0초</div>';
  try {
    const dataUrl = await downscaleImage(file);
    const r = await apiPost('apiExtractPhoto', [TOKEN, dataUrl], 180000);
    clearInterval(tick);
    // r: {date, count, amount, distance}
    if (r.date) $('rcDate').value = r.date;
    if (r.count != null) $('rcCount').value = r.count;
    if (r.amount != null) $('rcAmount').value = r.amount;
    if (r.distance != null) $('rcDist').value = r.distance;
    previewRecord();
    $('ocrStatus').innerHTML = '<div class="ocrBox">✅ 추출됨: <b>' + fmtN(r.count || 0) + '건 ' + fmt(r.amount || 0) + '</b>' +
      (r.distance ? ' · ' + r.distance + 'km' : '') + ' — 확인 후 저장하세요. 사진은 서버에서 바로 삭제됩니다.</div>';
  } catch (e) {
    clearInterval(tick);
    const em = (e && e.message) || '';
    const msg = (em === 'TIMEOUT')
      ? '❌ 3분이 지나도 응답이 없어 중단됐어요. 다시 시도하거나 직접 입력하세요.'
      : (em === 'OCR_FAIL')
        ? '❌ 서버 OCR 권한이 아직 승인되지 않았어요. 관리자가 Apps Script에서 Drive/Docs 권한을 승인해야 합니다.'
        : '❌ 추출 실패. 직접 입력하세요.';
    $('ocrStatus').innerHTML = '<div class="ocrBox">' + msg + '</div>';
  }
}

/* ================= 설정 모달 ================= */
function fmtRate(v) {
  var n = parseFloat(v);
  if (isNaN(n)) return v;
  return String(Math.round(n * 100000) / 100000);
}
async function openSettings() {
  try {
    const r = await api('apiGetSettings', [TOKEN, targetId()]);
    const s = Object.assign({}, DEF_RATES, r.settings || r);
    $('setSanjae').value = fmtRate(s.sanjae_rate);
    $('setGoyong').value = fmtRate(s.goyong_rate);
    $('setCallFee').value = s.call_fee || 0;
    const nm = (ME.role === 'admin' && $('staffSel').value)
      ? $('staffSel').options[$('staffSel').selectedIndex].text : ME.name;
    $('setWho').textContent = '(' + nm + ')';
    $('setModal').classList.remove('hidden');
  } catch (e) { toast('설정 불러오기 실패'); }
}
async function saveSettings() {
  const sr = parseFloat($('setSanjae').value), gr = parseFloat($('setGoyong').value);
  const cf = parseInt($('setCallFee').value, 10) || 0;
  if (!(sr >= 0 && sr <= 10 && gr >= 0 && gr <= 10 && cf >= 0)) { toast('값을 확인하세요'); return; }
  try {
    await api('apiSaveSettings', [TOKEN, { sanjae_rate: sr, goyong_rate: gr, call_fee: cf }, targetId()]);
    toast('저장됨');
    $('setModal').classList.add('hidden');
    await refreshSettings();
    if (CUR_VIEW === 'weeks') loadWeeks(true); else if (CUR_VIEW === 'home') loadHome();
  } catch (e) { toast('저장 실패'); }
}

/* ================= 관리자 ================= */
async function loadAdmin() {
  if (ME.role !== 'admin') { showView('home'); return; }
  // 승인 대기
  try {
    const r = await api('apiPendingUsers', [TOKEN]);
    const list = r.pending || [];
    $('pendCnt').textContent = list.length ? '(' + list.length + ')' : '';
    $('pendList').innerHTML = list.length ? list.map((u) =>
      '<div class="pendRow"><span>' + esc(u.name) + ' <span style="color:var(--muted);font-size:12px">' + esc(u.created_at || '') + '</span></span>' +
      '<span><button class="miniBtn miniOk" data-id="' + esc(u.user_id) + '" data-act="ok">승인</button>' +
      '<button class="miniBtn miniNo" data-id="' + esc(u.user_id) + '" data-act="no">거절</button></span></div>'
    ).join('') : '<div style="color:var(--muted);font-size:14px">없음</div>';
    $('pendList').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => judgeUser(b.dataset.id, b.dataset.act)));
  } catch (e) { /* */ }
  // 직원 셀렉트들
  const opts = USERS.map((u) => '<option value="' + esc(u.user_id) + '">' + esc(u.name) + '</option>').join('');
  $('admStaffSel').innerHTML = opts; $('kickSel').innerHTML = opts;
  if (USERS.length) loadAdmStaff(USERS[0].user_id);
}
async function judgeUser(uid, act) {
  try {
    await api(act === 'ok' ? 'apiApproveUser' : 'apiRejectUser', [TOKEN, uid]);
    toast(act === 'ok' ? '승인됨' : '거절됨');
    loadAdmin();
    // 직원 목록 새로고침
    const r = await api('apiUsers', [TOKEN]); USERS = r.users || [];
  } catch (e) { toast('실패'); }
}
async function loadAdmStaff(uid) {
  try {
    const r = await api('apiGetSettings', [TOKEN, uid]);
    const s = Object.assign({}, DEF_RATES, r.settings || r);
    $('admSanjae').value = s.sanjae_rate; $('admGoyong').value = s.goyong_rate; $('admCallFee').value = s.call_fee || 0;
  } catch (e) { /* */ }
}
async function saveAdmStaff() {
  const uid = $('admStaffSel').value; if (!uid) return;
  const sr = parseFloat($('admSanjae').value), gr = parseFloat($('admGoyong').value);
  const cf = parseInt($('admCallFee').value, 10) || 0;
  if (!(sr >= 0 && sr <= 10 && gr >= 0 && gr <= 10 && cf >= 0)) { toast('값을 확인하세요'); return; }
  try {
    await api('apiSaveSettings', [TOKEN, { sanjae_rate: sr, goyong_rate: gr, call_fee: cf }, uid]);
    toast('저장됨'); refreshSettings();
  } catch (e) { toast('저장 실패'); }
}
async function bulkRegister() {
  const names = $('bulkNames').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!names.length) { toast('이름을 입력하세요'); return; }
  if (!confirm(names.length + '명을 등록할까요?')) return;
  try {
    const r = await api('apiBulkCreateUsers', [TOKEN, names]);
    const list = r.users || [];
    $('bulkResult').innerHTML = list.map((u) =>
      '<div class="tempPw">' + esc(u.name) + ' : ' + esc(u.temp_password) + '</div>').join('') ||
      '<div style="color:var(--muted)">결과 없음</div>';
    const ru = await api('apiUsers', [TOKEN]); USERS = ru.users || [];
    toast(list.length + '명 등록됨');
  } catch (e) { toast('등록 실패'); }
}
async function kickUser() {
  const uid = $('kickSel').value; if (!uid) return;
  const nm = $('kickSel').options[$('kickSel').selectedIndex].text;
  if (!confirm(nm + '님의 모든 세션을 끊을까요?')) return;
  try { await api('apiForceLogout', [TOKEN, uid]); toast('세션 끊김'); }
  catch (e) { toast('실패'); }
}

/* ================= 이벤트 바인딩 ================= */
function bindEvents() {
  $('loginBtn').addEventListener('click', doLogin);
  $('loginPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('goSignup').addEventListener('click', () => {
    $('view-login').classList.add('hidden'); $('view-signup').classList.remove('hidden');
    $('signupForm').classList.remove('hidden'); $('signupDone').classList.add('hidden');
  });
  $('backLogin').addEventListener('click', () => {
    $('view-signup').classList.add('hidden'); $('view-login').classList.remove('hidden');
  });
  $('signupBtn').addEventListener('click', doSignup);
  $('logoutBtn').addEventListener('click', doLogout);

  document.querySelectorAll('#tabbar button').forEach((b) =>
    b.addEventListener('click', () => showView(b.dataset.v)));
  $('themeBtn').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  $('setBtn').addEventListener('click', openSettings);
  $('setClose').addEventListener('click', () => $('setModal').classList.add('hidden'));
  $('setSave').addEventListener('click', saveSettings);
  $('setModal').addEventListener('click', (e) => { if (e.target === $('setModal')) $('setModal').classList.add('hidden'); });
  $('adminBtn').addEventListener('click', () => showView('admin'));
  $('staffSel').addEventListener('change', async () => {
    await refreshSettings();
    if (CUR_VIEW === 'home') loadHome(); else if (CUR_VIEW === 'weeks') loadWeeks(true); else if (CUR_VIEW === 'expenses') loadExpenses();
  });

  document.querySelectorAll('#platSeg button').forEach((b) =>
    b.addEventListener('click', () => setPlatform(b.dataset.p)));
  $('moreWeeks').addEventListener('click', () => loadWeeks(false));

  $('targetBtn').addEventListener('click', saveTarget);

  document.querySelectorAll('#exCatSeg button').forEach((b) =>
    b.addEventListener('click', () => setExCat(b.dataset.c)));
  $('exSaveBtn').addEventListener('click', saveExpense);

  ['rcAmount','rcPromo','rcCount'].forEach((id) => $(id).addEventListener('input', previewRecord));
  $('ocrBtn').addEventListener('click', () => $('photoInput').click());
  $('photoInput').addEventListener('change', (e) => { handlePhoto(e.target.files[0]); e.target.value = ''; });
  $('rcSaveBtn').addEventListener('click', saveRecord);
  $('rcDelBtn').addEventListener('click', delRecord);

  $('admStaffSel').addEventListener('change', (e) => loadAdmStaff(e.target.value));
  $('admSaveBtn').addEventListener('click', saveAdmStaff);
  $('bulkBtn').addEventListener('click', bulkRegister);
  $('kickBtn').addEventListener('click', kickUser);
}

/* ================= 시작 ================= */
function init() {
  let theme = 'light';
  try { theme = localStorage.getItem('pp-theme') || 'light'; } catch (e) {}
  setTheme(theme);
  bindEvents();
  if (!API_BASE) {
    // API 없이도 화면 구조는 표시 (로그인 화면 + 안내)
  }
  if (TOKEN) {
    boot().catch(() => { /* 토큰 무효 → 로그인 화면 */ });
  }
}

/* PWA 서비스워커 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

document.addEventListener('DOMContentLoaded', init);
