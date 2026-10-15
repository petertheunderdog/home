/* 우리집 가계부 · PWA
 * 데이터는 구글 시트(Apps Script API)에 있고, 이 앱은 화면만 담당해요.
 * 열 때는 폰에 저장해 둔 마지막 화면을 바로 보여주고, 뒤에서 최신 데이터를 받아와요. */
'use strict';
const VERSION = '1.0.0';
const API = 'https://script.google.com/macros/s/AKfycbyxgtCCZJEixEnxgHr_g-XbBrFy4j7oqd0GTJ7GK29Z3okMu5Kk8JN_FBFjkBSBsMXkdg/exec';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1O9fVSgn2GEPlz2eURBd0J_kQzQH5vuwphPRmo1yAco4/edit';
const GUBUN_ORDER = ['변동', '고정', '수입', '회사경비', '저축'];

const S = {
  key: localStorage.getItem('gb.key') || '',
  user: localStorage.getItem('gb.user') || '',
  cfg: readJ('gb.cfg'),
  ym: null, data: null, tab: 'home',
  filter: 'all', cat: '', q: '',
  loading: 0, fetchedAt: {}, err: ''
};

/* ────────── utils ────────── */
function readJ(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
function writeJ(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 공간 부족 등은 무시 */ } }
const $ = (id) => document.getElementById(id);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function won(n) { n = Math.round(Number(n) || 0); return (n < 0 ? '-' : '') + '₩' + Math.abs(n).toLocaleString('ko-KR'); }
function num(n) { return Math.round(Number(n) || 0).toLocaleString('ko-KR'); }
function man(n) {
  n = Number(n) || 0; const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e8) { const e = Math.floor(a / 1e8), m = Math.round((a % 1e8) / 1e4); return s + e + '억' + (m ? ' ' + m.toLocaleString('ko-KR') + '만' : ''); }
  if (a >= 1e4) return s + (a >= 1e6 ? Math.round(a / 1e4).toLocaleString('ko-KR') : (Math.round(a / 1e3) / 10).toLocaleString('ko-KR')) + '만';
  return s + a.toLocaleString('ko-KR');
}
function pad2(n) { return ('0' + n).slice(-2); }
function ymOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
function ymShift(ym, k) { const p = ym.split('-'); return ymOf(new Date(+p[0], +p[1] - 1 + k, 1)); }
function ymLabel(ym) { const p = ym.split('-'); return (p[0] === String(new Date().getFullYear()) ? '' : p[0] + '년 ') + Number(p[1]) + '월'; }
function todayIso() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function ago(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime(); if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return '방금'; if (m < 60) return m + '분 전';
  const h = Math.round(m / 60); if (h < 24) return h + '시간 전';
  const d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2000); }
function haptic() { try { navigator.vibrate && navigator.vibrate(8); } catch (e) { /* noop */ } }

/* ────────── API ────────── */
async function api(fn, ...args) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'app', key: S.key, fn, args }), signal: ctl.signal, redirect: 'follow' });
    const j = await r.json();
    if (!j.ok) {
      if (j.error === 'unauthorized') { disconnect('연결 코드가 맞지 않아요. 다시 넣어주세요.'); }
      throw new Error(j.error || '서버 오류');
    }
    if (j.user && j.user !== S.user) { S.user = j.user; localStorage.setItem('gb.user', j.user); }
    return j.data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('응답이 늦어요. 잠시 후 다시 시도해 주세요.');
    if (!navigator.onLine) throw new Error('인터넷 연결을 확인해 주세요.');
    throw e;
  } finally { clearTimeout(to); }
}

function setLoading(on) {
  S.loading = Math.max(0, S.loading + (on ? 1 : -1));
  $('refresh').classList.toggle('spin', S.loading > 0);
  renderStatus();
}

/* 쓰기 작업: 서버가 새 월 데이터를 돌려주면 그대로 반영 */
async function write(fn, args, okMsg) {
  setLoading(true);
  try {
    const d = await api(fn, ...args);
    if (d && d.month && d.rows) applyMonth(d);
    if (okMsg) toast(okMsg);
    haptic();
    return d;
  } catch (e) { toast(e.message); throw e; } finally { setLoading(false); }
}

