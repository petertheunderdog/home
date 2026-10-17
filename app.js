/* 차곡 · 우리집 가계부 PWA
 * 데이터는 구글 시트(Apps Script API)에 있고, 이 앱은 화면만 담당해요.
 * 열 때는 폰에 저장해 둔 마지막 화면을 바로 보여주고, 뒤에서 최신 데이터를 받아와요. */
'use strict';
const VERSION = '1.2.1';
const API = 'https://script.google.com/macros/s/AKfycbyxgtCCZJEixEnxgHr_g-XbBrFy4j7oqd0GTJ7GK29Z3okMu5Kk8JN_FBFjkBSBsMXkdg/exec';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1O9fVSgn2GEPlz2eURBd0J_kQzQH5vuwphPRmo1yAco4/edit';
const GUBUN_ORDER = ['변동', '고정', '수입', '회사경비', '저축'];
const GOOGLE_CLIENT_ID = '1022673988298-t7kv7qqbld5fgovvujputd0uhuef2l7f.apps.googleusercontent.com';
const REDIRECT_URI = 'https://petertheunderdog.github.io/home/';

const S = {
  key: localStorage.getItem('gb.key') || readCookie('gb_key'),
  user: localStorage.getItem('gb.user') || '',
  cfg: readJ('gb.cfg'),
  ym: null, data: null, tab: 'home', led: 'sum',
  baby: readJ('gb.baby'), babyAt: 0, bview: 'list', bcat: 'all', bopen: {},
  filter: 'all', cat: '', q: '',
  loading: 0, fetchedAt: {}, err: ''
};

/* 탭 · 화면 아이콘 (선 아이콘, currentColor) */
const SV = (d) => '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const IC = {
  home: SV('<path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6h-6v6H4.5a1 1 0 0 1-1-1z"/>'),
  tx: SV('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  asset: SV('<path d="M4 20h16"/><path d="M5 16l4.5-5 3.5 3 6-7"/><path d="M15 7h4v4"/>'),
  baby: SV('<path d="M12 4v6h8a7.5 7.5 0 0 0-8-6z"/><path d="M2.5 6H5l1.6 5.4A3 3 0 0 0 9.5 13.5H17a3 3 0 0 0 3-3V10"/><circle cx="9" cy="18.5" r="1.8"/><circle cx="17" cy="18.5" r="1.8"/>'),
  set: SV('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>')
};

/* ────────── utils ────────── */
/* 아이폰은 홈 화면 앱과 사파리의 저장 공간이 따로라서, 홈 화면에 추가할 때 함께 복사되는 쿠키에도 연결 코드를 남겨둬요 */
function readCookie(n) { const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
function saveKey(k) {
  localStorage.setItem('gb.key', k);
  document.cookie = 'gb_key=' + encodeURIComponent(k) + '; max-age=31536000; path=/; Secure; SameSite=Lax';
}
function clearKey() { localStorage.removeItem('gb.key'); document.cookie = 'gb_key=; max-age=0; path=/; Secure; SameSite=Lax'; }
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
      if (j.error === 'unauthorized') { disconnect('다시 로그인해 주세요.'); }
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
  loadBaby(true);
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
  if (S.tab === 'baby') { renderBaby(); return; }
  if (!S.data) { renderSkeleton(); return; }
  if (S.tab === 'home') renderHome();
  if (S.tab === 'tx') renderLedger();
  if (S.tab === 'asset') renderAsset();
  if (S.tab === 'set') renderSet();
}

function renderHeader() {
  const monthTab = S.tab === 'tx';
  $('prev').style.display = monthTab ? '' : 'none';
  $('next').style.display = monthTab ? '' : 'none';
  $('title').textContent = monthTab ? ymLabel(S.ym) + ' 가계부' : ({ home: '차곡', asset: '자산', baby: '출산준비', set: '설정' }[S.tab] || '');
  $('addBtn').style.visibility = S.tab === 'set' || S.tab === 'asset' ? 'hidden' : 'visible';
  $('addBtn').setAttribute('aria-label', S.tab === 'baby' ? '메모 · 살 것 추가' : '거래 추가');
}

/* 가장 최근에 데이터가 들어온 시각: 실시간 수집 · 보완 수집 · 일일 정리 중 가장 늦은 것 */
function latestSync(sy) { return sy ? [sy.lastSms, sy.lastMac, sy.lastRun].filter(Boolean).sort().pop() || '' : ''; }
function renderStatus() {
  const el = $('status');
  if (S.err) { el.innerHTML = '<span class="bad">' + esc(S.err) + '</span>'; return; }
  if (S.loading) { el.textContent = '동기화 중…'; return; }
  if (S.tab === 'baby') { el.textContent = S.babyAt ? '최신 업데이트: ' + ago(new Date(S.babyAt).toISOString()) : ''; return; }
  const t = latestSync(S.data && S.data.ov && S.data.ov.sync);
  el.textContent = t ? '최신 업데이트: ' + ago(t) : '';
}

function renderSkeleton() {
  const pg = pageEl(S.tab);
  pg.innerHTML = '<div class="card"><div class="skel" style="width:40%"></div><div class="skel" style="height:34px;width:70%"></div><div class="skel"></div></div>' +
    '<div class="card"><div class="skel"></div><div class="skel"></div><div class="skel" style="width:60%"></div></div>';
}
function pageEl(t) { return { home: $('pgHome'), tx: $('ledSum'), asset: $('pgAsset'), baby: $('pgBaby'), set: $('pgSet') }[t]; }