/* ────────── 데이터 흐름 ────────── */
function applyMonth(d) {
  writeJ('gb.m.' + d.month, d);
  S.fetchedAt[d.month] = Date.now();
  if (d.month === S.ym) { S.data = d; S.err = ''; render(); }
}

async function boot() {
  const ym = S.ym;
  setLoading(true);
  try {
    const d = await api('boot', ym);
    S.cfg = d.config; writeJ('gb.cfg', d.config);
    applyMonth(d.month);
  } catch (e) { S.err = e.message; renderStatus(); } finally { setLoading(false); }
}

async function loadMonth(ym, force) {
  S.ym = ym;
  S.data = readJ('gb.m.' + ym);
  render();
  if (!force && S.fetchedAt[ym] && Date.now() - S.fetchedAt[ym] < 60000) return;
  setLoading(true);
  try { applyMonth(await api('getMonthData', ym)); }
  catch (e) { S.err = e.message; renderStatus(); }
  finally { setLoading(false); }
}

/* ────────── 렌더 ────────── */
function render() {
  renderHeader();
  renderStatus();
  if (!S.data) { renderSkeleton(); return; }
  if (S.tab === 'home') renderHome();
  if (S.tab === 'tx') renderTx();
  if (S.tab === 'asset') renderAsset();
  if (S.tab === 'set') renderSet();
}

function renderHeader() {
  const monthTab = S.tab === 'home' || S.tab === 'tx';
  $('prev').style.visibility = monthTab ? 'visible' : 'hidden';
  $('next').style.visibility = monthTab ? 'visible' : 'hidden';
  $('title').textContent = monthTab ? ymLabel(S.ym) : (S.tab === 'asset' ? '자산' : '설정');
  $('addBtn').style.visibility = S.tab === 'set' ? 'hidden' : 'visible';
}

function renderStatus() {
  const el = $('status');
  if (S.err) { el.innerHTML = '<span class="bad">' + esc(S.err) + '</span>'; return; }
  if (S.loading) { el.textContent = '최신 내역 불러오는 중…'; return; }
  const sy = S.data && S.data.ov && S.data.ov.sync;
  const parts = [];
  const t = S.fetchedAt[S.ym];
  parts.push(t ? '방금 업데이트' : (S.data ? '저장된 화면' : ''));
  if (sy && sy.lastSms) parts.push('폰 수신 ' + ago(sy.lastSms));
  if (sy && sy.macFilled) parts.push('<span class="warn">폰이 놓친 ' + sy.macFilled + '건 맥이 채움</span>');
  el.innerHTML = parts.filter(Boolean).join(' · ');
}

function renderSkeleton() {
  const pg = pageEl(S.tab);
  pg.innerHTML = '<div class="card"><div class="skel" style="width:40%"></div><div class="skel" style="height:34px;width:70%"></div><div class="skel"></div></div>' +
    '<div class="card"><div class="skel"></div><div class="skel"></div><div class="skel" style="width:60%"></div></div>';
}
function pageEl(t) { return { home: $('pgHome'), tx: $('txList'), asset: $('pgAsset'), set: $('pgSet') }[t]; }

/* 홈 */
function renderHome() {
  const d = S.data, ov = d.ov || {};
  const budget = d.budget || 0, v = d.variable || 0;
  const pct = budget ? v / budget : 0;
  let line;
  if (!budget) line = '<span>예산을 정하면 얼마나 남았는지 보여줘요</span>';
  else if (v > budget) line = '<span class="bad">예산 ' + man(budget) + '원보다 ' + man(v - budget) + '원 초과</span>';
  else line = '예산 ' + man(budget) + '원 중 <span class="good">' + man(budget - v) + '원 남음</span>';
  let pace = '';
  if (d.pace && v && budget) {
    const p = d.pace.projected;
    pace = '<div class="sub">' + d.pace.day + '일째 · 이 속도면 월말 약 ' + man(p) + '원' + (p > budget ? ' <span class="bad">(초과 예상)</span>' : '') + '</div>';
  }
  const planned = d.plannedFixed || 0;
  const reviews = d.rows.filter((r) => r.review);
  const recent = d.rows.filter((r) => !r.planned).slice(0, 5);
  const trend = (ov.trend || []).slice(-6);
  const tmax = Math.max(1, ...trend.map((t) => Math.max(t.income, t.fixed + t.variable)));

  let h = '';
  h += '<div class="card"><div class="lab">이번 달 생활비</div><div class="big num" id="hero">' + won(v) + '</div>' +
    '<div class="bar' + (pct > 1 ? ' over' : '') + '"><div style="width:' + Math.min(100, pct * 100) + '%"></div></div>' +
    '<div class="sub">' + line + '</div>' + pace + '</div>';
  h += '<div class="grid2">' +
    stat('수입', won(d.income), '', 'inc') +
    stat('고정지출', won(d.fixed), planned ? '예정 ' + man(planned) + '원 포함' : '모두 확정', '') +
    stat('회사경비', won(d.company), '정산 예정 · 지출 제외', 'co') +
    stat('남은 돈', won(d.remain), d.savings ? '저축 ' + man(d.savings) + '원 반영' : '저축 계획 없음', d.remain < 0 ? 'neg' : '') + '</div>';

  if (reviews.length) {
    h += '<div class="card"><h3 class="sec">확인 필요 <small>' + reviews.length + '건</small></h3>' +
      reviews.map((r) => '<div class="rv"><div style="min-width:0"><div class="nm">' + esc(r.memo || '-') + '</div>' +
        '<div class="m num">' + esc(r.date) + ' · ' + esc(r.pay || '') + ' · ' + won(r.amt) + ' · ' + esc(r.gubun + '/' + r.cat) + '</div></div>' +
        '<div class="acts"><button class="btn" data-edit="' + r.row + '">고치기</button><button class="btn primary" data-ok="' + r.row + '">맞아요</button></div></div>').join('') + '</div>';
  }

  if (d.cats && d.cats.length) {
    h += '<div class="card"><h3 class="sec">어디에 썼나 <small>변동지출</small></h3>' +
      d.cats.slice(0, 6).map((c) => '<div class="cat" data-cat="' + esc(c.name) + '"><span>' + esc(c.name) + '</span><div class="b"><div style="width:' + (c.pctMax * 100) + '%"></div></div><span class="v num">' + man(c.amt) + '</span></div>').join('') + '</div>';
  }

  if (trend.length) {
    h += '<div class="card"><h3 class="sec">최근 6개월 <span class="legend"><span><i style="background:var(--good)"></i>수입</span><span><i style="background:var(--accent)"></i>지출</span></span></h3><div class="trend">' +
      trend.map((t) => '<div class="tcol' + (t.m === S.ym ? ' on' : '') + '" data-ym="' + t.m + '"><div class="tbars"><i style="height:' + (t.income / tmax * 96) + 'px"></i><i class="sp" style="height:' + ((t.fixed + t.variable) / tmax * 96) + 'px"></i></div><span>' + Number(t.m.slice(5)) + '월</span></div>').join('') +
      '</div></div>';
  }

  h += '<div class="card"><h3 class="sec">최근 거래 <button data-go="tx">전체 보기</button></h3>' +
    (recent.length ? '<div>' + recent.map(txRow).join('') + '</div>' : '<div class="empty">아직 거래가 없어요</div>') + '</div>';
  h += '<div class="foot">카드·은행 문자는 받는 즉시 기록돼요 · 매일 새벽 6시 자동 정리</div>';
  $('pgHome').innerHTML = h;
}
function stat(l, v, s, cls) { return '<div class="stat"><div class="lab">' + l + '</div><div class="v num ' + cls + '">' + v + '</div><div class="s">' + esc(s) + '</div></div>'; }

function txRow(r) {
  const sign = r.gubun === '수입' ? '+' : '';
  const cls = r.gubun === '수입' ? 'inc' : (r.gubun === '회사경비' ? 'co' : '');
  const tags = (r.review ? '<span class="tag rv">확인</span>' : '') + (r.planned ? '<span class="tag pl">예정</span>' : '') + (r.isNew && !r.review ? '<span class="tag nw">NEW</span>' : '');
  return '<div class="tx' + (r.planned ? ' plan' : '') + '" data-edit="' + r.row + '"><div class="l"><div class="nm">' + esc(r.memo || r.cat || '-') + tags + '</div>' +
    '<div class="m">' + esc(r.cat) + (r.pay ? ' · ' + esc(r.pay) : '') + '</div></div><div class="a num ' + cls + '">' + sign + num(r.amt) + '</div></div>';
}