/* 가계부: 요약 | 내역 */
function renderLedger() {
  [...$('ledSeg').children].forEach((b) => b.classList.toggle('on', b.dataset.led === S.led));
  $('ledSum').hidden = S.led !== 'sum';
  $('ledList').hidden = S.led !== 'list';
  if (S.led === 'sum') renderLedgerSum(); else renderTx();
}
/* 이번 달인데 아직 수입이 없으면 '월급 입금 전'으로 보고, 남은 돈 마이너스를 빨간색으로 겁주지 않아요 */
function prePay(d) { return !!d && d.month === ymOf(new Date()) && !(d.income > 0); }
function renderLedgerSum() {
  const d = S.data, ov = d.ov || {};
  const budget = d.budget || 0, v = d.variable || 0, fx = d.fixed || 0;
  const pct = budget ? v / budget : 0;
  let line;
  if (!budget) line = '<span>변동지출 예산을 정하면 얼마나 남았는지 보여줘요</span>';
  else if (v > budget) line = man(budget) + '원 중 ' + man(v) + '원 사용 · <span class="bad">' + man(v - budget) + '원 초과</span>';
  else line = man(budget) + '원 중 ' + man(v) + '원 사용 · <span class="good">' + man(budget - v) + '원 남음</span>';
  let pace = '';
  if (d.pace && v && budget) {
    const p = d.pace.projected;
    pace = '<div class="sub">' + d.pace.day + '일째 · 이 속도면 월말 변동지출 약 ' + man(p) + '원' + (p > budget ? ' <span class="bad">(초과 예상)</span>' : '') + '</div>';
  }
  const planned = d.plannedFixed || 0;
  const reviews = d.rows.filter((r) => r.review);
  const recent = d.rows.filter((r) => !r.planned).slice(0, 5);
  const trend = (ov.trend || []).slice(-6);
  const tmax = Math.max(1, ...trend.map((t) => Math.max(t.income, t.fixed + t.variable)));

  let h = '';
  h += '<div class="card"><div class="lab">이번 달 총지출 <small>변동 + 고정</small></div><div class="big num" id="hero">' + won(v + fx) + '</div>' +
    '<div class="sub">변동 ' + man(v) + ' + 고정 ' + man(fx) + (planned ? ' <span class="muted">(예정 ' + man(planned) + ' 포함)</span>' : '') +
    (d.company ? ' · 회사경비 ' + man(d.company) + ' 제외' : '') + '</div>' +
    '<div class="bud"><div class="lab">변동지출 예산</div>' +
    '<div class="bar' + (pct > 1 ? ' over' : '') + '"><div style="width:' + Math.min(100, pct * 100) + '%"></div></div>' +
    '<div class="sub">' + line + '</div>' + pace + '</div></div>';
  h += '<div class="grid2">' +
    stat('수입', won(d.income), '', 'inc') +
    stat('고정지출', won(d.fixed), planned ? '예정 ' + man(planned) + '원 포함' : '모두 확정', '') +
    stat('회사경비', won(d.company), '정산 예정 · 지출 제외', 'co') +
    stat('남은 돈', won(d.remain), prePay(d) ? '월급 입금 전' : (d.savings ? '저축 ' + man(d.savings) + '원 반영' : '저축 계획 없음'), d.remain < 0 && !prePay(d) ? 'neg' : '') + '</div>';

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

  h += '<div class="card"><h3 class="sec">최근 거래 <button data-led="list">전체 보기</button></h3>' +
    (recent.length ? '<div>' + recent.map(txRow).join('') + '</div>' : '<div class="empty">아직 거래가 없어요</div>') + '</div>';
  h += '<div class="foot">카드 문자는 받는 즉시 기록돼요 · 1시간마다 자동 동기화</div>';
  $('ledSum').innerHTML = h;
}