/* 거래 */
function renderTx() {
  const d = S.data;
  const chips = [['all', '전체'], ['변동', '변동'], ['고정', '고정'], ['수입', '수입'], ['회사경비', '회사경비'], ['review', '확인 필요']];
  let ch = chips.map((c) => '<button class="chip' + (S.filter === c[0] && !S.cat ? ' on' : '') + '" data-f="' + c[0] + '">' + c[1] + '</button>').join('');
  if (S.cat) ch = '<button class="chip on" data-f="all">' + esc(S.cat) + ' ✕</button>' + ch;
  $('txChips').innerHTML = ch;
  const q = S.q.trim().toLowerCase();
  const rows = d.rows.filter((r) => {
    if (S.cat && !(r.gubun === '변동' && r.cat === S.cat)) return false;
    if (!S.cat && S.filter === 'review' && !r.review) return false;
    if (!S.cat && S.filter !== 'all' && S.filter !== 'review' && r.gubun !== S.filter) return false;
    if (q) { const hay = (r.memo + ' ' + r.cat + ' ' + r.pay + ' ' + r.src + ' ' + r.amt).toLowerCase(); if (hay.indexOf(q) < 0) return false; }
    return true;
  });
  if (!rows.length) { $('txList').innerHTML = '<div class="empty">조건에 맞는 거래가 없어요</div>'; return; }
  const groups = [];
  rows.filter((r) => !r.planned).forEach((r) => { const g = groups[groups.length - 1]; if (g && g.day === r.iso) g.rows.push(r); else groups.push({ day: r.iso, rows: [r] }); });
  const plans = rows.filter((r) => r.planned).sort((a, b) => (a.iso < b.iso ? -1 : 1));
  const wd = ['일', '월', '화', '수', '목', '금', '토'];
  $('txList').innerHTML = groups.map((g) => {
    const dt = new Date(g.day + 'T00:00:00');
    const spend = g.rows.filter((r) => r.gubun === '변동' || r.gubun === '고정').reduce((a, r) => a + r.amt, 0);
    return '<div class="day"><span>' + (dt.getMonth() + 1) + '월 ' + dt.getDate() + '일 ' + wd[dt.getDay()] + '요일</span><span class="num">' + (spend ? '-' + num(spend) : '') + '</span></div>' +
      '<div class="card tight">' + g.rows.map(txRow).join('') + '</div>';
  }).join('') +
    (plans.length ? '<div class="day"><span>아직 안 나간 고정지출 (예정)</span><span class="num">-' + num(plans.reduce((a, r) => a + r.amt, 0)) + '</span></div>' +
      '<div class="card tight">' + plans.map((r) => txRow(r).replace('<div class="m">', '<div class="m">' + esc(r.date) + ' · ')).join('') + '</div>' : '') +
    '<div class="foot">' + rows.length + '건</div>';
}

/* 자산 */
function renderAsset() {
  const ov = S.data.ov || {}, t = ov.totals || { asset: 0, debt: 0, net: 0 };
  const hist = ov.hist || [];
  let chg = '';
  if (ov.change30 && hist.length > 1) {
    const a = ov.change30.amt, cl = a > 0 ? 'up' : a < 0 ? 'down' : 'flat';
    chg = '<div class="chg ' + cl + '">' + (a > 0 ? '▲ ' : a < 0 ? '▼ ' : '') + won(Math.abs(a)) + ' <span style="color:var(--ink3);font-weight:500">' + esc(ov.change30.from.slice(5).replace('-', '/')) + ' 대비</span></div>';
  }
  const assets = (ov.assets || []).filter((a) => a.kind !== '부채'), debts = (ov.assets || []).filter((a) => a.kind === '부채');
  const row = (a) => '<div class="arow" data-asset="' + a.row + '"><div><div class="nm">' + esc(a.name) + (a.mode === '문자' ? '<span class="tag auto">문자 자동</span>' : '') + '</div>' +
    '<div class="m">' + esc([a.org, a.updated ? a.updated.slice(5).replace('-', '/') + ' 기준' : '값 없음'].filter(Boolean).join(' · ')) + '</div></div>' +
    '<div class="a num' + (a.kind === '부채' ? ' neg' : '') + '">' + num(a.amt) + '</div></div>';
  let h = '<div class="card"><div class="lab">순자산</div><div class="big num">' + won(t.net) + '</div>' + chg + spark(hist) +
    '<div class="sub">총자산 <b class="num">' + man(t.asset) + '</b> · 총부채 <b class="num">' + man(t.debt) + '</b></div></div>';
  h += '<div class="card"><h3 class="sec">자산 <small class="num">' + man(t.asset) + '</small></h3>' + (assets.map(row).join('') || '<div class="empty">없음</div>') + '</div>';
  h += '<div class="card"><h3 class="sec">부채 <small class="num">' + man(t.debt) + '</small></h3>' + (debts.map(row).join('') || '<div class="empty">없음</div>') + '</div>';
  h += '<div class="foot">금액을 누르면 고칠 수 있어요 · 매일 새벽 순자산이 기록돼요</div>';
  $('pgAsset').innerHTML = h;
}
function spark(h) {
  if (h.length < 2) return '<div class="sub">매일 새벽 기록이 쌓이면 추이가 보여요</div>';
  const W = 300, H = 70, p = 4; let mn = Infinity, mx = -Infinity;
  h.forEach((x) => { mn = Math.min(mn, x.net); mx = Math.max(mx, x.net); });
  if (mx === mn) { mx += 1; mn -= 1; }
  const X = (i) => p + (W - 2 * p) * i / (h.length - 1), Y = (v) => p + (H - 2 * p) * (1 - (v - mn) / (mx - mn));
  const dd = h.map((x, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(x.net).toFixed(1)).join(' ');
  return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"><path d="' + dd + ' L' + X(h.length - 1) + ' ' + H + ' L' + X(0) + ' ' + H + 'Z" fill="var(--accent-soft)"/>' +
    '<path d="' + dd + '" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
}

/* 설정 */
function renderSet() {
  const d = S.data, sy = (d.ov && d.ov.sync) || {}, sp = d.savePlan || { total: 0, parkPct: 50 };
  const lb = (S.cfg && S.cfg.saveLabels) || ['파킹통장', '배당 ETF'];
  const dot = (ok) => '<span class="dot' + (ok ? '' : ' off') + '"></span>';
  const recent = (iso, hrs) => iso && Date.now() - new Date(iso).getTime() < hrs * 3600e3;
  let h = '<div class="card"><h3 class="sec">자동 수집</h3>' +
    '<div class="srow"><span>' + dot(recent(sy.lastSms, 72)) + '폰 단축어</span><span class="r">' + (sy.lastSms ? ago(sy.lastSms) : '받은 문자 없음') + '</span></div>' +
    '<div class="srow"><span>' + dot(recent(sy.lastMac, 48)) + '맥 보완</span><span class="r">' + (sy.lastMac ? ago(sy.lastMac) : '-') + '</span></div>' +
    '<div class="srow"><span>' + dot(sy.on) + '새벽 6시 정리</span><span class="r">' + (sy.lastRun ? ago(sy.lastRun) : (sy.on ? '켜짐' : '꺼짐')) + '</span></div>' +
    (sy.macFilled ? '<div class="srow"><span><span class="dot mid"></span>폰이 놓친 문자 (7일)</span><span class="r">' + sy.macFilled + '건 맥이 채움</span></div>' : '') +
    '</div>';
  h += '<div class="card"><h3 class="sec">' + esc(ymLabel(S.ym)) + ' 설정</h3>' +
    '<div class="srow link" data-set="budget"><span>생활비 예산</span><span class="r num">' + (d.budget ? won(d.budget) : '정하기') + '</span></div>' +
    '<div class="srow link" data-set="save"><span>저축 계획</span><span class="r num">' + won(sp.total) + ' · ' + esc(lb[0]) + ' ' + sp.parkPct + '%</span></div>' +
    '<div class="srow link" data-set="carry"><span>지난달 고정지출 이어받기</span><span class="r">이미 있으면 건너뜀</span></div></div>';
  h += '<div class="card"><h3 class="sec">바로가기</h3>' +
    '<a class="srow link" href="' + SHEET_URL + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><span>구글 시트 열기</span><span class="r">원본 데이터</span></a></div>';
  h += '<div class="card"><h3 class="sec">연결</h3>' +
    '<div class="srow"><span>로그인</span><span class="r">' + esc(S.user || '-') + '</span></div>' +
    '<div class="srow link" data-set="logout"><span style="color:var(--bad)">이 기기 연결 해제</span><span class="r"></span></div></div>';
  h += '<div class="foot">우리집 가계부 v' + VERSION + '</div>';
  $('pgSet').innerHTML = h;
}

/* ────────── 시트(편집 창) ────────── */
function openSheet(html) {
  const sh = $('sheet');
  sh.innerHTML = '<div class="grab"></div>' + html;
  $('scrim').hidden = false;
  requestAnimationFrame(() => sh.classList.add('on'));
}
function closeSheet() { $('sheet').classList.remove('on'); $('scrim').hidden = true; }

function txSheet(r) {
  const cfg = S.cfg || { catsBy: {}, pays: [] };
  const isNew = !r;
  const t = r ? { date: r.iso, gubun: r.gubun, cat: r.cat, memo: r.memo, pay: r.pay, amt: r.amt }
    : { date: todayIso(), gubun: '변동', cat: '', memo: '', pay: (cfg.pays || [])[0] || '', amt: '' };
  const st = { ...t };
  const catsFor = (g) => { const l = ((cfg.catsBy || {})[g] || cfg.cats || []).slice(); if (st.cat && l.indexOf(st.cat) < 0 && g === t.gubun) l.unshift(st.cat); return l; };
  const draw = () => {
    openSheet(
      '<h2>' + (isNew ? '거래 추가' : '거래 수정') + '</h2>' +
      (r && r.src && r.src !== r.memo ? '<div class="lab" style="margin:-6px 0 8px">원본: ' + esc(r.src) + '</div>' : '') +
      '<input class="amt num" id="fAmt" inputmode="numeric" placeholder="₩0" value="' + (st.amt !== '' ? won(st.amt) : '') + '">' +
      '<div class="fl">구분</div><div class="seg" id="fG">' + GUBUN_ORDER.map((g) => '<button data-g="' + g + '" class="' + (st.gubun === g ? 'on' : '') + '">' + g + '</button>').join('') + '</div>' +
      '<div class="fl">카테고리</div><div class="wrapchips" id="fC">' + catsFor(st.gubun).map((c) => '<button class="chip' + (st.cat === c ? ' on' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' +
      '<div class="fl">내용</div><input class="inp" id="fM" value="' + esc(st.memo) + '" placeholder="예: 마트 장보기">' +
      '<div class="fl">날짜</div><input class="inp" id="fD" type="date" value="' + esc(st.date) + '">' +
      '<div class="fl">결제수단</div><div class="wrapchips" id="fP">' + (cfg.pays || []).map((p) => '<button class="chip' + (st.pay === p ? ' on' : '') + '" data-p="' + esc(p) + '">' + esc(p) + '</button>').join('') + '</div>' +
      '<div class="sheet-acts">' + (isNew ? '' : '<button class="btn danger" id="fDel">삭제</button>') + '<button class="btn" id="fCancel">취소</button><button class="btn primary" id="fSave">저장</button></div>');
    const amt = $('fAmt');
    amt.oninput = () => { const v = amt.value.replace(/[^\d-]/g, ''); st.amt = v === '' ? '' : Number(v); amt.value = v === '' ? '' : won(st.amt); };
    $('fG').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; sync(); st.gubun = b.dataset.g; if (catsFor(st.gubun).indexOf(st.cat) < 0) st.cat = ''; draw(); };
    $('fC').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.cat = b.dataset.c; [...$('fC').children].forEach((x) => x.classList.toggle('on', x === b)); };
    $('fP').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.pay = b.dataset.p; [...$('fP').children].forEach((x) => x.classList.toggle('on', x === b)); };
    $('fCancel').onclick = closeSheet;
    if ($('fDel')) $('fDel').onclick = async () => {
      if (!confirm('이 거래를 삭제할까요?')) return;
      closeSheet(); await write('deleteTx', [S.ym, r.row], '삭제했어요');
    };
    $('fSave').onclick = async () => {
      sync();
      if (!st.amt && st.amt !== 0) { toast('금액을 입력해 주세요'); return; }
      if (!st.cat) { toast('카테고리를 골라주세요'); return; }
      const btn = $('fSave'); btn.disabled = true; btn.textContent = '저장 중…';
      const payload = { date: st.date, gubun: st.gubun, cat: st.cat, memo: st.memo, pay: st.pay, amt: st.amt };
      try {
        const targetYm = st.date ? st.date.slice(0, 7) : S.ym;
        if (isNew) await write('addTransaction', [targetYm, payload], '추가했어요');
        else await write('updateTx', [S.ym, r.row, payload], '저장했어요');
        closeSheet();
        if (isNew && targetYm !== S.ym) loadMonth(targetYm, true);
      } catch (e) { btn.disabled = false; btn.textContent = '저장'; }
    };
    if (isNew) setTimeout(() => amt.focus(), 300);
  };
  const sync = () => { if ($('fM')) st.memo = $('fM').value; if ($('fD')) st.date = $('fD').value; };
  draw();
}