/* 홈: 우리집 전체를 한눈에 (2단 타일 + 넓은 카드) */
function tile(go, icon, lab, val, sub, cls) {
  return '<div class="tile' + (cls ? ' ' + cls : '') + '" data-go="' + go + '"><div class="tl">' + (icon || '') + '<span>' + lab + '</span></div><div class="tv num">' + val + '</div>' + (sub ? '<div class="ts">' + sub + '</div>' : '') + '</div>';
}
function renderHome() {
  // 원칙: 홈은 한 화면 안에서 '지금 상태 + 어디로 갈지'만. 자세한 건 각 탭에서.
  const d = S.data, ov = d.ov || {};
  let h = '';
  const due = S.baby ? bDue() : null;
  if (due) h += '<div class="strip" data-go="baby">' + IC.baby + '<span>짹짹이 만나기까지 <b class="num">' + (due.left > 0 ? 'D-' + due.left : due.left === 0 ? 'D-day' : 'D+' + (-due.left)) + '</b></span>' + (due.left > 0 && due.w >= 0 ? '<small>임신 ' + due.w + '주 ' + due.d + '일</small>' : '') + '</div>';
  const budget = d.budget || 0, v = d.variable || 0, pct = budget ? v / budget : 0;
  const spendAll = v + (d.fixed || 0);
  const reviews = d.rows.filter((r) => r.review).length;
  const t = ov.totals || { asset: 0, debt: 0, net: 0 };
  let chg = '자산 ' + man(t.asset) + ' · 부채 ' + man(t.debt);
  if (ov.change30 && (ov.hist || []).length > 1) { const a = ov.change30.amt; chg = '<span class="chg ' + (a > 0 ? 'up' : a < 0 ? 'down' : 'flat') + '">' + (a > 0 ? '▲' : a < 0 ? '▼' : '') + man(Math.abs(a)) + '</span> ' + esc(ov.change30.from.slice(5).replace('-', '/')) + ' 대비'; }
  const bsub = budget ? '<div class="bar sm' + (pct > 1 ? ' over' : '') + '"><div style="width:' + Math.min(100, pct * 100) + '%"></div></div>' +
    (v > budget ? '<span class="bad">변동 예산 ' + man(v - budget) + ' 초과</span>' : '<span class="good">변동 예산 ' + man(budget - v) + ' 남음</span>') : '변동 ' + man(v) + ' · 고정 ' + man(d.fixed || 0);
  h += '<div class="tiles">' +
    tile('tx', IC.tx, ymLabel(S.ym) + ' 총지출', man(spendAll), bsub) +
    tile('asset', IC.asset, '순자산', man(t.net), chg) +
    tile('tx', '', '이번 달 남은 돈', '<span class="' + (d.remain < 0 && !prePay(d) ? 'neg' : '') + '">' + man(d.remain) + '</span>', prePay(d) ? '월급 입금 전 · 지출 ' + man(spendAll) : '수입 ' + man(d.income) + ' · 지출 ' + man(spendAll)) +
    tile(reviews ? 'txrev' : 'tx', '', '확인할 거래', reviews ? '<span class="warn">' + reviews + '건</span>' : '없음', reviews ? '눌러서 바로 확인' : '모두 정리됐어요', reviews ? 'alert' : '') +
    '</div>';
  if (S.baby) {
    const sm = bSummary(), ev = bEvents(), memos = (S.baby.memos || []).filter((m) => m.st === '열림');
    const drops = sm.items.filter((i) => bChange(i) < 0);
    const lines = [];
    if (drops.length) lines.push('<div class="hl1"><span class="k">가격</span><span class="hn">' + esc(drops[0].name.replace(/\s*\(.*\)$/, '')) + ' <b class="pdown">▼' + man(-bChange(drops[0])) + '</b>' + (drops.length > 1 ? ' 외 ' + (drops.length - 1) + '개' : '') + '</span></div>');
    if (ev.length) lines.push('<div class="hl1"><span class="k">행사</span><span class="hn">' + esc(ev[0].name) + ' ' + esc(ev[0].label) + '</span><b>' + esc(ev[0].tag) + '</b></div>');
    if (memos.length) lines.push('<div class="hl1" data-go="baby" data-bv="memo"><span class="k">메모</span>' + bWhoChip(memos[0].by) + '<span class="hn">' + esc(memos[0].text.split('\n')[0]) + '</span>' + (memos.length > 1 ? '<b class="cnt">' + memos.length + '</b>' : '') + '</div>');
    h += '<div class="card hsec cmp" data-go="baby"><h3 class="sec"><span class="st">' + IC.baby + '출산준비</span><span class="hsum">확정 ' + sm.conf.length + ' · 완료 ' + sm.done.length + ' · 후보 ' + sm.cand.length + '<span class="chev">›</span></span></h3>' +
      '<div class="picks">' + sm.conf.slice(0, 4).map((i) => { const b = bBest(i); return '<div class="pick">' + bImg(i, 'hph') + '<div><div class="pn">' + esc(i.name.replace(/\s*\(.*\)$/, '')) + '</div><b class="num">' + (b ? man(b.p) : '확인 중') + '</b></div></div>'; }).join('') +
      (sm.conf.length ? '' : '<div class="ts">아직 구매 확정한 품목이 없어요</div>') + '</div>' +
      (sm.confKnown ? '<div class="ts tot">확정 ' + sm.conf.length + '개 지금 사면 <b class="num">' + man(sm.confSum) + '원</b></div>' : '') +
      lines.join('') + '</div>';
  }
  const last = d.rows.filter((r) => !r.planned)[0];
  if (last) h += '<div class="strip light" data-go="tx" data-led2="list"><span class="k">최근 거래</span><span class="hn">' + esc(last.memo || last.cat) + '</span><b class="num">' + num(last.amt) + '</b><span class="chev">›</span></div>';
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
  h += '<div class="foot">금액을 누르면 고칠 수 있어요 · 순자산은 하루 단위로 기록돼요</div>';
  $('pgAsset').innerHTML = h;
}
function spark(h) {
  if (h.length < 2) return '<div class="sub">기록이 쌓이면 추이가 보여요</div>';
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
  const when = (iso, none) => (iso ? ago(iso) : none);
  let h = '<div class="card"><h3 class="sec">데이터 동기화 <small>최신 업데이트: ' + esc(when(latestSync(sy), '-')) + '</small></h3>' +
    '<div class="srow"><span>' + dot(recent(sy.lastSms, 72)) + '실시간 수집 (카드 문자)</span><span class="r">' + when(sy.lastSms, '기록 없음') + '</span></div>' +
    '<div class="srow"><span>' + dot(recent(sy.lastMac, 48)) + '보완 수집 (Mac · 3시간마다)</span><span class="r">' + when(sy.lastMac, '기록 없음') + '</span></div>' +
    '<div class="srow"><span>' + dot(sy.on) + '정기 동기화 (1시간마다)</span><span class="r">' + (sy.lastRun ? ago(sy.lastRun) : (sy.on ? '사용 중' : '꺼짐')) + '</span></div>' +
    (sy.macFilled ? '<div class="srow"><span><span class="dot mid"></span>보완 수집으로 반영 (최근 7일)</span><span class="r">' + sy.macFilled + '건</span></div>' : '') +
    '</div>';
  h += '<div class="card"><h3 class="sec">' + esc(ymLabel(S.ym)) + ' 설정</h3>' +
    '<div class="srow link" data-set="budget"><span>생활비 예산</span><span class="r num">' + (d.budget ? won(d.budget) : '정하기') + '</span></div>' +
    '<div class="srow link" data-set="save"><span>저축 계획</span><span class="r num">' + won(sp.total) + ' · ' + esc(lb[0]) + ' ' + sp.parkPct + '%</span></div>' +
    '<div class="srow link" data-set="carry"><span>지난달 고정지출 이어받기</span><span class="r">이미 있으면 건너뜀</span></div></div>';
  const bm = (S.baby && S.baby.meta) || {};
  h += '<div class="card"><h3 class="sec">출산준비</h3>' +
    '<div class="srow link" data-set="due"><span>출산 예정일</span><span class="r num">' + esc(bm.dueDate || '정하기') + '</span></div>' +
    '<div class="srow"><span>' + dot(bm.updated && Date.now() - new Date(bm.updated).getTime() < 36 * 3600e3) + '가격 확인 (맥 · 매일 오전 9시)</span><span class="r">' + (bm.updated ? ago(bm.updated) : '기록 없음') + '</span></div></div>';
  h += '<div class="card"><h3 class="sec">바로가기</h3>' +
    '<a class="srow link" href="' + SHEET_URL + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><span>구글 시트 열기</span><span class="r">원본 데이터</span></a></div>';
  h += '<div class="card"><h3 class="sec">연결</h3>' +
    '<div class="srow"><span>로그인</span><span class="r">' + esc(S.user || '-') + '</span></div>' +
    '<div class="srow link" data-set="logout"><span style="color:var(--bad)">로그아웃</span><span class="r"></span></div></div>';
  h += '<div class="foot">차곡 v' + VERSION + '</div>';
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


/* ────────── 출산준비 ──────────
   살 물건 목록 · 판매처별 가격(매일 맥이 확인) · 둘이 남기는 아이디어/메모 */
const B_STATUS = ['후보', '구매 확정', '구매 완료', '보류'];
const B_GROUPS = ['공식몰', '가격비교', '백화점·종합몰', '기타', '해외 (일본)'];
const B_WHO = { '성현': 'w1', '소민': 'w2' };

async function loadBaby(force) {
  if (!S.key) return;
  if (!force && S.babyAt && Date.now() - S.babyAt < 60000) return;
  setLoading(true);
  try { applyBaby(await api('babyGet')); }
  catch (e) { if (S.tab === 'baby') { S.err = e.message; renderStatus(); } }
  finally { setLoading(false); }
}
function applyBaby(d) {
  if (!d || !d.items) return;
  S.baby = d; S.babyAt = Date.now(); writeJ('gb.baby', d);
  if (S.tab === 'baby' || S.tab === 'home') render();
}
async function bWrite(fn, args, okMsg) {
  setLoading(true);
  try { const d = await api(fn, ...args); applyBaby(d); if (okMsg) toast(okMsg); haptic(); return d; }
  catch (e) { toast(e.message); throw e; } finally { setLoading(false); }
}

/* 계산 */
function isoShift(iso, k) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + k); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function bBest(it) {
  const kr = (it.shops || []).filter((e) => e.m !== 'JP');
  if (!kr.length) return null;
  const last = kr.reduce((a, e) => (e.d > a ? e.d : a), '');
  const cut = isoShift(last, -3);
  return kr.filter((e) => e.d >= cut).sort((a, b) => (a.o === b.o ? a.p - b.p : (a.o ? -1 : 1)))[0];
}
function bJp(it) {
  const jp = (it.shops || []).filter((e) => e.m === 'JP');
  if (!jp.length) return null;
  const last = jp.reduce((a, e) => (e.d > a ? e.d : a), '');
  return jp.filter((e) => e.d === last).sort((a, b) => (a.l || a.p) - (b.l || b.p))[0];
}
function bGroup(e) {
  if (e.g) return e.g;
  if (e.m === 'JP') return '해외 (일본)';
  if (/공식/.test(e.s)) return '공식몰';
  if (/다나와|가격비교/.test(e.s)) return '가격비교';
  if (/롯데|신세계|현대|SSG|갤러리아/.test(e.s)) return '백화점·종합몰';
  return '기타';
}
function bChange(it) {
  const t = it.trend || [];
  if (t.length < 2) return 0;
  return t[t.length - 1][1] - t[t.length - 2][1];
}
function bCats() {
  const seen = [];
  ((S.baby && S.baby.items) || []).forEach((it) => { if (seen.indexOf(it.cat) < 0) seen.push(it.cat); });
  return seen;
}
function bDue() {
  const due = S.baby && S.baby.meta && S.baby.meta.dueDate;
  if (!due) return null;
  const left = Math.round((new Date(due + 'T00:00:00') - new Date(todayIso() + 'T00:00:00')) / 864e5);
  const gd = 280 - left;
  return { due, left, w: Math.floor(gd / 7), d: gd % 7 };
}
function bEvents() {
  const ev = (S.baby && S.baby.meta && S.baby.meta.events) || [];
  const now = new Date(todayIso() + 'T00:00:00'), y = now.getFullYear();
  const mk = (m, d) => { let dt = new Date(y, m - 1, d); if (dt - now < -200 * 864e5) dt = new Date(y + 1, m - 1, d); return dt; };
  return ev.map((s) => {
    const m = String(s).match(/(\d{1,2})\/(\d{1,2})(?:\s*~\s*(\d{1,2})\/(\d{1,2}))?/);
    if (!m) return null;
    const st = mk(+m[1], +m[2]), en = m[3] ? mk(+m[3], +m[4]) : st;
    const name = String(s).replace(m[0], '').replace(/\s*약\s*$/, '').trim();
    return { name, st, en, label: (st.getMonth() + 1) + '/' + st.getDate() + (m[3] ? '~' + (en.getMonth() + 1) + '/' + en.getDate() : '') + (/약/.test(s) ? ' (예상)' : '') };
  }).filter((e) => e && e.en >= now).sort((a, b) => a.st - b.st)
    .map((e) => { const dd = Math.round((e.st - now) / 864e5); return Object.assign(e, { dd, tag: dd <= 0 ? '진행 중' : 'D-' + dd }); });
}
function bSummary() {
  const items = (S.baby && S.baby.items) || [];
  const conf = items.filter((i) => i.status === '구매 확정'), done = items.filter((i) => i.status === '구매 완료');
  const cand = items.filter((i) => i.status === '후보');
  let confSum = 0, confKnown = 0;
  conf.forEach((i) => { const b = bBest(i); if (b) { confSum += b.p; confKnown++; } });
  const paid = done.reduce((a, i) => a + (i.paid || 0), 0);
  return { items, conf, done, cand, confSum, confKnown, paid };
}
function bImg(it, cls) {
  if (!it.img) return '<div class="' + cls + ' noimg">' + IC.baby + '</div>';
  const src = /^https?:/.test(it.img) ? it.img : it.img;
  return '<img class="' + cls + '" src="' + esc(src) + '" alt="" loading="lazy">';
}
function bWhoChip(n) { return '<span class="who ' + (B_WHO[n] || 'w0') + '">' + esc(n || '?') + '</span>'; }
function bSpark(t) {
  if (!t || !t.length) return '';
  if (t.length === 1) return '<div class="bsp1">가격 기록 ' + esc(t[0][0].slice(5).replace('-', '/')) + '부터 쌓이는 중</div>';
  const W = 300, H = 44, p = 4; let mn = Infinity, mx = -Infinity;
  t.forEach((x) => { mn = Math.min(mn, x[1]); mx = Math.max(mx, x[1]); });
  if (mx === mn) { mx += 1; mn -= 1; }
  const X = (i) => p + (W - 2 * p) * i / (t.length - 1), Y = (v) => p + (H - 2 * p) * (1 - (v - mn) / (mx - mn));
  const dd = t.map((x, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(x[1]).toFixed(1)).join(' ');
  return '<svg class="bsp" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"><path d="' + dd + '" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>' +
    '<div class="bspl"><span>' + esc(t[0][0].slice(5).replace('-', '/')) + '</span><span>최저 ' + man(Math.min(...t.map((x) => x[1]))) + '</span><span>' + esc(t[t.length - 1][0].slice(5).replace('-', '/')) + '</span></div>';
}

/* 화면 */
function renderBaby() {
  const pg = $('pgBaby');
  if (!S.baby) {
    pg.innerHTML = '<div class="card"><div class="skel" style="width:40%"></div><div class="skel" style="height:34px;width:70%"></div><div class="skel"></div></div>';
    return;
  }
  const sm = bSummary(), due = bDue(), ev = bEvents();
  const memos = S.baby.memos || [], openM = memos.filter((m) => m.st === '열림');
  let h = '<div class="card bhero">' +
    (due ? '<div class="lab">짹짹이 만나기까지</div><div class="big num">' + (due.left > 0 ? 'D-' + due.left : due.left === 0 ? 'D-day' : 'D+' + (-due.left)) + '</div>' +
      '<div class="sub">예정일 ' + esc(due.due.slice(5).replace('-', '/')) + (due.left > 0 && due.w >= 0 ? ' · 임신 ' + due.w + '주 ' + due.d + '일' : '') + '</div>'
      : '<div class="lab">출산준비</div><div class="sub link" data-set="due">예정일을 넣으면 D-day가 보여요 ›</div>') +
    '<div class="grid3">' +
    '<div><div class="lab">구매 확정</div><div class="v num">' + sm.conf.length + '개</div><div class="s">' + (sm.confKnown ? '지금 최저 ' + man(sm.confSum) : '가격 확인 중') + '</div></div>' +
    '<div><div class="lab">구매 완료</div><div class="v num">' + sm.done.length + '개</div><div class="s">' + (sm.paid ? man(sm.paid) + '원 결제' : '-') + '</div></div>' +
    '<div><div class="lab">후보</div><div class="v num">' + sm.cand.length + '개</div><div class="s">비교 중</div></div></div></div>';

  h += '<div class="seg pseg" id="bSeg"><button data-bview="list" class="' + (S.bview === 'list' ? 'on' : '') + '">살 것 목록</button>' +
    '<button data-bview="memo" class="' + (S.bview === 'memo' ? 'on' : '') + '">아이디어·메모' + (openM.length ? ' <b class="cnt">' + openM.length + '</b>' : '') + '</button></div>';

  if (S.bview === 'memo') h += bMemoView(memos);
  else h += bListView(sm.items, ev);
  const up = S.baby.meta && S.baby.meta.updated;
  h += '<div class="foot">가격은 매일 오전 9시에 맥이 확인해요' + (up ? ' · 마지막 ' + esc(ago(up)) : '') + '</div>';
  pg.innerHTML = h;
}

function bListView(items, ev) {
  const cats = bCats();
  const chips = [['all', '전체'], ['pick', '확정·완료']].concat(cats.map((c) => [c, c]));
  let h = '<div class="chips bchips">' + chips.map((c) => '<button class="chip' + (S.bcat === c[0] ? ' on' : '') + '" data-bcat="' + esc(c[0]) + '">' + esc(c[1]) + '</button>').join('') + '</div>';
  const rank = (i) => ({ '구매 확정': 0, '구매 완료': 1, '후보': 2, '보류': 3 }[i.status] ?? 2);
  let list = items.filter((i) => S.bcat === 'all' || (S.bcat === 'pick' ? (i.status === '구매 확정' || i.status === '구매 완료') : i.cat === S.bcat));
  list = list.slice().sort((a, b) => rank(a) - rank(b) || a.ord - b.ord);
  if (!list.length) h += '<div class="empty">여기에 해당하는 품목이 없어요</div>';
  const memos = (S.baby.memos || []);
  h += list.map((it) => bCard(it, memos.filter((m) => m.item === it.id).length)).join('');
  if (ev.length && S.bcat === 'all') {
    h += '<div class="card"><h3 class="sec">다가오는 행사 <small>싸게 살 기회</small></h3>' +
      ev.slice(0, 5).map((e) => '<div class="srow"><span>' + esc(e.name) + '</span><span class="r">' + esc(e.label) + ' · <b class="' + (e.dd <= 7 ? 'hot' : '') + '">' + e.tag + '</b></span></div>').join('') + '</div>';
  }
  h += '<button class="addrow" data-badd="item">+ 살 것 추가하기</button>';
  return h;
}

function bCard(it, nMemo) {
  const b = bBest(it), jp = bJp(it), chg = bChange(it);
  const cls = it.status === '구매 확정' ? ' conf' : it.status === '구매 완료' ? ' done' : it.status === '보류' ? ' hold' : '';
  const badge = it.status !== '후보' ? '<span class="bbadge' + cls + '">' + esc(it.status) + '</span>' : '';
  let pr;
  if (it.status === '구매 완료' && it.paid) pr = '<div class="bpr num">' + won(it.paid) + ' <span class="chg flat">결제</span></div>';
  else if (b) {
    let d = '';
    if (chg) d = '<span class="chg ' + (chg < 0 ? 'pdown' : 'pup') + '">' + (chg < 0 ? '▼' : '▲') + ' ' + num(Math.abs(chg)) + '</span>';
    else if (it.ref && b.p !== it.ref) { const pc = (b.p - it.ref) / it.ref * 100; d = '<span class="chg ' + (pc < 0 ? 'pdown' : 'pup') + '">기준가 대비 ' + (pc > 0 ? '+' : '') + pc.toFixed(1) + '%</span>'; }
    pr = '<div class="bpr num">' + won(b.p) + ' ' + d + '</div><div class="bsrc">' + esc(b.s) + ' · ' + esc(b.d.slice(5).replace('-', '/')) + (b.o ? '' : ' · <b class="warn">정품 미확인</b>') + '</div>';
  } else pr = '<div class="bpr na">가격 확인 전</div><div class="bsrc">다음 가격 확인 때 채워져요</div>';
  let h = '<div class="card bcard' + cls + '"><div class="btop" data-bitem="' + esc(it.id) + '">' + bImg(it, 'bph') +
    '<div class="bbody"><div class="bnm">' + badge + esc(it.name) + '</div>' + pr +
    (it.ref ? '<div class="bsrc">기준가 ' + won(it.ref) + '</div>' : '') +
    (it.note ? '<div class="bnote">' + esc(it.note) + '</div>' : '') +
    (nMemo ? '<div class="bsrc">메모 ' + nMemo + '개</div>' : '') + '</div></div>';
  h += bSpark(it.trend);
  if (jp) {
    const gap = b && jp.l ? b.p - jp.l : 0;
    h += '<div class="bjp">일본 최저 ' + esc(jp.s) + ' ' + (jp.jpy ? num(jp.jpy) + '엔' : '') + (jp.l ? ' · 배대지 포함 약 <b>' + won(jp.l) + '</b>' : '') +
      (gap > 0 ? ' · 한국보다 ' + man(gap) + '원 저렴' : '') + '</div>';
  }
  h += bShops(it);
  return h + '</div>';
}

function bShops(it) {
  const shops = it.shops || [];
  const by = {}; B_GROUPS.forEach((g) => { by[g] = []; });
  shops.forEach((e) => { const g = bGroup(e); (by[g] = by[g] || []).push(e); });
  let inner = '';
  Object.keys(by).forEach((g) => {
    const es = by[g].slice().sort((a, b) => (a.l || a.p) - (b.l || b.p));
    let li = es.map((e) => {
      const pr = (e.jpy ? num(e.jpy) + '엔 · 총 ' : '') + won(e.l || e.p);
      const nm = esc(e.s) + (e.o ? '' : ' <b class="warn">*</b>');
      return '<li><span class="sn">' + (e.u ? '<a href="' + esc(e.u) + '" target="_blank" rel="noopener">' + nm + ' ↗</a>' : nm) + '</span><span class="sp num">' + pr + '</span><span class="sd">' + esc(e.d.slice(5).replace('-', '/')) + '</span>' +
        (e.n ? '<span class="snote">' + esc(e.n) + '</span>' : '') + '</li>';
    }).join('');
    (it.ch || []).filter((c) => c.group === g).forEach((c) => {
      const key = String(c.name).split(' (')[0];
      if (es.some((e) => e.s.indexOf(key) >= 0 || String(c.name).indexOf(e.s) >= 0)) return;
      li += '<li class="nop"><span class="sn"><a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.name) + ' ↗</a></span><span class="sp na">미확인</span><span class="sd"></span></li>';
    });
    if (li) inner += '<div class="gt">' + esc(g) + '</div><ul>' + li + '</ul>';
  });
  if (!inner) return '';
  const kr = shops.filter((e) => e.m !== 'JP').map((e) => e.p);
  return '<details class="bshops" data-bshops="' + esc(it.id) + '"' + (S.bopen[it.id] ? ' open' : '') + '><summary>판매처별 현재가 (' + shops.length + '곳 확인' + (kr.length ? ' · 최저 ' + won(Math.min(...kr)) : '') + ')</summary>' +
    inner + '<div class="sh">이름을 누르면 판매처로 이동해요 · * 정품 판매처 여부 미확인</div></details>';
}

function bMemoView(memos) {
  const items = S.baby.items || [];
  const nameOf = (id) => { const i = items.find((x) => x.id === id); return i ? i.name : ''; };
  let h = '<div class="card compose"><textarea id="mTxt" rows="3" placeholder="떠오른 아이디어, 사고 싶은 것, 의견을 자유롭게 남겨요"></textarea>' +
    '<div class="crow"><span class="lab">' + esc(S.baby.me || '') + ' 이름으로 남겨요</span><button class="btn primary" id="mSend">남기기</button></div></div>';
  if (!memos.length) return h + '<div class="empty">아직 메모가 없어요. 첫 아이디어를 남겨보세요</div>';
  h += memos.map((m) => {
    const it = m.item ? nameOf(m.item) : '';
    const st = m.st === '반영됨' ? '<span class="tag auto">목록에 추가됨</span>' : m.st === '완료' ? '<span class="tag pl">완료</span>' : '';
    return '<div class="card memo' + (m.st !== '열림' ? ' closed' : '') + '"><div class="mh">' + bWhoChip(m.by) + '<span class="mt">' + esc(ago(m.at)) + '</span>' + st + '</div>' +
      '<div class="mx">' + esc(m.text).replace(/\n/g, '<br>') + '</div>' +
      (it ? '<div class="mi" data-bitem="' + esc(m.item) + '">관련: ' + esc(it) + ' ›</div>' : '') +
      '<div class="ma">' + (m.st === '열림' ? '<button class="btn" data-mact="add" data-mid="' + esc(m.id) + '">목록에 추가</button><button class="btn" data-mact="done" data-mid="' + esc(m.id) + '">완료</button>' :
        '<button class="btn" data-mact="open" data-mid="' + esc(m.id) + '">다시 열기</button>') +
      '<button class="btn ghost" data-mact="del" data-mid="' + esc(m.id) + '">삭제</button></div></div>';
  }).join('');
  return h;
}

/* 편집 창 */
function bItemSheet(id) {
  const it = (S.baby.items || []).find((x) => x.id === id); if (!it) return;
  const memos = (S.baby.memos || []).filter((m) => m.item === id);
  const st = { status: it.status, paid: it.paid, cat: it.cat };
  const cats = bCats(); if (cats.indexOf('기타') < 0) cats.push('기타');
  openSheet('<h2>' + esc(it.name) + '</h2>' +
    '<div class="fl">상태</div><div class="seg" id="iSt">' + B_STATUS.map((s) => '<button data-s="' + s + '" class="' + (st.status === s ? 'on' : '') + '">' + s + '</button>').join('') + '</div>' +
    '<div id="iPaidW"' + (st.status === '구매 완료' ? '' : ' hidden') + '><div class="fl">실제 결제 금액</div><input class="inp num" id="iPaid" inputmode="numeric" placeholder="₩0" value="' + (it.paid ? won(it.paid) : '') + '"></div>' +
    '<div class="fl">메모 · 의견 ' + (memos.length ? memos.length + '개' : '') + '</div>' +
    (memos.length ? '<div class="imemos">' + memos.map((m) => '<div class="im">' + bWhoChip(m.by) + '<span>' + esc(m.text) + '</span><span class="mt">' + esc(ago(m.at)) + '</span></div>').join('') + '</div>' : '') +
    '<div class="irow"><input class="inp" id="iMemo" placeholder="이 품목에 대한 의견 남기기"><button class="btn" id="iMemoBtn">남기기</button></div>' +
    '<details class="iedit"><summary>이름 · 카테고리 · 기준가 고치기</summary>' +
    '<div class="fl">이름</div><input class="inp" id="iName" value="' + esc(it.name) + '">' +
    '<div class="fl">카테고리</div><div class="wrapchips" id="iCat">' + cats.map((c) => '<button class="chip' + (c === st.cat ? ' on' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' +
    '<div class="fl">기준가</div><input class="inp num" id="iRef" inputmode="numeric" value="' + (it.ref ? won(it.ref) : '') + '" placeholder="비교 기준 가격 (선택)">' +
    '<div class="fl">설명</div><input class="inp" id="iNote" value="' + esc(it.note) + '" placeholder="색상, 구성 등 (선택)">' +
    '<div class="fl">판매처 링크 추가</div><input class="inp" id="iUrl" placeholder="https:// (선택)"></details>' +
    '<div class="sheet-acts"><button class="btn" id="iC">닫기</button><button class="btn primary" id="iS">저장</button></div>');
  const money = (el) => { el.oninput = () => { const s = el.value.replace(/[^\d]/g, ''); el.value = s ? won(Number(s)) : ''; }; };
  money($('iPaid')); money($('iRef'));
  $('iSt').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.status = b.dataset.s; [...$('iSt').children].forEach((x) => x.classList.toggle('on', x === b)); $('iPaidW').hidden = st.status !== '구매 완료'; };
  $('iCat').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.cat = b.dataset.c; [...$('iCat').children].forEach((x) => x.classList.toggle('on', x === b)); };
  $('iC').onclick = closeSheet;
  $('iMemoBtn').onclick = async () => {
    const t = $('iMemo').value.trim(); if (!t) return;
    $('iMemoBtn').disabled = true;
    try { await bWrite('babyAddMemo', [t, id], '메모를 남겼어요'); bItemSheet(id); } catch (e) { $('iMemoBtn').disabled = false; }
  };
  $('iS').onclick = async () => {
    const btn = $('iS'); btn.disabled = true; btn.textContent = '저장 중…';
    const v = (x) => { const s = $(x).value.replace(/[^\d]/g, ''); return s ? Number(s) : null; };
    try {
      const paid = st.status === '구매 완료' ? v('iPaid') : it.paid;
      if (st.status !== it.status || paid !== it.paid) await bWrite('babySetStatus', [id, st.status, paid == null ? '' : paid]);
      const f = {}, nm = $('iName').value.trim(), ref = v('iRef'), note = $('iNote').value.trim(), url = $('iUrl').value.trim();
      if (nm && nm !== it.name) f.name = nm;
      if (st.cat !== it.cat) f.cat = st.cat;
      if (ref !== it.ref) f.ref = ref == null ? '' : ref;
      if (note !== (it.note || '')) f.note = note;
      if (url) { if (!/^https?:\/\//.test(url)) { toast('링크는 https:// 로 시작해야 해요'); btn.disabled = false; btn.textContent = '저장'; return; } f.url = url; }
      if (Object.keys(f).length) await bWrite('babyEditItem', [id, f]);
      toast('저장했어요'); closeSheet();
    } catch (e) { btn.disabled = false; btn.textContent = '저장'; }
  };
}

function bAddSheet(pre) {
  pre = pre || {};
  const cats = bCats(); if (cats.indexOf('기타') < 0) cats.push('기타');
  const st = { cat: pre.cat || (S.bcat !== 'all' && S.bcat !== 'pick' ? S.bcat : '') };
  openSheet('<h2>살 것 추가</h2>' + (pre.memoText ? '<div class="lab" style="margin:-6px 0 10px">메모: ' + esc(pre.memoText.slice(0, 80)) + '</div>' : '') +
    '<div class="fl">이름</div><input class="inp" id="aName" placeholder="예: 젖병 소독기" value="' + esc(pre.name || '') + '">' +
    '<div class="fl">카테고리</div><div class="wrapchips" id="aCat">' + cats.map((c) => '<button class="chip' + (c === st.cat ? ' on' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>').join('') +
    '<button class="chip" data-new="1">+ 새 카테고리</button></div>' +
    '<input class="inp" id="aNewCat" placeholder="새 카테고리 이름 (예: 수유)" hidden style="margin-top:8px">' +
    '<div class="fl">기준가 (선택)</div><input class="inp num" id="aRef" inputmode="numeric" placeholder="₩0">' +
    '<div class="fl">참고 링크 (선택)</div><input class="inp" id="aUrl" placeholder="https://">' +
    '<div class="fl">설명 (선택)</div><input class="inp" id="aNote" placeholder="원하는 색상, 구성 등">' +
    '<div class="lab" style="margin-top:12px">추가하면 다음 날부터 매일 가격을 같이 확인해요</div>' +
    '<div class="sheet-acts"><button class="btn" id="aC">취소</button><button class="btn primary" id="aS">추가</button></div>');
  $('aRef').oninput = () => { const s = $('aRef').value.replace(/[^\d]/g, ''); $('aRef').value = s ? won(Number(s)) : ''; };
  $('aCat').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...$('aCat').children].forEach((x) => x.classList.toggle('on', x === b));
    if (b.dataset.new) { st.cat = ''; $('aNewCat').hidden = false; $('aNewCat').focus(); } else { st.cat = b.dataset.c; $('aNewCat').hidden = true; }
  };
  $('aC').onclick = closeSheet;
  $('aS').onclick = async () => {
    const name = $('aName').value.trim(); if (!name) { toast('이름을 적어주세요'); return; }
    const cat = st.cat || $('aNewCat').value.trim() || '기타';
    const url = $('aUrl').value.trim();
    if (url && !/^https?:\/\//.test(url)) { toast('링크는 https:// 로 시작해야 해요'); return; }
    const s = $('aRef').value.replace(/[^\d]/g, '');
    $('aS').disabled = true;
    try {
      await bWrite('babyAddItem', [{ name, cat, ref: s ? Number(s) : '', url, note: $('aNote').value.trim(), memo: pre.memo || '' }], '목록에 추가했어요');
      closeSheet(); S.bview = 'list'; S.bcat = 'all'; render();
    } catch (e) { $('aS').disabled = false; }
  };
  setTimeout(() => { if (!pre.name) $('aName').focus(); }, 300);
}

function bPlusSheet() {
  openSheet('<h2>무엇을 남길까요?</h2>' +
    '<button class="srow link big" id="pMemo"><span>아이디어 · 메모 남기기<br><small class="lab">사고 싶은 것, 의견, 떠오른 생각</small></span><span class="r"></span></button>' +
    '<button class="srow link big" id="pItem"><span>살 것 목록에 추가<br><small class="lab">매일 가격을 같이 확인해요</small></span><span class="r"></span></button>');
  $('pMemo').onclick = () => { closeSheet(); S.bview = 'memo'; render(); setTimeout(() => $('mTxt') && $('mTxt').focus(), 250); };
  $('pItem').onclick = () => { closeSheet(); setTimeout(() => bAddSheet(), 200); };
}

function dueSheet() {
  const cur = (S.baby && S.baby.meta && S.baby.meta.dueDate) || '';
  openSheet('<h2>출산 예정일</h2><div class="lab" style="margin:-6px 0 10px">홈과 출산준비 탭에 D-day와 임신 주수가 보여요</div>' +
    '<input class="inp" id="dD" type="date" value="' + esc(cur) + '">' +
    '<div class="sheet-acts"><button class="btn" id="dC">취소</button><button class="btn primary" id="dS">저장</button></div>');
  $('dC').onclick = closeSheet;
  $('dS').onclick = async () => { $('dS').disabled = true; try { await bWrite('babySetMeta', [{ dueDate: $('dD').value }], '저장했어요'); closeSheet(); if (S.tab === 'set') render(); } catch (e) { $('dS').disabled = false; } };
}

async function bMemoAct(act, id) {
  const m = (S.baby.memos || []).find((x) => x.id === id); if (!m) return;
  if (act === 'add') { bAddSheet({ memo: id, memoText: m.text, name: m.text.split('\n')[0].slice(0, 40) }); return; }
  if (act === 'del' && !confirm('이 메모를 지울까요?')) return;
  const st = { done: '완료', open: '열림', del: '삭제' }[act];
  await bWrite('babyMemoSet', [id, st], act === 'del' ? '지웠어요' : act === 'done' ? '완료로 표시했어요' : '다시 열었어요');
}

/* ────────── 이벤트 ────────── */
function findRow(row) { return S.data && S.data.rows.find((r) => r.row === Number(row)); }
function go(tab) {
  S.tab = tab;
  document.querySelectorAll('.pg').forEach((p) => p.classList.toggle('on', p.dataset.p === tab));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.t === tab));
  window.scrollTo(0, 0);
  render();
  if (tab === 'baby' || tab === 'home') loadBaby();
}

function bind() {
  $('tabs').onclick = (e) => { const t = e.target.closest('.tab'); if (t) { haptic(); go(t.dataset.t); } };
  $('prev').onclick = () => loadMonth(ymShift(S.ym, -1));
  $('next').onclick = () => loadMonth(ymShift(S.ym, 1));
  $('refresh').onclick = () => { S.err = ''; if (S.tab === 'baby') loadBaby(true); else { loadMonth(S.ym, true); if (S.tab === 'home') loadBaby(true); } };
  $('addBtn').onclick = () => (S.tab === 'baby' ? bPlusSheet() : txSheet(null));
  $('ledSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.led = b.dataset.led; window.scrollTo(0, 0); renderLedger(); };
  document.addEventListener('toggle', (e) => { const t = e.target; if (t.dataset && t.dataset.bshops) S.bopen[t.dataset.bshops] = t.open; }, true);
  $('scrim').onclick = closeSheet;
  $('q').oninput = () => { S.q = $('q').value; renderTx(); };
  $('txChips').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; S.filter = b.dataset.f; S.cat = ''; renderTx(); };
  document.addEventListener('click', async (e) => {
    if (e.target.closest('a,summary')) return;
    if (e.target.id === 'mSend') {
      const t = $('mTxt').value.trim(); if (!t) { toast('내용을 적어주세요'); return; }
      e.target.disabled = true;
      try { await bWrite('babyAddMemo', [t, ''], '메모를 남겼어요'); } catch (err) { e.target.disabled = false; }
      return;
    }
    const el = e.target.closest('[data-ok],[data-edit],[data-cat],[data-go],[data-ym],[data-asset],[data-set],[data-led],[data-bview],[data-bcat],[data-bitem],[data-mact],[data-badd]');
    if (!el || el.closest('#sheet')) return;
    if (el.dataset.led) { S.led = el.dataset.led; window.scrollTo(0, 0); renderLedger(); return; }
    if (el.dataset.bview) { S.bview = el.dataset.bview; render(); return; }
    if (el.dataset.bcat) { S.bcat = el.dataset.bcat; render(); return; }
    if (el.dataset.bitem) { bItemSheet(el.dataset.bitem); return; }
    if (el.dataset.mact) { bMemoAct(el.dataset.mact, el.dataset.mid); return; }
    if (el.dataset.badd) { bAddSheet(); return; }
    if (el.dataset.set === 'due') { dueSheet(); return; }
    if (el.dataset.go === 'txrev') { S.led = 'list'; S.filter = 'review'; S.cat = ''; go('tx'); return; }
    if (el.dataset.go && el.dataset.led2) { S.led = el.dataset.led2; }
    if (el.dataset.go && el.dataset.bv) { S.bview = el.dataset.bv; }
    if (el.dataset.ok) { el.disabled = true; await write('confirmTx', [S.ym, Number(el.dataset.ok)], '확인했어요 · 다음부터 자동 분류'); return; }
    if (el.dataset.edit) { const r = findRow(el.dataset.edit); if (r) txSheet(r); return; }
    if (el.dataset.cat) { S.cat = el.dataset.cat; S.filter = 'all'; S.led = 'list'; go('tx'); return; }
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
    if (el.dataset.set === 'logout') { if (confirm('이 기기에서 로그아웃할까요? 다시 쓰려면 Google 계정으로 로그인하면 돼요.')) disconnect(''); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !S.key) { $('gBtn').disabled = false; claimLogin(); }
    if (document.visibilityState === 'visible' && S.key && S.ym && (!S.fetchedAt[S.ym] || Date.now() - S.fetchedAt[S.ym] > 60000)) loadMonth(S.ym, true);
    if (document.visibilityState === 'visible' && S.key) loadBaby();
  });
  window.addEventListener('online', () => { S.err = ''; loadMonth(S.ym, true); });
  $('gBtn').onclick = googleLogin;
  $('keyBtn').onclick = () => connect($('keyIn').value);
  $('keyIn').onkeydown = (e) => { if (e.key === 'Enter') connect($('keyIn').value); };
}

/* ────────── 연결 ────────── */
async function connect(k, how) {
  k = String(k || '').trim();
  if (!/^gb_[0-9a-f]{20,}$/.test(k)) { $('keyErr').textContent = '연결 코드 형식이 아니에요.'; return; }
  $('keyBtn').disabled = true; $('gBtn').disabled = true; $('keyErr').textContent = '';
  S.key = k;
  try {
    const d = await api('boot', S.ym);
    saveKey(k);
    S.cfg = d.config; writeJ('gb.cfg', d.config);
    $('connect').hidden = true;
    applyMonth(d.month);
    loadBaby(true);
    toast(how === 'google' ? (S.user ? S.user + ' 계정으로 로그인했어요' : '로그인했어요') : '연결됐어요');
  } catch (e) { $('keyErr').textContent = e.message === 'unauthorized' ? '연결 코드가 맞지 않아요.' : e.message; S.key = ''; }
  finally { $('keyBtn').disabled = false; $('gBtn').disabled = false; }
}

/* ────────── Google 로그인 ──────────
   구글 로그인 화면으로 갔다가 돌아오면 주소 뒤(#)에 로그인 증명(id_token)이 붙어 와요.
   서버가 그걸 구글에 다시 확인하고 허용된 계정이면 연결 코드를 줘요.
   아이폰 홈 화면 앱에서 로그인이 사파리로 넘어가 끝나도, 앱으로 돌아오면 state 값으로 결과를 찾아와요. */
function rnd16() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => ('0' + b.toString(16)).slice(-2)).join(''); }
function pendingLogin() { const o = readJ('gb.oauth'); return o && Date.now() - o.t < 10 * 60000 ? o : null; }
function googleLogin() {
  const o = { st: rnd16(), nonce: rnd16(), t: Date.now() };
  writeJ('gb.oauth', o);
  const q = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'id_token',
    scope: 'openid email', nonce: o.nonce, state: o.st, prompt: 'select_account' });
  $('gBtn').disabled = true;
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
}
async function post(body) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
  return r.json();
}
async function finishLogin(hp) {
  const mine = readJ('gb.oauth');
  const st = hp.get('state') || '';
  const err = hp.get('error');
  $('connect').hidden = false;
  if (err) { localStorage.removeItem('gb.oauth'); $('keyErr').textContent = err === 'access_denied' ? '로그인을 취소했어요.' : '로그인하지 못했어요 (' + err + ')'; return; }
  if (mine && mine.st !== st) { $('keyErr').textContent = '로그인 정보가 맞지 않아요. 다시 시도해 주세요.'; return; }
  $('gBtn').disabled = true; $('keyErr').textContent = '로그인 확인 중…';
  try {
    const j = await post({ action: 'login', idToken: hp.get('id_token'), nonce: mine ? mine.nonce : '', state: st });
    localStorage.removeItem('gb.oauth');
    if (!j.ok) {
      $('keyErr').textContent = j.error === 'not_allowed' ? (j.email || '이 계정') + '은 등록된 계정이 아니에요.' : '로그인을 확인하지 못했어요. 다시 시도해 주세요.';
      return;
    }
    S.user = j.user; localStorage.setItem('gb.user', j.user);
    await connect(j.key, 'google');
    // 홈 화면 앱에서 시작한 로그인이 사파리에서 끝난 경우 안내
    if (!mine && !matchMedia('(display-mode: standalone)').matches && !navigator.standalone) toast('홈 화면 앱으로 돌아가면 자동으로 연결돼요');
  } catch (e) { $('keyErr').textContent = '연결이 원활하지 않아요. 다시 시도해 주세요.'; }
  finally { $('gBtn').disabled = false; }
}
/* 사파리에서 끝난 로그인 결과 찾아오기 */
let claimBusy = false;
async function claimLogin() {
  const o = pendingLogin();
  if (!o || S.key || claimBusy) return;
  claimBusy = true;
  try {
    const j = await post({ action: 'claim', state: o.st });
    if (j.ok) { localStorage.removeItem('gb.oauth'); S.user = j.user; localStorage.setItem('gb.user', j.user); await connect(j.key, 'google'); }
  } catch (e) { /* 다음에 다시 시도 */ }
  finally { claimBusy = false; }
}
function disconnect(msg) {
  clearKey(); localStorage.removeItem('gb.user');
  Object.keys(localStorage).filter((k) => k.indexOf('gb.m.') === 0 || k === 'gb.cfg' || k === 'gb.baby').forEach((k) => localStorage.removeItem(k));
  S.key = ''; S.data = null; S.user = ''; S.baby = null; S.babyAt = 0;
  $('keyErr').textContent = msg || '';
  $('connect').hidden = false;
}

/* ────────── 시작 ────────── */
(function start() {
  const m = location.hash.match(/k=(gb_[0-9a-f]+)/);
  if (m) { S.key = m[1]; saveKey(m[1]); history.replaceState(null, '', location.pathname + location.search); }
  const hp = new URLSearchParams(location.hash.slice(1));
  const oauth = hp.has('id_token') || hp.has('error');
  if (oauth) history.replaceState(null, '', location.pathname + location.search);
  S.ym = ymOf(new Date());
  bind();
  if (oauth && hp.get('state')) { render(); finishLogin(hp); return; }
  if (!S.key) {
    $('connect').hidden = false; render();
    if (pendingLogin()) { claimLogin(); setInterval(() => { if (!S.key && document.visibilityState === 'visible') claimLogin(); }, 4000); }
    return;
  }
  if (!readCookie('gb_key')) saveKey(S.key);
  S.data = readJ('gb.m.' + S.ym);
  render();
  boot();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 캐시는 선택 기능 */ });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && S.loading === 0) { reloaded = true; location.reload(); } });
  }
})();