function numSheet(title, value, hint, onSave) {
  openSheet('<h2>' + esc(title) + '</h2>' + (hint ? '<div class="lab" style="margin:-6px 0 10px">' + esc(hint) + '</div>' : '') +
    '<input class="amt num" id="nV" inputmode="numeric" value="' + (value ? won(value) : '') + '" placeholder="₩0">' +
    '<div class="sheet-acts"><button class="btn" id="nC">취소</button><button class="btn primary" id="nS">저장</button></div>');
  const inp = $('nV'); let v = value || 0;
  inp.oninput = () => { const s = inp.value.replace(/[^\d]/g, ''); v = Number(s || 0); inp.value = s ? won(v) : ''; };
  $('nC').onclick = closeSheet;
  $('nS').onclick = async () => { const b = $('nS'); b.disabled = true; b.textContent = '저장 중…'; try { await onSave(v); closeSheet(); } catch (e) { b.disabled = false; b.textContent = '저장'; } };
  setTimeout(() => { inp.focus(); inp.select(); }, 300);
}

function saveSheet() {
  const sp = (S.data && S.data.savePlan) || { total: 0, parkPct: 50 };
  const lb = (S.cfg && S.cfg.saveLabels) || ['파킹통장', '배당 ETF'];
  let total = sp.total || 0, pct = sp.parkPct;
  openSheet('<h2>' + esc(ymLabel(S.ym)) + ' 저축 계획</h2>' +
    '<input class="amt num" id="sV" inputmode="numeric" value="' + (total ? won(total) : '') + '" placeholder="₩0">' +
    '<div class="fl">나누기 · <span id="sL"></span></div><input type="range" id="sR" min="0" max="100" step="5" value="' + pct + '" style="width:100%">' +
    '<div class="sheet-acts"><button class="btn" id="sC">취소</button><button class="btn primary" id="sS">저장</button></div>');
  const paint = () => { const a = Math.round(total * pct / 100); $('sL').textContent = lb[0] + ' ' + pct + '% ' + man(a) + ' · ' + lb[1] + ' ' + (100 - pct) + '% ' + man(total - a); };
  paint();
  $('sV').oninput = () => { const s = $('sV').value.replace(/[^\d]/g, ''); total = Number(s || 0); $('sV').value = s ? won(total) : ''; paint(); };
  $('sR').oninput = () => { pct = Number($('sR').value); paint(); };
  $('sC').onclick = closeSheet;
  $('sS').onclick = async () => { $('sS').disabled = true; try { await write('setSavePlan', [S.ym, total, pct], '저장했어요'); closeSheet(); } catch (e) { $('sS').disabled = false; } };
}

/* ────────── 이벤트 ────────── */
function findRow(row) { return S.data && S.data.rows.find((r) => r.row === Number(row)); }
function go(tab) {
  S.tab = tab;
  document.querySelectorAll('.pg').forEach((p) => p.classList.toggle('on', p.dataset.p === tab));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.t === tab));
  window.scrollTo(0, 0);
  render();
}

function bind() {
  $('tabs').onclick = (e) => { const t = e.target.closest('.tab'); if (t) { haptic(); go(t.dataset.t); } };
  $('prev').onclick = () => loadMonth(ymShift(S.ym, -1));
  $('next').onclick = () => loadMonth(ymShift(S.ym, 1));
  $('refresh').onclick = () => { S.err = ''; loadMonth(S.ym, true); };
  $('addBtn').onclick = () => txSheet(null);
  $('scrim').onclick = closeSheet;
  $('q').oninput = () => { S.q = $('q').value; renderTx(); };
  $('txChips').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; S.filter = b.dataset.f; S.cat = ''; renderTx(); };
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-ok],[data-edit],[data-cat],[data-go],[data-ym],[data-asset],[data-set]');
    if (!el || el.closest('#sheet')) return;
    if (el.dataset.ok) { el.disabled = true; await write('confirmTx', [S.ym, Number(el.dataset.ok)], '확인했어요 · 다음부터 자동 분류'); return; }
    if (el.dataset.edit) { const r = findRow(el.dataset.edit); if (r) txSheet(r); return; }
    if (el.dataset.cat) { S.cat = el.dataset.cat; S.filter = 'all'; go('tx'); return; }
    if (el.dataset.go) { go(el.dataset.go); return; }
    if (el.dataset.ym) { loadMonth(el.dataset.ym); return; }
    if (el.dataset.asset) {
      const a = ((S.data.ov || {}).assets || []).find((x) => x.row === Number(el.dataset.asset)); if (!a) return;
      numSheet(a.name, a.amt, a.mode === '문자' ? '은행 문자가 오면 자동으로 바뀌어요' : '', (v) => write('updateAsset', [S.ym, a.row, v], '저장했어요'));
      return;
    }
    if (el.dataset.set === 'budget') numSheet(ymLabel(S.ym) + ' 생활비 예산', S.data.budget, '변동지출 기준이에요', (v) => write('setBudget', [S.ym, v], '저장했어요'));
    if (el.dataset.set === 'save') saveSheet();
    if (el.dataset.set === 'carry') { const d = await write('carryFixed', [S.ym]); if (d && d.carried) toast(d.carried.count ? d.carried.from + ' 고정지출 ' + d.carried.count + '건을 가져왔어요' : '가져올 새 항목이 없어요'); }
    if (el.dataset.set === 'logout') { if (confirm('이 기기에서 연결을 해제할까요? 다시 쓰려면 연결 코드가 필요해요.')) disconnect(''); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.key && S.ym && (!S.fetchedAt[S.ym] || Date.now() - S.fetchedAt[S.ym] > 60000)) loadMonth(S.ym, true);
  });
  window.addEventListener('online', () => { S.err = ''; loadMonth(S.ym, true); });
  $('keyBtn').onclick = () => connect($('keyIn').value);
  $('keyIn').onkeydown = (e) => { if (e.key === 'Enter') connect($('keyIn').value); };
}

/* ────────── 연결 ────────── */
async function connect(k) {
  k = String(k || '').trim();
  if (!/^gb_[0-9a-f]{20,}$/.test(k)) { $('keyErr').textContent = '연결 코드 형식이 아니에요.'; return; }
  $('keyBtn').disabled = true; $('keyErr').textContent = '';
  S.key = k;
  try {
    const d = await api('boot', S.ym);
    localStorage.setItem('gb.key', k);
    S.cfg = d.config; writeJ('gb.cfg', d.config);
    $('connect').hidden = true;
    applyMonth(d.month);
    toast('연결됐어요');
  } catch (e) { $('keyErr').textContent = e.message === 'unauthorized' ? '연결 코드가 맞지 않아요.' : e.message; S.key = ''; }
  finally { $('keyBtn').disabled = false; }
}
function disconnect(msg) {
  localStorage.removeItem('gb.key'); localStorage.removeItem('gb.user');
  Object.keys(localStorage).filter((k) => k.indexOf('gb.m.') === 0 || k === 'gb.cfg').forEach((k) => localStorage.removeItem(k));
  S.key = ''; S.data = null; S.user = '';
  $('keyErr').textContent = msg || '';
  $('connect').hidden = false;
}

/* ────────── 시작 ────────── */
(function start() {
  const m = location.hash.match(/k=(gb_[0-9a-f]+)/);
  if (m) { S.key = m[1]; localStorage.setItem('gb.key', m[1]); history.replaceState(null, '', location.pathname + location.search); }
  S.ym = ymOf(new Date());
  bind();
  if (!S.key) { $('connect').hidden = false; render(); return; }
  S.data = readJ('gb.m.' + S.ym);
  render();
  boot();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 캐시는 선택 기능 */ });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && S.loading === 0) { reloaded = true; location.reload(); } });
  }
})();
