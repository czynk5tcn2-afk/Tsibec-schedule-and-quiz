/* 复习资料页（r12 起）
   数据：/study-data/index.json 和每科一个 JSON（由项目文件夹 tools/build-study.js 生成，不要手改）。
   做题记录、错题、背会的题只存在本机 localStorage（study:prefs、study:<科目>、study:<科目>:exam），读写都包 try/catch。
   离线包：同学同意后才通知 sw.js 缓存本页和全部数据（STUDY_OFFLINE 消息）。 */
(() => {
  'use strict';
  const V = document.documentElement.dataset.v || '';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const L5 = 'ABCDE';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const icon = (id, extra = '') => `<svg class="i" ${extra}><use href="#i-${id}"/></svg>`;
  const plain = html => String(html).replace(/<[^>]+>/g, '');
  // ── 改成你自己的 ──
  const AUTHOR = '小克';            // 页面上署名的整理者
  const CONTACT = '告诉整理题目的人'; // 发现问题时找谁
  const NYA = '/study-img/nya-cry.jpg'; // “整理中”科目点开时的哭哭图（网络表情包）

  /* ───── 本机存储（失败时静默降级） ───── */
  let storeWarned = false;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; }
      catch (_) {
        // 浏览器不让存（无痕模式、空间满了）：每次打开页面只提醒一次
        if (!storeWarned) { storeWarned = true; setTimeout(() => toast('这次的做题记录没保存成功 😢 可能是无痕模式或手机空间满了，刷新后会丢。', { ms: 6000 }), 0); }
        return false;
      }
    },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} },
  };
  const prefs = Object.assign({ welcomed: false, offline: '', offlineV: '', big: false }, store.get('study:prefs', {}));
  const savePrefs = () => store.set('study:prefs', prefs);
  const progressKey = slug => 'study:' + slug;
  // fav / mem：考点卡收藏、记住了（r16，存卡片键 “章:编号”）
  // due / log：错题复习安排、每天的刷题记录（r20，见下面“错题隔天再出”“每天的记录”）
  const loadProgress = slug => {
    const p = Object.assign({ a: {}, h: [], best: 0, wrong: [], got: [], tab: 0, last: '', f: null, exam: null, fav: [], mem: [], due: {}, log: {} }, store.get(progressKey(slug), {}));
    for (const id of p.wrong) if (!p.due[id]) p.due[id] = [0, 0]; // r20 以前的错题：今天就能复习
    return p;
  };

  /* ───── 日子怎么算（r20）：凌晨 4 点前还算前一天，熬夜刷的题记在当天 ───── */
  const SHIFT = 4 * 3600e3;
  const pad2 = n => String(n).padStart(2, '0');
  function dayBase(t = Date.now()) { const d = new Date(t - SHIFT); d.setHours(0, 0, 0, 0); return d; }
  const fmtDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const dayKey = t => fmtDay(dayBase(t));
  const inDays = n => { const d = dayBase(); d.setDate(d.getDate() + n); return d.getTime() + SHIFT; };

  /* ───── 错题隔天再出（r20）：做错的题第二天出现在“今日复习”；复习时答对，再隔 3 天、7 天各出一次，都对就毕业。
     复习时又错了，从头来（明天再出）。due[题号] = [第几轮, 哪天起该复习]。 ───── */
  const GAPS = [1, 3, 7];
  const isDue = (p, id) => !!p.due[id] && p.due[id][1] <= Date.now();
  function schedWrong(p, id) { p.due[id] = [0, inDays(1)]; }
  function schedRight(p, id) {
    if (!isDue(p, id)) return; // 还没到复习的日子，先不动
    const st = p.due[id][0] + 1;
    if (st >= GAPS.length) delete p.due[id]; else p.due[id] = [st, inDays(GAPS[st])];
  }
  const dueIds = (p, qMap) => Object.keys(p.due).filter(id => isDue(p, id) && (!qMap || (qMap[id] && qMap[id].st !== 'stop')));

  /* ───── 每天的记录（r20）：log[日期] = { n 做题, r 答对, rv 复习过关, mem 记住的卡, got 背会的主观题, ex 模拟卷 [得分, 满分] }，留 60 天 ───── */
  function logDay(p, k, by = 1) {
    const key = dayKey(), L = p.log[key] || (p.log[key] = {});
    L[k] = Math.max(0, (L[k] || 0) + by);
    const keys = Object.keys(p.log).sort(); while (keys.length > 60) delete p.log[keys.shift()];
  }

  /* ───── 全局浮层 ───── */
  document.body.insertAdjacentHTML('beforeend', `
    <div class="scrim" id="scrim"></div>
    <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"></div>
    <div class="verdict" id="verdict" role="status" aria-live="polite"><div class="wrap" id="verdictIn"></div></div>
    <div class="exam" id="exam" role="dialog" aria-modal="true" aria-label="自主期末测试"></div>
    <div class="cheer" id="cheer" role="dialog" aria-modal="true" aria-labelledby="cheerT"><div class="cheer-card" id="cheerCard">
      <div class="cheer-big num" id="cheerBig"></div><h2 id="cheerT"></h2><p id="cheerP"></p>
      <button class="btn btn-b" type="button" id="cheerOk">继续冲</button></div></div>
    <div class="toast" id="toast" role="status"><span id="toastText"></span><button type="button" id="toastBtn" hidden></button></div>
    <div class="confetti" id="confetti" aria-hidden="true"></div>
    <button class="to-top" id="toTop" type="button" aria-label="回到顶部" hidden>${icon('up')}</button>`);
  if (prefs.big) document.body.classList.add('big');

  const scrim = $('#scrim'), sheet = $('#sheet');

  /* 手机返回键：弹层、测试、庆祝卡打开时占一条历史记录，按返回先关它们，不直接退出这一科（r15） */
  let ignorePop = false;
  const anyLayer = () => sheet.classList.contains('on') || $('#exam').classList.contains('on') || $('#cheer').classList.contains('on');
  function pushLayer() { if (!history.state?.studyLayer) try { history.pushState({ studyLayer: 1 }, ''); } catch (_) {} }
  // 稍等一拍再退：关一个弹层紧接着开另一个时（比如“接着做”），共用同一条记录
  // ignorePop 为真表示已经在退了，同一拍里关两个弹层（先离开测试）不会退两次
  function releaseLayer() { setTimeout(() => { if (!ignorePop && !anyLayer() && history.state?.studyLayer) { ignorePop = true; history.back(); } }, 0); }
  addEventListener('popstate', () => {
    if (ignorePop) { ignorePop = false; return; }
    if ($('#cheer').classList.contains('on')) closeCheer();
    else if (sheet.classList.contains('on')) closeSheet();
    else if ($('#exam').classList.contains('on')) askLeaveExam();
    if (anyLayer()) pushLayer();
  });

  let sheetClose = null;
  function openSheet(html, onClose) {
    pushLayer();
    sheet.onclick = null; // 上一个弹层挂的点击处理（比如弱项表）不留到下一个
    sheet.innerHTML = '<div class="grip"></div><button class="sheet-x" type="button" data-close aria-label="关闭">' + icon('x') + '</button>' + html;
    scrim.classList.add('on'); sheet.classList.add('on'); sheet.scrollTop = 0;
    sheetClose = onClose || null;
    setTimeout(() => (sheet.querySelector('[data-focus]') || sheet.querySelector('button'))?.focus({ preventScroll: true }), 60);
  }
  function closeSheet() {
    if (!sheet.classList.contains('on')) return;
    scrim.classList.remove('on'); sheet.classList.remove('on');
    const f = sheetClose; sheetClose = null; f && f();
    releaseLayer();
  }
  scrim.addEventListener('click', closeSheet);
  sheet.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('#cheer').classList.contains('on')) closeCheer(); else closeSheet(); } });

  let toastTimer;
  function toast(text, opt = {}) {
    const t = $('#toast'), b = $('#toastBtn');
    $('#toastText').textContent = text;
    t.classList.toggle('y', !!opt.y);
    t.classList.toggle('bt', !!opt.bottom);
    if (opt.action) { b.hidden = false; b.textContent = opt.action[0]; b.onclick = () => { t.classList.remove('on'); opt.action[1](); }; }
    else { b.hidden = false; b.textContent = '知道了'; b.onclick = () => t.classList.remove('on'); }
    t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), opt.ms || 3200);
  }

  const COLS = ['#FFD43B', '#FF6B6B', '#38D9A9', '#4DABF7', '#9775FA', '#FF9F43'];
  const GOLD = ['#FFD43B', '#F0B000', '#FFE066', '#FCC419', '#FFF3BF'];
  function confetti(x, y, n, spread, cols = COLS) {
    if (calm) return;
    const host = $('#confetti');
    for (let k = 0; k < n; k++) {
      const i = document.createElement('i'), big = Math.random() < .3;
      i.style.cssText = `--x0:${x}px;--y0:${y}px;--w:${big ? 12 : 8}px;--h:${big ? 8 : 12}px;--col:${cols[k % cols.length]};` +
        `--dx:${(Math.random() - .5) * spread}px;--up:${-80 - Math.random() * 160}px;--down:${innerHeight * .7 + Math.random() * 200}px;` +
        `--r:${(Math.random() - .5) * 900}deg;--d:${1.1 + Math.random() * .9}s`;
      if (Math.random() < .35) i.style.borderRadius = '50%';
      host.append(i); setTimeout(() => i.remove(), 2200);
    }
  }
  const rain = (cols) => { for (let k = 0; k < 6; k++) setTimeout(() => confetti(innerWidth * (.1 + .8 * Math.random()), -10, 18, 300, cols), k * 120); };
  const cheer = $('#cheer');
  function showCheer(big, title, text, c1 = 'var(--y)', c2 = 'var(--c)', party = true, btn = '继续冲 🚀') {
    $('#cheerBig').innerHTML = big; $('#cheerT').textContent = title; $('#cheerP').textContent = text; $('#cheerOk').textContent = btn;
    const card = $('#cheerCard'); card.style.setProperty('--cc', c1); card.style.setProperty('--cc2', c2);
    cheer.classList.add('on'); pushLayer(); if (party) rain();
    setTimeout(() => $('#cheerOk').focus({ preventScroll: true }), 80);
  }
  function closeCheer() { if (!cheer.classList.contains('on')) return; cheer.classList.remove('on'); releaseLayer(); }
  $('#cheerOk').onclick = closeCheer;
  cheer.addEventListener('click', e => { if (e.target === cheer) closeCheer(); });

  // 回到顶部
  const toTop = $('#toTop');
  toTop.onclick = () => scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
  addEventListener('scroll', () => {
    toTop.hidden = scrollY < 1400;
    const bar = $('#bar'); if (bar) bar.classList.toggle('stuck', bar.getBoundingClientRect().top <= 0 && scrollY > 0);
  }, { passive: true });

  /* ───── 数据 ───── */
  const cache = {};
  async function getJSON(path) {
    if (cache[path]) return cache[path];
    const res = await fetch(`${path}?v=${encodeURIComponent(V)}`);
    if (!res.ok) throw new Error(res.status);
    return (cache[path] = await res.json());
  }
  const app = $('#app');
  let INDEX = null;

  /* ───── 欢迎和免责声明 ───── */
  // 离线包大小：各科数据加起来，再加页面本身约 0.1 MB，四舍五入到整数 MB
  const offlineSize = () => {
    const b = (INDEX?.subjects || []).reduce((n, x) => n + (x.size || 0), 0);
    return b ? `约 ${Math.max(1, Math.round(b / 1e6 + .1))} MB` : '几 MB 左右';
  };
  const DISCLAIMER = `<div class="fine"><b>先说清楚几件事：</b><ol>
    <li>网站和题目都由<b>${AUTHOR}</b>整理，仅供参考，不是老师出的题。</li>
    <li>题目大多是往届同学回忆的，答案是资料整理的，<b>不是官方答案</b>，可能有错字、缺选项或答案不对。拿不准的以课件和老师的说法为准；题目旁边的“看条件”“未核实”“不计分”标签就是在提醒你。</li>
    <li>发现题目或答案有问题，或者有什么建议，<b>${CONTACT}</b>就行。</li>
    <li>做题记录只存在你这台手机上，别人看不到；换手机或清理浏览器数据会清空。</li></ol></div>`;
  function showWelcome(first) {
    const canOffline = 'serviceWorker' in navigator && prefs.offline !== 'yes';
    openSheet(`<div class="art"><i></i><i></i><i></i></div>
      <h2 id="sheetTitle">${first ? '嗨，欢迎来刷题！(ﾉ≧∀≦)ﾉ' : '关于这些资料 📒'}</h2>
      <p>这里有${(INDEX?.subjects || []).filter(x => !x.pending).map(x => x.name).join('、')}的考点卡、往届题和模拟卷，手机上随时刷 📱${(INDEX?.subjects || []).some(x => x.pending) ? ` ${(INDEX?.subjects || []).filter(x => x.pending).map(x => x.name).join('、')}还在路上，等着吧喵 🐱` : ''}</p>
      ${DISCLAIMER}
      ${first && canOffline ? `<p>顺手下个离线包？下好以后没网也能刷（${offlineSize()}）✈️</p>` : ''}
      <div class="acts">${first && canOffline
        ? `<button class="btn btn-b" type="button" id="wOff" data-focus>下载离线包，开刷 🚀</button><button class="btn btn-ghost" type="button" id="wGo">先不下载，直接开刷</button>`
        : `<button class="btn btn-b" type="button" data-close data-focus>知道啦 👌</button>`}</div>`,
      () => { if (!prefs.welcomed) { prefs.welcomed = true; savePrefs(); } });
    $('#wOff')?.addEventListener('click', () => { prefs.welcomed = true; savePrefs(); closeSheet(); enableOffline(); });
    $('#wGo')?.addEventListener('click', () => { prefs.welcomed = true; if (!prefs.offline) prefs.offline = 'no'; savePrefs(); closeSheet(); toast('好嘞～想要离线包的话，页面最下面随时能下 (｡•̀ᴗ-)✧', { ms: 3600, bottom: true }); });
  }

  /* ───── 离线包 ───── */
  function offlineUrls() {
    const v = encodeURIComponent(V);
    return ['/study', `/study.css?v=${v}`, `/study.js?v=${v}`, `/study-data/index.json?v=${v}`,
      ...(INDEX?.subjects || []).filter(s => !s.pending).map(s => `/study-data/${s.slug}.json?v=${v}`),
      '/icons/favicon-v3.svg', NYA];
  }
  async function swPost(msg) {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const sw = reg.active || (await navigator.serviceWorker.ready).active;
    return new Promise((resolve, reject) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => reject(new Error('timeout')), 60000);
      ch.port1.onmessage = e => { clearTimeout(t); e.data?.ok ? resolve(e.data) : reject(new Error(e.data?.error || 'fail')); };
      sw.postMessage(msg, [ch.port2]);
    });
  }
  async function enableOffline(quiet) {
    if (!('serviceWorker' in navigator)) { toast('这个浏览器不支持离线包 (´･_･｀) 换 Safari 或 Chrome 试试。'); return; }
    if (!quiet) toast('离线包下载中，别关页面哦… ⏳', { ms: 20000 });
    try {
      await swPost({ type: 'STUDY_OFFLINE', urls: offlineUrls() });
      prefs.offline = 'yes'; prefs.offlineV = V; savePrefs();
      if (!quiet) toast('离线包下好了！没网也能刷 ✌️', { y: true });
      refreshFoot();
    } catch (_) {
      if (!quiet) toast('离线包没下成功 (｡•́︿•̀｡) 可能网不太好，等会儿在页面最下面再点一次。', { ms: 4200 });
    }
  }
  async function disableOffline() {
    try { await swPost({ type: 'STUDY_OFFLINE_OFF' }); } catch (_) {}
    prefs.offline = 'no'; savePrefs(); refreshFoot(); toast('离线包删掉了，手机空间回来了一点 🧹');
  }

  /* ───── 页脚 ───── */
  let xkTaps = 0, xkTimer;
  function footHTML(slug) {
    return `<footer class="foot" id="foot">
      <span class="who" id="who">网站和题目都由${AUTHOR}整理，仅供参考 🙏</span>答案不是官方的，可能有错，以课件和老师的说法为准。发现问题，${CONTACT}就行。
      <div class="tools">
        <button type="button" id="fAbout">关于这些资料</button>
        ${'serviceWorker' in navigator ? `<button type="button" id="fOff"></button>` : ''}
        <button type="button" id="fBig"></button>
        <button type="button" id="fExport">导出做题记录</button>
        <button type="button" id="fImport">导入记录</button>
        ${slug ? `<button type="button" id="fReset">清空这科的记录</button>` : ''}
      </div></footer>`;
  }
  function refreshFoot() {
    const o = $('#fOff'); if (o) o.textContent = prefs.offline === 'yes' ? '离线包：已下好 ✅（点我删除）' : `下载离线包（${offlineSize()}）`;
    const b = $('#fBig'); if (b) b.textContent = prefs.big ? '字号：大 🔍' : '字号：标准';
  }
  function bindFoot(slug) {
    refreshFoot();
    $('#fAbout').onclick = () => showWelcome(false);
    $('#fExport').onclick = showExport;
    $('#fImport').onclick = showImport;
    const o = $('#fOff');
    if (o) o.onclick = () => {
      if (prefs.offline !== 'yes') { enableOffline(); return; }
      openSheet(`<h2 id="sheetTitle">真要删掉离线包吗？🥺</h2><p>删掉以后没网就打不开这里了，做题记录不受影响。</p><div class="acts"><button class="btn btn-c" type="button" id="offDel">删掉</button><button class="btn btn-ghost" type="button" data-close data-focus>留着留着</button></div>`);
      $('#offDel').onclick = () => { closeSheet(); disableOffline(); };
    };
    $('#fBig').onclick = () => { prefs.big = !prefs.big; savePrefs(); document.body.classList.toggle('big', prefs.big); refreshFoot(); toast(prefs.big ? '字号调大了，眼睛舒服点 👀' : '字号恢复标准啦'); };
    const r = $('#fReset'); if (r) r.onclick = () => {
      openSheet(`<h2 id="sheetTitle">清空这科的做题记录？😱</h2><p>已做的题、错题本、背会的标记、连对纪录都会清空，没法恢复。</p><div class="acts"><button class="btn btn-c" type="button" id="doReset">清空，从头再来</button><button class="btn btn-ghost" type="button" data-close data-focus>手滑了，不清 🙈</button></div>`);
      $('#doReset').onclick = () => { store.del(progressKey(slug)); store.del(progressKey(slug) + ':exam'); closeSheet(); toast('清空了，一切从零开始 (ง •̀_•́)ง'); renderSubject(slug, true); };
    };
    $('#who').onclick = () => {
      xkTaps++; clearTimeout(xkTimer); xkTimer = setTimeout(() => xkTaps = 0, 2500);
      if (xkTaps >= 5) { xkTaps = 0; showCheer('🍀', `${AUTHOR}祝你逢考必过`, '会的全对，蒙的也对 (๑•̀ㅂ•́)و✧ 考完记得回来报喜！', 'var(--m)', 'var(--y)', true, '借你吉言'); }
    };
  }

  /* ───── 导出 / 导入做题记录（r20）：换手机、清浏览器前先导出。
     存成文件，或者复制成一段文字（微信里存不了文件，就发到“文件传输助手”）。
     导入时只认 study:<科目>、study:<科目>:exam 这两种键，导入的科目整科替换本机记录。 ───── */
  const PACK = 'skauramaemma-study';
  const inWeChat = /MicroMessenger/i.test(navigator.userAgent);
  const okKey = k => { const m = /^study:([a-z]+)(:exam)?$/.exec(k); return !!m && (INDEX?.subjects || []).some(x => x.slug === m[1] && !x.pending); };
  function packData() {
    const data = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && okKey(k)) { const v = JSON.parse(localStorage.getItem(k)); if (v && typeof v === 'object') data[k] = v; }
      }
    } catch (_) {}
    return data;
  }
  // 每科一句：做了几道题、几道错题
  function packSummary(data) {
    return (INDEX?.subjects || []).filter(x => data['study:' + x.slug] || data['study:' + x.slug + ':exam']).map(x => {
      const p = data['study:' + x.slug] || {};
      const n = Object.keys(p.a || {}).length, w = (p.wrong || []).length;
      return `${x.name}：做了 ${n} 道${w ? `，错题 ${w} 道` : ''}${data['study:' + x.slug + ':exam'] ? '，有模拟卷记录' : ''}`;
    });
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {
      try { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.append(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch (_) { return false; }
    }
  }
  function showExport() {
    const data = packData(), sum = packSummary(data);
    if (!sum.length) { toast('还没有做题记录可以导出 (・_・;) 先去刷几道吧。'); return; }
    const text = JSON.stringify({ app: PACK, ver: 1, at: Date.now(), site: V, data });
    const name = `复习记录-${dayKey().replace(/-/g, '')}.json`;
    openSheet(`<h2 id="sheetTitle">导出做题记录 📦</h2>
      <p>换手机、清理浏览器之前先导出一份，到新手机上点“导入记录”就能接着刷。</p>
      <div class="fine"><b>这次会导出：</b><ul class="sum">${sum.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      ${inWeChat ? '<p class="tip">在微信里打开的话存不了文件，用“复制成文字”，发给自己的“文件传输助手”存着。</p>' : ''}
      <div class="acts">
        <button class="btn btn-b" type="button" id="exFile" data-focus>存成文件</button>
        <button class="btn btn-ghost" type="button" id="exCopy">复制成文字（${Math.max(1, Math.round(text.length / 1024))} KB）</button>
      </div>`);
    $('#exFile').onclick = async () => {
      const blob = new Blob([text], { type: 'application/json' });
      // 手机上优先用系统分享（能直接存到“文件”或发微信），不行再走下载
      try {
        const file = new File([blob], name, { type: 'application/json' });
        if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); closeSheet(); toast('导出好了 📦', { y: true }); return; }
      } catch (e) { if (e?.name === 'AbortError') return; }
      try {
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        closeSheet(); toast(`存好了：${name} 📦 在下载文件夹里找。`, { y: true, ms: 4200 });
      } catch (_) { toast('存文件没成功 (｡•́︿•̀｡) 试试“复制成文字”。', { ms: 4200 }); }
    };
    $('#exCopy').onclick = async () => {
      if (await copyText(text)) { closeSheet(); toast('复制好了 📋 粘贴到备忘录或微信“文件传输助手”存着，导入时整段粘回来。', { y: true, ms: 5200 }); }
      else toast('没复制成功 (｡•́︿•̀｡) 试试“存成文件”。', { ms: 4200 });
    };
  }
  function showImport() {
    openSheet(`<h2 id="sheetTitle">导入做题记录 📥</h2>
      <p>选之前导出的文件，或者把复制的那段文字粘贴到下面。</p>
      <div class="acts"><label class="btn btn-b file-btn">选文件<input type="file" id="imFile" accept=".json,application/json,text/plain"></label></div>
      <textarea class="paste" id="imText" rows="4" placeholder="或者把复制的文字粘贴到这里" aria-label="粘贴导出的文字"></textarea>
      <div class="acts"><button class="btn btn-ghost" type="button" id="imGo">导入粘贴的文字</button></div>`);
    $('#imFile').onchange = async e => {
      const f = e.target.files?.[0]; if (!f) return;
      try { readPack(await f.text()); } catch (_) { toast('这个文件读不出来 (・_・;)'); }
    };
    $('#imGo').onclick = () => { const t = $('#imText').value.trim(); if (!t) { toast('先粘贴导出的那段文字 📋'); return; } readPack(t); };
  }
  function readPack(text) {
    let pack;
    try { pack = JSON.parse(text); } catch (_) { toast('这不像是导出的记录 (・_・;) 文字要整段复制，别漏了开头结尾。', { ms: 4200 }); return; }
    const data = {};
    if (pack && pack.app === PACK && pack.data && typeof pack.data === 'object')
      for (const [k, v] of Object.entries(pack.data)) if (okKey(k) && v && typeof v === 'object' && !Array.isArray(v)) data[k] = v;
    const sum = packSummary(data);
    if (!sum.length) { toast('这份记录里没有能导入的科目 (・_・;)', { ms: 3600 }); return; }
    const when = pack.at ? new Date(pack.at) : null;
    openSheet(`<h2 id="sheetTitle">导入这份记录？</h2>
      <p>${when ? `这是 ${when.getMonth() + 1} 月 ${when.getDate()} 日 ${pad2(when.getHours())}:${pad2(when.getMinutes())} 导出的。` : ''}下面这几科会<b>换成</b>文件里的记录，这台手机上这几科原来的记录会被替换掉；别的科不动。</p>
      <div class="fine"><ul class="sum">${sum.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="acts"><button class="btn btn-b" type="button" id="imYes">导入</button><button class="btn btn-ghost" type="button" data-close data-focus>先不了</button></div>`);
    $('#imYes').onclick = () => {
      const slugs = new Set(Object.keys(data).map(k => k.split(':')[1]));
      let ok = true;
      for (const sl of slugs) { store.del('study:' + sl); store.del('study:' + sl + ':exam'); }
      for (const [k, v] of Object.entries(data)) ok = store.set(k, v) && ok;
      closeSheet();
      toast(ok ? `导入好了 ✅ ${slugs.size} 科的记录都回来了。` : '有一部分没存进去 (｡•́︿•̀｡) 可能手机空间不够。', { y: ok, ms: 4200 });
      route();
    };
  }

  /* ───── 今日收工卡（r20）：今天各科刷了多少、对了几成、复习了几道，适合截图 ───── */
  const WEEK = '日一二三四五六';
  function studyDays() {
    const days = new Set();
    for (const x of INDEX.subjects) if (!x.pending) for (const [d, L] of Object.entries(loadProgress(x.slug).log)) if (L.n || L.mem || L.got || L.ex) days.add(d);
    return days;
  }
  function showDayCard() {
    const k = dayKey(), base = dayBase(), tmr = inDays(1);
    const rows = INDEX.subjects.filter(x => !x.pending).map(x => {
      const p = loadProgress(x.slug);
      return { x, L: p.log[k] || {}, soon: Object.values(p.due).filter(d => d[1] <= tmr).length };
    });
    const sum = f => rows.reduce((n, r) => n + (r.L[f] || 0), 0);
    const n = sum('n'), r = sum('r'), rv = sum('rv'), mem = sum('mem'), got = sum('got'), soon = rows.reduce((t, x) => t + x.soon, 0);
    const exams = rows.filter(x => x.L.ex);
    const any = n || mem || got || exams.length;
    const days = studyDays(), d = dayBase(); if (!days.has(k)) d.setDate(d.getDate() - 1);
    let streak = 0; while (days.has(fmtDay(d))) { streak++; d.setDate(d.getDate() - 1); }
    const rate = n ? Math.round(r / n * 100) : null;
    const say = !any ? pick(['今天还没开刷，来几道再收工？(・ω・)', '先刷 10 道，再心安理得地收工 😌'])
      : n >= 100 ? pick(['今天刷了一百多道，手指头辛苦了 🫡', '这个量，期末稳了 💪'])
      : rate != null && rate >= 85 ? pick(['正确率这么高，明天可以挑点难的 😎', '又快又准，今天状态很好 ✨'])
      : rate != null && rate < 60 ? pick(['错得多不要紧，错过的明天会再来找你 📅', '今天错的就是明天能拿的分 🫂'])
      : pick(['今天的份做完了，早点睡 🌙', '积少成多，明天接着来 🌱', '辛苦了，去喝口水 🥤']);
    const active = rows.filter(x => x.L.n || x.L.ex || x.L.mem || x.L.got);
    openSheet(`<h2 id="sheetTitle" class="sr">今日收工</h2>
      <div class="daycard" id="dayCard">
        <div class="dc-head"><span class="num">${base.getMonth() + 1} 月 ${base.getDate()} 日 · 周${WEEK[base.getDay()]}</span><span>今日收工 🌙</span></div>
        ${any ? `<div class="dc-big"><strong class="num">${n}</strong><span>道题${rate != null ? `<br>正确率 <b class="num">${rate}%</b>` : ''}</span></div>` : '<div class="dc-big none">今天还没刷题</div>'}
        <div class="dc-tiles">
          <div><strong class="num">${rv}</strong><small>复习过关</small></div>
          <div><strong class="num">${mem}</strong><small>记住考点卡</small></div>
          <div><strong class="num">${got}</strong><small>背会主观题</small></div>
          <div><strong class="num">${streak}</strong><small>连续学习天数</small></div>
        </div>
        ${active.length ? `<div class="dc-subj">${active.map(x => `<div><i style="background:${HUES[hueOf(x.x.slug)][0]}"></i><b>${esc(x.x.name)}</b><span class="num">${[
          x.L.n ? `${x.L.n} 道 · 对 ${Math.round((x.L.r || 0) / x.L.n * 100)}%` : '',
          x.L.ex ? `模拟卷 ${x.L.ex[0]}/${x.L.ex[1]}` : '',
          !x.L.n && !x.L.ex ? [x.L.mem ? `记住 ${x.L.mem} 张卡` : '', x.L.got ? `背会 ${x.L.got} 道` : ''].filter(Boolean).join('，') : ''].filter(Boolean).join('，')}</span></div>`).join('')}</div>` : ''}
        <p class="dc-say">${say}</p>
        ${soon ? `<p class="dc-next">明天要复习 <b class="num">${soon}</b> 道错题 📅</p>` : ''}
      </div>
      <div class="acts">${any ? '<button class="btn btn-b" type="button" data-close data-focus>收工 😴</button>' : '<button class="btn btn-b" type="button" data-close data-focus>好，去刷几道 ✏️</button>'}</div>
      ${any ? '<p class="dc-tip">想留个纪念就截个图 📸</p>' : ''}`);
    if (any && n >= 30) { const c = $('#dayCard').getBoundingClientRect(); setTimeout(() => confetti(c.left + c.width / 2, c.top + 40, 24, 300), 250); }
  }

  /* ───── 夜里打开 ───── */
  function nightCheck() {
    const h = new Date().getHours();
    if ((h >= 23 || h < 5) && !ss.get('study:night')) { ss.set('study:night', '1'); setTimeout(() => toast('夜深了 🌙 刷完这几题就去睡吧，明天的你会感谢现在的你。', { y: true, ms: 6000, action: ['收工卡', showDayCard] }), 1200); }
  }

  /* ═════════════ 首页：科目列表 ═════════════ */
  // 科目颜色按 index.json 里的顺序轮换（和科目页页头 data-hue 对应）；圆点文字默认取科目名第一个字，可在 index.json 里用 "dot" 指定
  const HUES = [['var(--y)', '#1E1E24'], ['var(--m)', '#0B3D2E'], ['var(--b)', '#0B2540'], ['var(--p)', '#fff'], ['var(--c)', '#3D0A0A']];
  const hueOf = slug => Math.max(0, (INDEX?.subjects || []).findIndex(x => x.slug === slug)) % HUES.length;
  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? '这么晚还在学，佩服 🦉' : h < 9 ? '早上好 ☀️ 脑子最清醒的时候' : h < 12 ? '上午好，来几道？✏️' : h < 14 ? '中午好，吃饱了再刷 🍚' : h < 18 ? '下午好，犯困就刷题 ☕' : h < 23 ? '晚上好，今天刷了吗 (・ω・)' : '夜深了，刷几题就睡 🌙';
  }
  let pendingTaps = 0;
  // 首页“接着刷”：最近动过的一科（旧记录没有时间，就挑做题最多的）
  function lastStudied() {
    let best = null;
    for (const s of INDEX.subjects) {
      if (s.pending) continue;
      const p = loadProgress(s.slug), n = Object.keys(p.a).length;
      if (!n || !p.last) continue;
      const k = [p.at || 0, n];
      if (!best || k[0] > best.k[0] || (k[0] === best.k[0] && k[1] > best.k[1])) best = { s, p, k };
    }
    return best;
  }
  const JOKES = [
    '医学生的三大错觉：这个肯定不考、我好像会了、明天再背也来得及 🙃',
    '记不住的知识点就像阑尾：平时没感觉，考试时突然发作 😵',
    '背书和吃药一个道理：按时按量，不能一次吞完 💊',
    '病理学学久了，看千层蛋糕都想数一数有几层上皮 🍰',
    '药理学第一定律：剂量决定毒性，咖啡也不例外 ☕',
    '红细胞没有细胞核，所以它从来不“核”你计较 ❤️',
    '神经元之间为什么老是误会？因为中间隔着一道“突触” 🧠',
    '肝：你熬的每一个夜，我都记着呢 😮‍💨',
    '白细胞人缘为什么好？见谁都想抱一抱（吞噬的那种）🤗',
    '心肌细胞从不请假，它说停一下就要出大事 💓',
    '老师说“这个了解一下就行”，往往就是考试的大题 📝',
    '血压问我最近压力大不大，我说不大，也就 140/90 🩺',
  ];
  let jokeAt = -1;
  function renderHome() {
    document.body.dataset.subject = '';
    document.title = '复习资料';
    const subs = INDEX.subjects, resume = lastStudied();
    const dues = subs.filter(x => !x.pending).map(x => [x, dueIds(loadProgress(x.slug)).length]).filter(x => x[1]);
    app.innerHTML = `<div class="wrap">
      <div class="top"><a class="back" href="/">${icon('back')}课程表</a></div>
      <section class="home-hero"><span class="s1"></span><span class="s2"></span><span class="s3"></span>
        <small>${greeting()}</small><h1>复习资料</h1><p>往届题、考点卡、模拟卷都理好了，挑一科开刷！💪</p></section>
      ${resume ? `<button class="resume" type="button" id="resume"><span class="ico">${icon('play')}</span><span class="t"><small>接着刷 · 上次停在 <span class="num">${esc(resume.p.last)}</span></small><strong>${esc(resume.s.name)}</strong></span>${icon('right')}</button>` : ''}
      ${dues.length ? `<div class="review-home"><div class="rh-t"><span class="ico">📅</span><span><strong>今日复习 <span class="num">${dues.reduce((n, x) => n + x[1], 0)}</span> 道</strong><small>以前做错的题，今天该再看一眼了</small></span></div>
        <div class="rh-list">${dues.map(([x, n]) => `<button class="rh-btn" type="button" data-due="${esc(x.slug)}">${esc(x.name)} <b class="num">${n}</b></button>`).join('')}</div></div>` : ''}
      <div class="subjects">${subs.map(s => {
        const [bg, fg] = HUES[hueOf(s.slug)];
        const dot = s.dot || s.name[0];
        if (s.pending) return `<button class="subject pending" type="button" data-pending="${esc(s.name)}"><span class="dot">${esc(dot)}</span><span class="t"><strong>${esc(s.name)}</strong><small>${esc(s.note || '还在整理中')}</small></span><img class="nya-mini" src="${NYA}" alt="" width="48" height="46"></button>`;
        const p = loadProgress(s.slug), done = Object.keys(p.a).length, total = s.scored || s.quiz, pct = total ? Math.min(100, Math.round(done / total * 100)) : 0;
        return `<a class="subject" href="#${s.slug}"><span class="dot${dot.length > 1 ? ' two' : ''}" style="background:${bg};color:${fg}">${esc(dot)}</span><span class="t"><strong>${esc(s.name)}</strong><small>考点卡 ${s.cards} 张，选择题 ${s.quiz} 道${done ? `，已刷 ${pct}%` : ''}</small><span class="bar"><i style="width:${pct}%;background:${bg}"></i></span></span>${icon('right', 'style="color:var(--muted)"')}</a>`;
      }).join('')}</div>
      <button class="dayend-cta" type="button" id="dayEnd"><span class="ico">🌙</span><span class="t"><strong>今日收工</strong><small>看看今天刷了多少，截图留念</small></span>${icon('right')}</button>
      ${footHTML('')}</div>`;
    bindFoot('');
    $('#dayEnd').onclick = showDayCard;
    $$('[data-due]').forEach(b => b.onclick = () => {
      const p = loadProgress(b.dataset.due); p.tab = 2; p.f = { ch: '', src: '', mode: 'due', stop: false, rand: p.f?.rand || 0 }; store.set(progressKey(b.dataset.due), p);
      location.hash = b.dataset.due;
    });
    $('#resume')?.addEventListener('click', () => {
      const p = loadProgress(resume.s.slug); p.tab = 2; store.set(progressKey(resume.s.slug), p);
      location.hash = resume.s.slug;
    });
    // “整理中”的科目：每次点都出哭哭图，第二下起再配一句催更回复
    $$('[data-pending]').forEach(b => b.onclick = () => {
      pendingTaps++;
      showNya(b.dataset.pending);
      const msgs = ['催也没用，书还没买喵 (｡•́︿•̀｡)', '在找了在找了……🫠', '真的没有资料喵！(╯°□°)╯', `再催${AUTHOR}就要掉头发了 👨‍🦲`, '好吧，催更收到了喵，继续找资料中 🏃💨'];
      if (pendingTaps >= 2) toast(`${b.dataset.pending}：${msgs[Math.min(pendingTaps - 2, msgs.length - 1)]}`);
      if (pendingTaps === 6) { const r = b.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top, 20, 260); }
    });
    bindHomeHero();
  }

  /* 首页色块：点一下方块转圈；1.5 秒内接着连点，5 下几何块乱弹并讲个冷笑话，15 下几何块全掉下去，2 秒后飞回来（r15） */
  function bindHomeHero() {
    const hero = $('.home-hero'), shapes = ['.s1', '.s2', '.s3'].map(c => hero.querySelector(c));
    const base = ['none', 'rotate(18deg)', 'none'];
    let taps = 0, timer, broken = false;
    hero.onclick = () => {
      if (broken) return;
      shapes[1].animate?.([{ transform: 'rotate(18deg)' }, { transform: 'rotate(378deg)' }], { duration: calm ? 0 : 800, easing: 'cubic-bezier(.3,1.4,.5,1)' });
      taps++; clearTimeout(timer); timer = setTimeout(() => taps = 0, 1500);
      if (taps === 5) {
        if (!calm) shapes.forEach((el, i) => {
          const dx = (Math.random() - .5) * 160, dy = (Math.random() - .5) * 90, r = (Math.random() - .5) * 240;
          el.animate([{ transform: base[i] }, { transform: `translate(${dx}px,${dy}px) rotate(${r}deg) ${base[i] === 'none' ? '' : base[i]}`, offset: .4 }, { transform: base[i] }], { duration: 1100, easing: 'cubic-bezier(.3,1.5,.5,1)' });
        });
        let k; do k = Math.floor(Math.random() * JOKES.length); while (k === jokeAt && JOKES.length > 1);
        jokeAt = k; toast(JOKES[k], { y: true, ms: 5200 });
      }
      if (taps >= 15) {
        taps = 0; broken = true;
        toast('你把首页拆了 (ﾟДﾟ;)', { ms: 2600 });
        const fall = calm ? null : shapes.map((el, i) => el.animate([{ transform: base[i] }, { transform: `translateY(-14px) rotate(-20deg) ${base[i] === 'none' ? '' : base[i]}`, offset: .2 }, { transform: `translateY(${innerHeight}px) rotate(${200 + i * 60}deg)`, opacity: 0 }], { duration: 1300, delay: i * 120, easing: 'cubic-bezier(.5,0,.9,.4)', fill: 'forwards' }));
        if (calm) shapes.forEach(el => el.style.visibility = 'hidden');
        setTimeout(() => {
          if (calm) shapes.forEach(el => el.style.visibility = '');
          else shapes.forEach((el, i) => { fall[i].cancel(); el.animate([{ transform: `translateY(-260px) rotate(-90deg)`, opacity: 0 }, { transform: base[i], opacity: 1 }], { duration: 900, delay: i * 90, easing: 'cubic-bezier(.3,1.5,.5,1)', fill: 'backwards' }); });
          toast('……它们自己飞回来了 🛠️', { y: true });
          broken = false;
        }, (calm ? 0 : 1300) + 2000);
      }
    };
  }

  /* “整理中”科目的哭哭图：点图会抖一下、掉眼泪 */
  function showNya(name) {
    if (sheet.classList.contains('on')) return;
    const p = (INDEX?.subjects || []).find(x => x.pending && (!name || x.name === name)) || {};
    openSheet(`<h2 id="sheetTitle">${esc(p.name || '还在整理')} 😭</h2>
      <button class="nya" type="button" id="nya" aria-label="哭哭图，点一下"><img src="${NYA}" alt="哭泣的粉发小女孩表情包" width="480" height="464"></button>
      <p class="nya-say">${esc(p.note || '还在整理中，等着吧喵')}</p>
      <div class="acts"><button class="btn btn-ghost" type="button" data-close data-focus>好吧，等着 🫡</button></div>`);
    let n = 0;
    $('#nya').onclick = () => {
      n++;
      const img = $('#nya img');
      if (!calm) { img.classList.remove('sob'); void img.offsetWidth; img.classList.add('sob'); }
      const r = img.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top + r.height * .55, 14, 200, ['#74C0FC', '#A5D8FF', '#4DABF7', '#D0EBFF']);
      if (n === 5) toast('别戳了喵，眼泪要流干了 💧');
      if (n === 12) toast(`……(｡ŏ_ŏ) ${AUTHOR}去找资料了，真的。`);
    };
  }

  /* ═════════════ 科目页 ═════════════ */
  let S = null; // 当前科目状态
  let visit = 0; // 每换一次页面加 1；答题后的延时提示核对它，页面已经换了就不再弹（r16）

  function save() { S.p.at = Date.now(); store.set(progressKey(S.slug), S.p); }
  function stats() {
    // 不计分的题答不了，不算进总数，否则永远刷不到 100%（r16）
    const ids = new Set(S.d.quiz.filter(q => q.st !== 'stop').map(q => q.id));
    const ans = Object.entries(S.p.a).filter(([id]) => ids.has(id));
    const done = ans.length, right = ans.filter(([, v]) => v[1]).length;
    let streak = S.p.streak;
    if (streak == null) { streak = 0; for (let k = S.p.h.length - 1; k >= 0 && S.p.h[k]; k--) streak++; }
    return { done, right, total: ids.size, rate: done ? Math.round(right / done * 100) : null, wrong: S.p.wrong.filter(id => ids.has(id)).length, streak };
  }
  function paintStats(pop) {
    const s = stats();
    const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    $('#streakT').innerHTML = s.streak ? `连对 <span class="num">${s.streak}</span> 题` : (s.done ? '从这题开始连对 💪' : '答对一题点亮连对 🔥');
    $('#meter').style.width = pct + '%';
    $('#pct').textContent = pct;
    $('#doneN').textContent = s.done;
    $('#tDone').textContent = s.done;
    $('#tRate').innerHTML = s.rate == null ? '—' : `${s.rate}<em>%</em>`;
    $('#tWrong').textContent = s.wrong;
    $('#wrongN').textContent = s.wrong;
    if (pop && !calm) { const el = $('#streak'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    return s;
  }

  async function renderSubject(slug, reload) {
    const meta = INDEX.subjects.find(s => s.slug === slug && !s.pending);
    if (!meta) { location.hash = ''; return; }
    hideVerdict();
    if (!reload || !S || S.slug !== slug) app.innerHTML = `<div class="loading" role="status"><i></i><i></i><i></i><br>正在翻开${esc(meta.name)}… 📖</div>`;
    let d;
    try { d = await getJSON(`/study-data/${slug}.json`); }
    catch (_) {
      app.innerHTML = `<div class="wrap"><div class="top"><a class="back" href="#">${icon('back')}全部科目</a></div>
        <div class="empty"><big>📡</big>没连上网 (；′⌒｀) ${esc(meta.name)}的资料没加载出来。<br>${prefs.offline === 'yes' ? '离线包里也没找到这科，联网后再打开一次就好。' : '下次可以先下载离线包，没网也能刷。'}<br><br><button class="btn btn-b" type="button" id="retry">再试一次</button></div></div>`;
      $('#retry').onclick = () => renderSubject(slug);
      return;
    }
    S = { slug, d, p: loadProgress(slug), list: [], cur: 0, search: '', star: 0, cardView: '', deck: null, open: new Set(), qMap: Object.fromEntries(d.quiz.map(q => [q.id, q])) };
    if (!S.p.f) S.p.f = { ch: '', src: '', mode: '', stop: false };
    document.body.dataset.subject = slug;
    document.body.dataset.hue = hueOf(slug);
    document.title = `${d.name} · 复习资料`;
    const chars = [...d.name].map((c, i) => `<span class="ch" style="--i:${i}">${esc(c)}</span>`).join('');
    const ex = d.exam, last = S.p.examLast;
    app.innerHTML = `<div class="wrap">
      <div class="top"><a class="back" href="#">${icon('back')}全部科目</a>
        <span class="top-r"><button class="pill-btn end-btn" type="button" id="endBtn">🌙 收工</button>
        <button class="pill-btn wrong-btn" type="button" id="wrongBtn">${icon('book', 'style="width:16px;height:16px"')}错题本 <span class="num" id="wrongN">0</span></button></span></div>
      <div class="subj-head"><section class="hero" id="hero">
        <span class="blob1"></span><span class="blob2"></span><span class="blob3" id="blob3"></span>
        <div class="term">${esc(d.term || '期末复习')}</div>
        <h1 id="title" aria-label="${esc(d.name)}">${chars}</h1>
        <button class="streak" type="button" id="streak"><span class="flame"></span><span id="streakT"></span></button>
        <div class="meter"><i id="meter"></i></div>
        <div class="meter-cap"><span>已刷 <span class="num" id="pct">0</span>%</span><span class="num"><span id="doneN">0</span> / ${d.quiz.filter(q => q.st !== 'stop').length}</span></div>
      </section>
      <div class="subj-side"><div class="tiles">
        <div class="tile t-b"><small>已做</small><strong class="num" id="tDone">0</strong></div>
        <div class="tile t-m"><small>正确率</small><strong class="num" id="tRate">—</strong></div>
        <button class="tile t-c" type="button" id="wrongTile"><small>错题 ›</small><strong class="num" id="tWrong">0</strong></button>
      </div>
      <button class="cta" type="button" id="openExam">
        <span class="ico">${icon('play')}</span>
        <div><strong>自主期末测试</strong><small>${esc(examSummary(ex))}${last ? `，上次单选 ${last.score}/${last.total}` : ''}</small></div>
        ${ex.minutes ? `<span class="time">${ex.minutes}<small> 分钟</small></span>` : ''}
      </button></div></div></div>
      <div class="bar" id="bar"><div class="wrap"><div class="tabs" role="tablist">
        <button class="tab" role="tab" type="button" data-tab="0">考点</button>
        <button class="tab" role="tab" type="button" data-tab="1">高频</button>
        <button class="tab" role="tab" type="button" data-tab="2">刷题</button>
        <button class="tab" role="tab" type="button" data-tab="3">背诵</button>
      </div></div></div>
      <main class="wrap"><div id="panel" role="tabpanel"></div>${footHTML(slug)}</main>`;
    paintStats(false);
    bindFoot(slug);
    bindHeroEggs();
    $$('.tab').forEach(t => t.onclick = () => setTab(+t.dataset.tab, true));
    // 错题本：页面下方换成错题后，滚过去并闪一下，再弹个提示，免得以为没点上（r15）
    $('#wrongBtn').onclick = $('#wrongTile').onclick = () => {
      const n = stats().wrong;
      if (!n) { toast('错题本空空的，目前为止全对，太强了！🏆', { y: true }); return; }
      S.p.f = { ch: '', src: '', mode: 'wrong', stop: false, rand: S.p.f.rand || 0 }; setTab(2, false, true);
      scrollTo({ top: $('#bar').offsetTop, behavior: calm ? 'auto' : 'smooth' });
      flash($('#quiz'));
      toast(`打开错题本：${n} 道错题 📕 答对一道就移出去一道。`, { bottom: true });
    };
    $('#openExam').onclick = openExamStart;
    $('#endBtn').onclick = showDayCard;
    setTab(S.p.tab || 0, false);
    if (!reload) scrollTo(0, 0);
    resumeExamIfNeeded();
  }
  function examSummary(ex) {
    const parts = ex.parts.map(p => `${p.title.replace(/（.*$/, '')} ${p.qs.length} 题`);
    return parts.join('，');
  }

  function flash(el) { if (!el || calm) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  function setTab(i, scroll, rebuild) {
    S.p.tab = i; save();
    hideVerdict();
    $$('.tab').forEach(t => t.setAttribute('aria-selected', +t.dataset.tab === i));
    const panel = $('#panel');
    panel.className = i === 2 && !S.round ? 'quiz-panel' : '';
    if (i === 0) renderCards(panel);
    else if (i === 1) renderHot(panel);
    else if (i === 2) renderQuiz(panel, rebuild);
    else renderSubj(panel);
    if (scroll) { const top = $('#bar').offsetTop; if (scrollY > top) scrollTo({ top }); }
  }

  /* ───── 页头彩蛋 ───── */
  function bindHeroEggs() {
    const hero = $('#hero');
    const PAL = [null, ['var(--c)', 'var(--y)', 'var(--b)', 'var(--m)', '#3D0A0A'], ['var(--m)', 'var(--p)', 'var(--y)', 'var(--c)', '#0B3D2E'], ['var(--b)', 'var(--y)', 'var(--c)', 'var(--y)', '#0B2540'], ['var(--y)', 'var(--c)', 'var(--b)', 'var(--m)', '#1E1E24'], ['var(--p)', 'var(--m)', 'var(--y)', 'var(--c)', '#fff']];
    let pal = 0, taps = [];
    hero.addEventListener('click', e => {
      if (e.target.closest('#title,#streak,#blob3')) return;
      if (!calm) { hero.classList.remove('spin'); void hero.offsetWidth; hero.classList.add('spin'); }
      const t = Date.now(); taps = taps.filter(x => t - x < 3000); taps.push(t);
      if (taps.length >= 5) {
        taps = []; pal = (pal + 1) % PAL.length; const p = PAL[pal];
        ['--hero', '--k1', '--k2', '--k3', '--on-hero'].forEach((k, n) => p ? hero.style.setProperty(k, p[n]) : hero.style.removeProperty(k));
        const r = hero.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + r.height / 2, 26, 360);
        toast(pal ? `解锁隐藏配色 ${pal}/${PAL.length - 1} 🎨` : '换回本来的颜色啦');
      }
    });
    let tt = 0, ttTimer;
    $('#title').addEventListener('click', () => {
      tt++; clearTimeout(ttTimer); ttTimer = setTimeout(() => tt = 0, 1500);
      if (tt >= 3 && !calm) { tt = 0; const h = $('#title'); h.classList.remove('wave'); void h.offsetWidth; h.classList.add('wave'); }
    });
    let bt = 0;
    $('#blob3').addEventListener('click', e => {
      e.stopPropagation(); bt++;
      if (bt === 4) toast('别戳了，它有点晕…… @_@');
      if (bt >= 7) { bt = -999; const b = $('#blob3'); if (calm) b.hidden = true; else b.classList.add('fall'); setTimeout(() => toast('它掉下去了……(ﾟДﾟ;) 刷新一下会回来。'), 700); }
    });
    $('#streak').onclick = () => {
      const s = stats();
      toast(S.p.best ? `你的最高纪录：连对 ${S.p.best} 题 🔥${s.streak >= S.p.best && s.streak ? ' 现在就在纪录上！' : ''}` : '还没开始连对，去刷题区试试！(・ω・)ノ');
    };
  }

  /* ═════════════ 考点速览 ═════════════ */
  /* 考点卡收藏 / 记住了 / 乱序抽卡（r16）
     卡片键 = “章号:卡号”（没有卡号的用序号），存在 S.p.fav、S.p.mem。
     “记住了”的卡在列表里默认收起，点“已记住的”能找回；搜索时照样能搜到。 */
  const cardKey = (c, k, ki) => `${c.id}:${k.no || ki}`;
  const favSet = () => new Set(S.p.fav), memSet = () => new Set(S.p.mem);
  function allCards() {
    const res = [];
    S.d.chapters.forEach((c, ci) => { if (!c.appendix) c.cards.forEach((k, ki) => res.push({ key: cardKey(c, k, ki), c, k, ci, ki })); });
    return res;
  }
  const starsHTML = n => n ? `<span class="stars" aria-label="${n} 星">${'★'.repeat(n)}<i aria-hidden="true">${'★'.repeat(3 - n)}</i></span>` : '';
  function refsHTML(k) {
    if (!k.refs.length) return '';
    return `<div class="refs"><span>对应题</span>${k.refs.map(id => {
      const q = S.qMap[id]; if (!q) return '';
      const a = S.p.a[id]; const cls = q.st === 'stop' ? ' off' : a ? (a[1] ? ' done' : ' miss') : '';
      return `<button class="ref num${cls}" type="button" data-q="${esc(id)}" title="${q.st === 'stop' ? '这题不计分' : '去做这道题'}">${esc(id)}</button>`;
    }).join('')}</div>`;
  }
  function cardActsHTML(key) {
    const fav = S.p.fav.includes(key), mem = S.p.mem.includes(key);
    return `<div class="card-acts">
      <button class="cact${fav ? ' on' : ''}" type="button" data-cardact="fav" data-key="${esc(key)}" aria-pressed="${fav}">${fav ? '⭐ 已收藏' : '☆ 收藏'}</button>
      <button class="cact${mem ? ' on' : ''}" type="button" data-cardact="mem" data-key="${esc(key)}" aria-pressed="${mem}">${mem ? '✓ 已记住' : '记住了'}</button></div>`;
  }
  function cardAct(b) {
    const key = b.dataset.key, kind = b.dataset.cardact, list = S.p[kind];
    const on = !list.includes(key);
    S.p[kind] = on ? [...list, key] : list.filter(x => x !== key);
    if (kind === 'mem') logDay(S.p, 'mem', on ? 1 : -1);
    save();
    const card = b.closest('.card');
    if (card) { card.classList.toggle(kind, on); const acts = card.querySelector('.card-acts'); if (acts) acts.outerHTML = cardActsHTML(key); }
    paintCardChips();
    if (S.deck) { if (kind === 'mem' && on) { toast('记住了 ✓ 这张以后先跳过，在“已记住的”里能找回。', { bottom: true, ms: 2600 }); deckMove(1); } return; }
    if (kind === 'fav') toast(on ? '收藏了 ⭐ 点“只看收藏”能把它们挑出来。' : '取消收藏了', { bottom: true, ms: 2400 });
    else if (on && S.cardView !== 'mem' && !S.search) {
      toast('记住了 ✓ 这张先收起来', { bottom: true, ms: 4200, action: ['撤销', () => { S.p.mem = S.p.mem.filter(x => x !== key); save(); applyCardFilter(); paintCardChips(); }] });
      applyCardFilter();
    } else if (!on && S.cardView === 'mem') applyCardFilter();
  }
  function paintCardChips() {
    const f = $('#nFav'), m = $('#nMem');
    if (f) f.textContent = S.p.fav.length; if (m) m.textContent = S.p.mem.length;
  }

  function renderCards(panel) {
    const d = S.d;
    if (S.deck) { renderDeck(panel); return; }
    const starCount = n => d.chapters.reduce((k, c) => k + c.cards.filter(x => !n || x.stars === n).length, 0);
    panel.innerHTML = `
      ${d.intro ? `<details class="hint"><summary><b>考点卡怎么看？</b></summary><div class="md">${d.intro}</div></details>` : ''}
      <button class="deck-cta" type="button" id="deckBtn"><span class="ico">🎲</span><span class="t"><strong>乱序抽卡</strong><small>一张一张抽，先回想再翻开</small></span>${icon('right')}</button>
      <div class="search">${icon('search')}<input id="q" type="search" enterkeyhint="search" placeholder="搜考点，比如“24 小时”" value="${esc(S.search)}" aria-label="搜索考点"><button class="clear" type="button" id="qClear" aria-label="清空搜索" ${S.search ? '' : 'hidden'}>${icon('x')}</button></div>
      <div class="filters wrapf" id="starF">
        ${[[0, '全部'], [3, '★★★ 必背'], [2, '★★ 应会'], [1, '★ 有空再看']].map(([n, t]) => `<button class="chip" type="button" data-s="${n}" aria-pressed="${S.star === n}">${t} <span class="n num">${starCount(n)}</span></button>`).join('')}
      </div>
      <div class="filters wrapf" id="viewF">
        <button class="chip" type="button" data-view="fav" aria-pressed="${S.cardView === 'fav'}">⭐ 只看收藏 <span class="n num" id="nFav">${S.p.fav.length}</span></button>
        <button class="chip" type="button" data-view="mem" aria-pressed="${S.cardView === 'mem'}">✓ 已记住的 <span class="n num" id="nMem">${S.p.mem.length}</span></button>
      </div>
      <p class="found" id="found" hidden></p>
      <button class="btn btn-ghost sm expand-all" type="button" id="expandAll">全部展开</button>
      <div id="chapters">${d.chapters.map((c, ci) => chapterHTML(c, ci)).join('')}</div>
      <div class="empty" id="noCard" hidden></div>`;
    $$('.ch-head', panel).forEach(h => h.onclick = () => toggleChapter(h.parentElement));
    $$('#starF .chip', panel).forEach(c => c.onclick = () => { S.star = +c.dataset.s; $$('#starF .chip').forEach(x => x.setAttribute('aria-pressed', x === c)); applyCardFilter(); });
    $$('#viewF .chip', panel).forEach(c => c.onclick = () => {
      S.cardView = S.cardView === c.dataset.view ? '' : c.dataset.view;
      $$('#viewF .chip').forEach(x => x.setAttribute('aria-pressed', S.cardView === x.dataset.view));
      applyCardFilter();
      if (S.cardView) { const f = $('#found'); if (!f.hidden) { f.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' }); } }
    });
    $('#deckBtn').onclick = startDeck;
    $('#expandAll').onclick = () => {
      const all = $$('.chapter', panel).filter(c => !c.hidden), opening = all.some(c => !c.classList.contains('open'));
      all.forEach(c => setChapter(c, opening)); $('#expandAll').textContent = opening ? '全部收起' : '全部展开';
    };
    let tm;
    const q = $('#q');
    q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { S.search = q.value.trim(); $('#qClear').hidden = !S.search; applyCardFilter(); searchEgg(S.search); }, 180); });
    $('#qClear').onclick = () => { q.value = ''; S.search = ''; $('#qClear').hidden = true; applyCardFilter(); q.focus(); };
    // 用 onclick 覆盖，不用 addEventListener：#panel 换栏目时不重建，叠加的处理会让点击生效好几次（r16）
    panel.onclick = e => {
      const r = e.target.closest('.ref[data-q]'); if (r) { goQuiz(r.dataset.q); return; }
      const b = e.target.closest('[data-cardact]'); if (b) cardAct(b);
    };
    applyCardFilter();
  }
  function chapterHTML(c, ci) {
    const open = S.open.has(ci), fav = favSet(), mem = memSet();
    return `<article class="chapter${c.appendix ? ' fu' : ''}${open ? ' open' : ''}" data-ci="${ci}">
      <button class="ch-head" type="button" aria-expanded="${open}"><span class="ch-no num">${c.appendix ? '速' : esc(c.id)}</span><span class="ch-t"><strong>${esc(c.title)}</strong><small>${starsHTML(c.stars)}${c.stars ? '　' : ''}${c.cards.length ? `${c.cards.length} 张卡` : '速记表'}</small></span>${icon('chev', 'class="i chev"')}</button>
      <div class="ch-body">${c.intro ? `<div class="ch-intro md">${c.intro}</div>` : ''}
      ${c.cards.map((k, ki) => { const key = cardKey(c, k, ki); return `<div class="card${fav.has(key) ? ' fav' : ''}${mem.has(key) ? ' mem' : ''}" data-s="${k.stars}" data-no="${esc(k.no)}" data-ki="${ki}" data-key="${esc(key)}">
        <h3>${k.no ? `<span class="no num">${esc(k.no)}</span>` : ''}<span class="t">${esc(k.title)}</span>${starsHTML(k.stars)}</h3>
        <div class="md">${k.html}</div>
        ${refsHTML(k)}${c.appendix ? '' : cardActsHTML(key)}
      </div>`; }).join('')}</div></article>`;
  }
  function setChapter(el, open) { el.classList.toggle('open', open); $('.ch-head', el).setAttribute('aria-expanded', open); const ci = +el.dataset.ci; open ? S.open.add(ci) : S.open.delete(ci); }
  function toggleChapter(el) { setChapter(el, !el.classList.contains('open')); }
  function applyCardFilter() {
    const q = S.search.toLowerCase(), star = S.star, view = S.cardView || '', filtering = !!(q || star || view);
    const fav = favSet(), mem = memSet();
    let found = 0, hiddenMem = 0;
    for (const ch of $$('.chapter')) {
      const c = S.d.chapters[+ch.dataset.ci];
      let any = false;
      for (const card of $$('.card', ch)) {
        const k = c.cards[+card.dataset.ki], key = card.dataset.key;
        const md = $('.md', card); if (q || md.querySelector('mark')) md.innerHTML = k.html;
        const text = (k.no + ' ' + k.title + ' ' + plain(k.html)).toLowerCase();
        // 视图：收藏只看收藏；已记住只看记住的；平时把记住的收起来（搜索时照样显示）
        const viewOk = view === 'fav' ? fav.has(key) : view === 'mem' ? mem.has(key) : (q || !mem.has(key));
        const base = (!star || k.stars === star) && (!q || text.includes(q));
        if (base && !viewOk && !view && mem.has(key)) hiddenMem++;
        const ok = base && viewOk;
        card.hidden = !ok;
        if (ok) { any = true; found++; if (q) highlight(card, S.search); }
      }
      ch.hidden = filtering ? !any : (c.cards.length > 0 && !any);
      if (q && any) setChapter(ch, true);
    }
    const f = $('#found');
    const msg = view === 'fav' ? `收藏的卡 ${found} 张 ⭐` : view === 'mem' ? `已记住的卡 ${found} 张，点“已记住”能放回去` : `找到 ${found} 张卡 ✨`;
    f.hidden = !(filtering && found) && !hiddenMem;
    f.textContent = (filtering && found ? msg : '') + (hiddenMem && !view ? `${filtering && found ? '；' : ''}记住了的 ${hiddenMem} 张先收起来了，点“已记住的”能找回` : '');
    const empty = $('#noCard');
    empty.hidden = !filtering || found > 0;
    empty.innerHTML = view === 'fav' ? '<big>⭐</big>还没有收藏的卡。<br>看到想多看几遍的卡，点卡片底下的“收藏”。' : view === 'mem' ? '<big>🧠</big>还没有标“记住了”的卡。' : '<big>🔍</big>没搜到 (・_・;) 换个说法试试，比如只搜关键词。';
  }

  /* ───── 乱序抽卡 ───── */
  function deckPool() {
    const fav = favSet(), mem = memSet();
    return allCards().filter(x => (!S.star || x.k.stars === S.star) && (S.cardView === 'fav' ? fav.has(x.key) : S.cardView === 'mem' ? mem.has(x.key) : !mem.has(x.key)));
  }
  function startDeck() {
    const pool = deckPool().map(x => x.key);
    if (!pool.length) { toast(S.cardView === 'fav' ? '还没有收藏的卡，先收藏几张再来抽 ⭐' : '这个范围没有卡可以抽 (・_・;)'); return; }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    S.deck = { keys: pool, i: 0, open: false, memN: 0 };
    renderDeck($('#panel'));
    scrollTo({ top: $('#bar').offsetTop, behavior: calm ? 'auto' : 'smooth' });
  }
  function deckMove(step) {
    const D = S.deck; if (!D) return;
    if (step > 0 && S.p.mem.includes(D.keys[D.i])) D.memN++;
    D.i = Math.max(0, Math.min(D.keys.length, D.i + step)); D.open = false;
    renderDeck($('#panel'));
    const top = $('#bar').offsetTop; if (scrollY > top) scrollTo({ top });
  }
  function renderDeck(panel) {
    const D = S.deck, map = Object.fromEntries(allCards().map(x => [x.key, x]));
    const scope = [S.star ? '★'.repeat(S.star) : '', S.cardView === 'fav' ? '只抽收藏' : S.cardView === 'mem' ? '只抽已记住' : '跳过已记住'].filter(Boolean).join(' · ');
    let body;
    if (D.i >= D.keys.length) {
      body = `<div class="empty deck-end"><big>🎉</big>这一轮 ${D.keys.length} 张抽完了！${D.memN ? `<br>其中 ${D.memN} 张标了“记住了”。` : ''}<br><br>
        <button class="btn btn-b" type="button" id="deckAgain">再洗一轮 🎲</button></div>`;
    } else {
      const x = map[D.keys[D.i]];
      body = `<article class="card deck-card${D.open ? ' open' : ''}${S.p.fav.includes(x.key) ? ' fav' : ''}" data-key="${esc(x.key)}">
        <small class="deck-ch">${esc(x.c.id)} ${esc(x.c.title)}</small>
        <h3>${x.k.no ? `<span class="no num">${esc(x.k.no)}</span>` : ''}<span class="t">${esc(x.k.title)}</span>${starsHTML(x.k.stars)}</h3>
        ${D.open ? `<div class="md">${x.k.html}</div>${refsHTML(x.k)}` : `<button class="deck-flip" type="button" id="deckFlip">先想想这张讲了什么 🤔<b>点我翻开</b></button>`}
        ${cardActsHTML(x.key)}
      </article>
      <div class="qnav"><button class="btn btn-ghost" type="button" id="deckPrev" ${D.i ? '' : 'disabled'}>上一张</button><button class="btn btn-b" type="button" id="deckNext">下一张</button></div>`;
    }
    panel.innerHTML = `<div class="deck">
      <div class="deck-top"><button class="btn btn-ghost sm" type="button" id="deckExit">${icon('back', 'style="width:16px;height:16px"')}回到列表</button>
        <span class="deck-pos"><span class="num">${Math.min(D.i + 1, D.keys.length)} / ${D.keys.length}</span><small>${scope}</small></span></div>
      <div class="qprog"><i style="width:${Math.min(D.i, D.keys.length) / D.keys.length * 100}%"></i></div>
      ${body}</div>`;
    $('#deckExit').onclick = () => { S.deck = null; renderCards(panel); };
    $('#deckAgain')?.addEventListener('click', startDeck);
    $('#deckFlip')?.addEventListener('click', () => { D.open = true; renderDeck(panel); });
    $('#deckPrev')?.addEventListener('click', () => deckMove(-1));
    $('#deckNext')?.addEventListener('click', () => deckMove(1));
    panel.onclick = e => {
      const r = e.target.closest('.ref[data-q]'); if (r) { S.deck = null; goQuiz(r.dataset.q); return; }
      const b = e.target.closest('[data-cardact]'); if (b) cardAct(b);
    };
  }
  function highlight(root, q) {
    if (!q) return;
    const lq = q.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const i = n.data.toLowerCase().indexOf(lq); if (i < 0) continue;
      const m = document.createElement('mark'); const after = n.splitText(i); after.splitText(q.length);
      m.textContent = after.data; after.replaceWith(m);
    }
  }
  function searchEgg(q) {
    if (q === AUTHOR) { toast(`被你找到了！${AUTHOR}就在这儿 👋`, { y: true }); confetti(innerWidth / 2, 160, 30, 360); }
    else if (/^(考试|期末)?必过$|^逢考必过$/.test(q)) { toast('必过！这句搜索已经替你许好愿了 🙏', { y: true }); }
    else if (/^喵+$/.test(q) || (INDEX?.subjects || []).some(x => x.pending && q && x.name.includes(q) && q.length >= 2)) { $('#q')?.blur(); showNya(); }
    else if (/^摸鱼$/.test(q)) { toast('被抓到了，刷 10 题再摸 🐟', { y: true }); }
  }
  function goCard(no) {
    hideVerdict();
    S.search = ''; S.star = 0; S.cardView = ''; S.deck = null;
    const ci = S.d.chapters.findIndex(c => c.cards.some(k => k.no === no));
    if (ci < 0) return;
    S.open.add(ci);
    setTab(0, false);
    const card = $(`.card[data-no="${CSS.escape(no)}"]`);
    if (card) card.hidden = false, card.closest('.chapter').hidden = false; // 标了“记住了”的卡也要显示出来
    if (card) { card.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' }); card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
  }

  /* ═════════════ 高频题 ═════════════ */
  function renderHot(panel) {
    panel.innerHTML = `<p class="found">题号、卡片编号、章号都能点，直接跳过去 👆</p><div class="md" id="hotMd">${S.d.hot}</div>`;
    linkHot($('#hotMd'));
    panel.onclick = e => {
      const b = e.target.closest('.hl'); if (!b) return;
      if (b.dataset.q) goQuiz(b.dataset.q);
      else if (b.dataset.subj) goSubj(b.dataset.subj);
      else if (b.dataset.card) goCard(b.dataset.card);
      else if (b.dataset.chap) goChapter(b.dataset.chap);
    };
  }
  // 把高频页里的编号换成按钮：选择题号、主观题号到处都认；卡片编号只认“卡片”那一列，章号只认“章”那一列（别的数字不动）
  function linkHot(root) {
    const qIds = new Set(S.d.quiz.map(q => q.id));
    const sIds = new Set(S.d.subjective.groups.flatMap(g => g.items.map(i => i.id)).filter(Boolean));
    const cardNos = new Set(S.d.chapters.flatMap(c => c.cards.map(k => k.no)).filter(Boolean));
    const chIds = new Set(S.d.chapters.filter(c => !c.appendix).map(c => c.id));
    const btn = (attr, val) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'hl num'; b.dataset[attr] = val; b.textContent = val; return b; };
    const swap = (node, re, make) => {
      const t = node.data; let m, last = 0; const frag = document.createDocumentFragment(); let hit = false;
      re.lastIndex = 0;
      while ((m = re.exec(t))) {
        const el = make(m[0]); if (!el) continue;
        hit = true; frag.append(t.slice(last, m.index), el); last = m.index + m[0].length;
      }
      if (!hit) return; frag.append(t.slice(last)); node.replaceWith(frag);
    };
    const texts = el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const res = []; while (w.nextNode()) if (!w.currentNode.parentElement.closest('button')) res.push(w.currentNode); return res; };
    // 表格里的卡片列、章列
    for (const tbl of root.querySelectorAll('table')) {
      const heads = [...tbl.querySelectorAll('thead th')].map(th => th.textContent.trim());
      heads.forEach((h, col) => {
        const kind = /卡/.test(h) ? 'card' : h === '章' ? 'chap' : '';
        if (!kind) return;
        for (const tr of tbl.querySelectorAll('tbody tr')) {
          const td = tr.children[col]; if (!td) continue;
          for (const n of texts(td)) swap(n, kind === 'card' ? /\d+-\d+/g : /\d{2}/g, v => (kind === 'card' ? cardNos : chIds).has(v) ? btn(kind, v) : null);
        }
      });
    }
    for (const n of texts(root)) swap(n, /[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]/g, v => qIds.has(v) ? btn('q', v) : sIds.has(v) ? btn('subj', v) : null);
  }
  function goChapter(id) {
    S.search = ''; S.star = 0; S.cardView = ''; S.deck = null;
    const ci = S.d.chapters.findIndex(c => c.id === id); if (ci < 0) return;
    S.open.add(ci); setTab(0, false);
    const ch = $(`.chapter[data-ci="${ci}"]`);
    if (ch) { ch.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' }); flash(ch); }
  }

  /* ═════════════ 刷题 ═════════════ */
  function buildList() {
    if (S.round) { const i = S.round.ids.indexOf(S.list[S.cur]); S.list = S.round.ids.slice(); S.cur = i < 0 ? 0 : i; return; }
    const f = S.p.f, wrong = new Set(S.p.wrong), due = new Set(f.mode === 'due' ? dueIds(S.p, S.qMap) : []);
    S.list = S.d.quiz.filter(q => (f.stop || q.st !== 'stop') && (!f.ch || q.ch === f.ch) && (!f.src || q.src === f.src) && (!f.stt || q.st === f.stt)
      && (f.mode !== 'wrong' || wrong.has(q.id)) && (f.mode !== 'fresh' || !S.p.a[q.id]) && (f.mode !== 'due' || due.has(q.id))).map(q => q.id);
    if (f.rand) shuffle(S.list, f.rand);
    const i = S.list.indexOf(S.p.last);
    S.cur = i < 0 ? 0 : i;
  }
  // 随机顺序（r15）：每道题按“题号 + 种子”算一个固定的随机数排序。筛掉一部分题后，剩下的题相对顺序不变；
  // 来回切换栏目、刷新页面顺序都不变，重新打开开关才换一种顺序
  function shuffle(arr, seed) {
    const h = id => { let x = seed >>> 0; for (const c of id) x = Math.imul(x ^ c.charCodeAt(0), 2654435761) >>> 0; x ^= x >>> 15; return Math.imul(x, 2246822519) >>> 0; };
    const k = new Map(arr.map(id => [id, h(id)]));
    return arr.sort((a, b) => k.get(a) - k.get(b));
  }
  /* 来 10 题：从当前筛选范围里抽 10 道，优先没做过的，不够再补做错的、做过的。只在这次打开期间有效，不存本机 */
  function startRound() {
    const keepRound = S.round; S.round = null; buildList(); S.round = keepRound;
    const pool = S.list.map(id => S.qMap[id]).filter(q => q.st !== 'stop');
    const wrong = new Set(S.p.wrong);
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const fresh = shuffle(pool.filter(q => !S.p.a[q.id])), miss = shuffle(pool.filter(q => S.p.a[q.id] && wrong.has(q.id))), rest = shuffle(pool.filter(q => S.p.a[q.id] && !wrong.has(q.id)));
    const ids = [...fresh, ...miss, ...rest].slice(0, 10).map(q => q.id);
    if (!ids.length) { toast('这个范围没有能做的题，换个筛选试试 (・_・;)'); return; }
    S.round = { ids, res: {}, done: false };
    S.list = ids.slice(); S.cur = 0; // 从第 1 道开始（buildList 会沿用当前位置）
    $('#panel').className = '';
    renderQuiz($('#panel'));
    scrollTo({ top: $('#bar').offsetTop, behavior: calm ? 'auto' : 'smooth' });
  }
  function roundEnd(panel) {
    const R = S.round, n = R.ids.length, right = R.ids.filter(id => R.res[id] === 1).length, missed = R.ids.filter(id => R.res[id] === 0), skipped = R.ids.filter(id => R.res[id] == null).length;
    const say = right === n ? '全对！这一轮完美 💯' : right >= n * .8 ? '很稳 😎 错的几道看看考点卡。' : right >= n * .6 ? '还不错 🙂 把错的弄懂就行。' : '这轮当热身 🫂 错的看一眼解析再来。';
    panel.innerHTML = `<div class="round-end">
      <div class="big num">${right}<small> / ${n}</small></div><h2>${say}</h2>
      ${skipped ? `<p>跳过了 ${skipped} 道。</p>` : ''}
      ${missed.length ? `<p>这轮错的（点题号再看一遍）：</p><div class="refs">${missed.map(id => `<button class="ref num miss" type="button" data-q="${esc(id)}">${esc(id)}</button>`).join('')}</div>` : ''}
      <div class="acts"><button class="btn btn-b" type="button" id="roundAgain">再来 10 题 ⚡</button><button class="btn btn-ghost" type="button" id="roundExit">回到刷题</button></div></div>`;
    $('#roundAgain').onclick = startRound;
    $('#roundExit').onclick = () => { S.round = null; panel.className = 'quiz-panel'; renderQuiz(panel); };
    panel.onclick = e => { const r = e.target.closest('.ref[data-q]'); if (r) { S.round = null; goQuiz(r.dataset.q); } };
    if (right >= n * .8) { const r = panel.querySelector('.big').getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + 20, 30, 300); }
  }
  function renderQuiz(panel, rebuild) {
    const d = S.d, f = S.p.f;
    panel.onclick = null;
    if (S.round) {
      if (S.round.done) { roundEnd(panel); return; }
      panel.innerHTML = `<div class="round-top"><span><b>⚡ 来 10 题</b><small>做完看这一轮的成绩</small></span><button class="btn btn-ghost sm" type="button" id="roundQuit">不做了</button></div>
        <div id="quiz"></div>
        <div class="qnav" id="qnav"><button class="btn btn-ghost" type="button" id="prevQ">上一题</button><button class="btn btn-b" type="button" id="nextQ">下一题</button></div>`;
      $('#roundQuit').onclick = () => { S.round = null; panel.className = 'quiz-panel'; renderQuiz(panel); toast('好，回到正常刷题 👌', { bottom: true, ms: 2000 }); };
      $('#prevQ').onclick = () => { if (S.cur > 0) { S.cur--; paintQuestion(); } };
      $('#nextQ').onclick = nextQuestion;
      buildList(); paintQuestion(); return;
    }
    const chs = d.chapters.filter(c => !c.appendix).map(c => [c.id, c.title, d.quiz.filter(q => q.ch === c.id && (f.stop || q.st !== 'stop')).length]).filter(c => c[2]);
    const srcs = [...new Set(d.quiz.map(q => q.src))];
    const sts = [['ok', '只看有依据'], ['q', '只看未核实'], ['warn', '只看看条件']].map(([k, t]) => [k, t, d.quiz.filter(q => q.st === k).length]).filter(x => x[2]);
    const nDue = dueIds(S.p, S.qMap).length;
    panel.innerHTML = `<div class="qside">
      ${nDue && f.mode !== 'due' ? `<button class="review-cta" type="button" id="dueGo"><span class="ico">📅</span><span class="t"><strong>今日复习 <span class="num">${nDue}</span> 道</strong><small>以前做错的题，隔 1、3、7 天各考一次</small></span>${icon('right')}</button>` : ''}
      <div class="filters wrapf">
        <span class="sel"><select id="fCh" aria-label="按章节筛选"><option value="">全部章节</option>${chs.map(([id, t, n]) => `<option value="${esc(id)}"${f.ch === id ? ' selected' : ''}>${esc(id)} ${esc(t)}（${n}）</option>`).join('')}</select></span>
        ${srcs.length > 1 ? `<span class="sel"><select id="fSrc" aria-label="按来源筛选"><option value="">全部来源</option>${srcs.map(s => `<option${f.src === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></span>` : ''}
        ${sts.length > 1 ? `<span class="sel"><select id="fSt" aria-label="按可信度筛选"><option value="">全部可信度</option>${sts.map(([k, t, n]) => `<option value="${k}"${f.stt === k ? ' selected' : ''}>${t}（${n}）</option>`).join('')}</select></span>` : ''}
        <button class="chip" type="button" data-mode="fresh" aria-pressed="${f.mode === 'fresh'}">没做过的</button>
        <button class="chip" type="button" data-mode="wrong" aria-pressed="${f.mode === 'wrong'}">错题本</button>
        ${nDue || f.mode === 'due' ? `<button class="chip" type="button" data-mode="due" aria-pressed="${f.mode === 'due'}">📅 今日复习 <span class="n num" id="nDue">${nDue}</span></button>` : ''}
        <button class="chip" type="button" id="fRand" aria-pressed="${!!f.rand}">🎲 随机顺序</button>
        <button class="chip" type="button" id="fStop" aria-pressed="${!!f.stop}">显示不计分题</button>
      </div>
      <button class="round-cta" type="button" id="roundGo"><span class="ico">⚡</span><span class="t"><strong>来 10 题</strong><small>从上面这个范围抽 10 道，先抽没做过的</small></span>${icon('right')}</button>
      <button class="btn btn-ghost sm weak-btn" type="button" id="weakGo">📊 哪几章最弱？</button>
      </div><div class="qmain">
      <div id="quiz"></div>
      <div class="qnav" id="qnav">
        <button class="btn btn-ghost" type="button" id="prevQ">上一题</button>
        <button class="btn btn-b" type="button" id="nextQ">下一题</button>
      </div></div>`;
    $('#roundGo').onclick = startRound;
    $('#weakGo').onclick = showWeak;
    $('#dueGo')?.addEventListener('click', () => startDue());
    const refilter = () => { S.p.last = S.list[S.cur] || S.p.last; save(); buildList(); paintQuestion(); };
    $('#fCh').onchange = e => { f.ch = e.target.value; refilter(); };
    $('#fSrc') && ($('#fSrc').onchange = e => { f.src = e.target.value; refilter(); });
    $('#fSt') && ($('#fSt').onchange = e => { f.stt = e.target.value; refilter(); toast(`${e.target.selectedOptions[0].textContent.replace(/（\d+）/, '')}：${S.list.length} 道`, { bottom: true, ms: 2200 }); flash($('#quiz')); });
    $$('[data-mode]', panel).forEach(b => b.onclick = () => {
      f.mode = f.mode === b.dataset.mode ? '' : b.dataset.mode;
      $$('[data-mode]', panel).forEach(x => x.setAttribute('aria-pressed', f.mode === x.dataset.mode)); refilter();
      // 当前题可能没变，只有题数变了，提示一下筛出来多少道
      toast(f.mode === 'wrong' ? `只看错题：${S.list.length} 道 📕` : f.mode === 'due' ? `今日复习：${S.list.length} 道 📅 做完一道少一道。` : f.mode === 'fresh' ? `只看没做过的：${S.list.length} 道 ✏️` : `现在这个范围：${S.list.length} 道`, { bottom: true, ms: 2200 });
      flash($('#quiz'));
    });
    $('#fStop').onclick = e => { f.stop = !f.stop; e.currentTarget.setAttribute('aria-pressed', f.stop); refilter(); if (f.stop) toast('不计分的题，题目本身有问题，看看相关知识就好，不算对错 🤔', { ms: 4200 }); };
    $('#fRand').onclick = e => {
      f.rand = f.rand ? 0 : (Math.floor(Math.random() * 2147483646) + 1);
      e.currentTarget.setAttribute('aria-pressed', !!f.rand);
      buildList(); S.cur = 0; paintQuestion();
      toast(f.rand ? '题目顺序打乱了 🎲 做过的记录都还在。' : '换回原来的顺序了');
    };
    $('#prevQ').onclick = () => { if (S.cur > 0) { S.cur--; paintQuestion(); } };
    $('#nextQ').onclick = nextQuestion;
    buildList();
    paintQuestion();
  }
  function nextQuestion() {
    hideVerdict();
    if (!$('#bar') || !$('#quiz')) return; // 已经离开科目页
    if (S.round) {
      if (S.cur + 1 >= S.list.length) { S.round.done = true; renderQuiz($('#panel')); }
      else { S.cur++; paintQuestion(); }
      const top = $('#bar').offsetTop; if (scrollY > top) scrollTo({ top });
      return;
    }
    const f = S.p.f;
    if (f.mode === 'fresh' || f.mode === 'wrong' || f.mode === 'due') {
      // 这几个模式下做过 / 做对 / 复习过的题会离开列表，重算后停在原位置
      const curId = S.list[S.cur]; const keep = S.cur;
      buildList();
      const still = S.list.indexOf(curId);
      S.cur = still >= 0 ? still + 1 : keep;
      if (S.cur >= S.list.length) S.cur = 0;
    } else S.cur = (S.cur + 1) % Math.max(1, S.list.length);
    paintQuestion();
    const top = $('#bar').offsetTop; if (scrollY > top) scrollTo({ top });
  }
  function emptyQuiz() {
    const f = S.p.f;
    if (f.mode === 'wrong') return `<div class="empty"><big>🎉</big>错题本空空的！<br>${f.ch || f.src ? '这个范围里没有错题。' : '要么全对，要么还没开始刷。'}</div>`;
    if (f.mode === 'due') { const n = Object.keys(S.p.due).length; return `<div class="empty"><big>📅</big>今天该复习的题都过完了！<br>${n ? `还有 ${n} 道排在后面几天，到时候会出现在这里。` : '以后做错的题，第二天会出现在这里。'}</div>`; }
    if (f.mode === 'fresh') return `<div class="empty"><big>🏆</big>这个范围的题都做过一遍了！<br>去错题本把错的再过一遍吧。</div>`;
    return `<div class="empty"><big>🫥</big>这个范围没有题，换个筛选试试 (・_・;)</div>`;
  }
  const STATUS = { ok: ['b-ok', '有依据'], q: ['b-q', '未核实'], warn: ['b-warn', '看条件'], stop: ['b-stop', '不计分'] };
  function paintQuestion(justAnswered) {
    const box = $('#quiz'); if (!box) return;
    const nav = $('#qnav');
    if (!S.list.length) { box.innerHTML = emptyQuiz(); nav.hidden = true; return; }
    nav.hidden = false;
    if (S.cur >= S.list.length) S.cur = 0;
    const q = S.qMap[S.list[S.cur]];
    S.p.last = q.id; save();
    // 错题本里显示“上次答对”的题（模拟卷做错收进来的），直接按没做过显示，能马上重答（r16）
    // 今日复习里的题也按没做过显示（r20）
    const a0 = S.p.a[q.id], a = S.round ? (S.round.res[q.id] != null ? a0 : null) : ((S.p.f.mode === 'wrong' && a0 && a0[1]) || S.p.f.mode === 'due') && !justAnswered ? null : a0;
    const done = !!a || q.st === 'stop', b = STATUS[q.st];
    let h = `<div class="qhead"><span class="qid num">${esc(q.id)}</span><span class="src">${esc(q.src)}</span><span class="badge ${b[0]}">${b[1]}</span>
      <button class="pos num" type="button" id="posBtn" aria-label="打开题号列表">${S.cur + 1} / ${S.list.length} ${icon('grid', 'style="width:16px;height:16px"')}</button></div>
      <div class="qprog"><i style="width:${(S.cur + 1) / S.list.length * 100}%"></i></div>
      <p class="stem">${q.stem}</p><div class="opts">`;
    q.opts.forEach((o, i) => {
      let c = '';
      if (a && q.st !== 'stop') c = i === q.ans ? 'right' : i === a[0] ? 'wrong' : 'dim';
      const lack = !o;
      h += `<button class="opt ${c}${lack ? ' lack' : ''}" type="button" data-i="${i}" ${done || lack ? 'disabled' : ''}><span class="k">${L5[i]}</span><span class="tx">${lack ? '（原题缺这个选项）' : o}</span></button>`;
    });
    h += '</div>';
    if (q.st === 'stop') {
      h += `<div class="stop"><b>这道题本身有问题，不计分。</b>${q.orig ? `资料原答 ${esc(q.orig)}，仅供参考。` : ''}${q.note ? ' ' + q.note : ''}${q.ex ? `<br>可以学的：${q.ex}` : ''}${q.card ? `<br><button class="link" type="button" data-card="${esc(q.card)}">去看考点卡 ${esc(q.card)}</button>` : ''}</div>`;
    } else if (a && !justAnswered) {
      h += `<div class="done-note"><span>${a[1] ? '上次答对了 ✓' : `上次选了 ${L5[a[0]]}，正确答案 ${L5[q.ans]}`}</span><button class="btn btn-ghost sm" type="button" id="redo">${icon('redo', 'style="width:16px;height:16px"')}重做</button></div>`;
      h += explainHTML(q, a[1], true);
    }
    h += `<div class="qfoot"><button class="link" type="button" id="copyQ">📋 题目有问题？复制给${AUTHOR}</button></div>`;
    box.innerHTML = h;
    $('#copyQ').onclick = () => copyQuestion(q);
    $('#nextQ').textContent = S.round && S.cur + 1 >= S.list.length ? '看成绩 🏁' : a || q.st === 'stop' ? '下一题' : '跳过这题';
    $('#prevQ').disabled = S.cur === 0;
    $$('.opt:not([disabled])', box).forEach(o => o.onclick = () => answer(q, +o.dataset.i));
    $('#redo')?.addEventListener('click', () => { delete S.p.a[q.id]; save(); paintQuestion(); paintStats(false); });
    $('#posBtn').onclick = openGrid;
    box.querySelectorAll('[data-card]').forEach(x => x.onclick = () => goCard(x.dataset.card));
  }
  // 复制题目信息，同学发给整理的人，题号、题干、答案一次带全（r16）
  async function copyQuestion(q) {
    const text = `【复习资料反馈】${S.d.name} ${q.id}（${q.src}，${STATUS[q.st][1]}）\n${plain(q.stem)}\n` +
      q.opts.map((o, i) => `${L5[i]}. ${plain(o) || '（缺）'}`).join('\n') +
      `\n网页答案：${q.ans >= 0 ? L5[q.ans] : '不计分'}\n版本：${V}\n我觉得的问题：`;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      try { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.append(t); t.select(); ok = document.execCommand('copy'); t.remove(); } catch (_) {}
    }
    toast(ok ? `复制好了 📋 粘贴发给${AUTHOR}，后面写上你觉得哪里不对就行。` : `没复制成功 (｡•́︿•̀｡) 截个图发给${AUTHOR}也行。`, { ms: 4200 });
  }
  function explainHTML(q, ok, inline) {
    const notes = [];
    const key = !ok && !q.ex ? `<p><b>${L5[q.ans]}　${q.opts[q.ans]}</b></p>` : '';
    if (q.st === 'q') notes.push(/常考册/.test(q.src) ? '常考册是资料方题库，答案没有逐题核实，仅供参考。' : '这是资料答案，课件里没找到直接依据。');
    if (q.st === 'warn') notes.push(q.note || '这道题要看条件，答案仅供参考。');
    else if (q.note) notes.push(q.note);
    const body = `${key}${q.ex ? `<p>${q.ex}</p>` : ''}${notes.map(n => `<div class="warn">${n}</div>`).join('')}
      <div class="src">${q.card ? `<button type="button" data-card="${esc(q.card)}">看考点卡 ${esc(q.card)} →</button>` : ''}${!ok ? '<span>已收进错题本 📕</span>' : ''}</div>`;
    return inline ? `<div class="hint" style="margin-top:12px">${body}</div>` : body;
  }

  const STREAK = { 3: ['手感来了 🔥', '连着答对 3 题，保持这个节奏。'], 5: ['状态正好 ✨', '连对 5 题！这一章快拿下了。'], 10: ['稳稳的 😎', '连对 10 题，可以去试试模拟卷了。'], 20: ['停不下来 🚀', '连对 20 题，今天的你很能打。'], 30: ['传说级连对 👑', '连对 30 题！截图发给同学炫耀一下。'], 50: ['你是怎么做到的 (⊙o⊙)', `连对 50 题，${AUTHOR}也服了。`] };
  const QUART = { 25: ['刷完四分之一 🎯', '继续，后面的题会越来越眼熟。'], 50: ['过半了！🎉', '一半的题都见过了，错题本记得翻。'], 75: ['还剩四分之一 🏃', '冲刺阶段，把错题再刷一遍。'], 100: ['全部刷完！🏆', '每道题都做过一遍了，去做模拟卷检验一下。'] };
  function answer(q, i) {
    const ok = i === q.ans;
    const before = stats();
    const v0 = visit, later = (fn, ms) => setTimeout(() => { if (visit === v0 && $('#quiz')) fn(); }, ms);
    const wasWrong = S.p.wrong.includes(q.id), wasDue = isDue(S.p, q.id);
    S.p.a[q.id] = [i, ok ? 1 : 0];
    if (ok) schedRight(S.p, q.id); else schedWrong(S.p, q.id);
    logDay(S.p, 'n'); if (ok) logDay(S.p, 'r'); if (ok && wasDue) logDay(S.p, 'rv');
    if (S.round) S.round.res[q.id] = ok ? 1 : 0;
    S.p.h.push(ok ? 1 : 0); if (S.p.h.length > 400) S.p.h = S.p.h.slice(-400);
    S.p.streak = ok ? before.streak + 1 : 0;
    if (ok) S.p.wrong = S.p.wrong.filter(x => x !== q.id); else if (!wasWrong) S.p.wrong.push(q.id);
    const s = stats();
    const newBest = s.streak > (S.p.best || 0);
    if (newBest) S.p.best = s.streak;
    save();
    paintQuestion(true);
    const nDue = dueIds(S.p, S.qMap).length, nd = $('#nDue'); if (nd) nd.textContent = nDue;
    if (wasDue && !nDue && S.p.f.mode === 'due' && !S.round) later(() => showCheer('📅', '今日复习完成！', '以前错过的题今天又过了一遍，明天见。', 'var(--b)', 'var(--y)', true, '收工 / 接着刷'), 900);
    if (!ok) $(`#quiz .opt[data-i="${i}"]`)?.classList.add('shake');
    paintStats(ok);
    // 对错条
    const lucky = ok && Math.random() < 1 / 40;
    const hr = new Date().getHours(), owl = ok && !lucky && hr >= 3 && hr < 6 && Math.random() < 1 / 3;
    const head = lucky ? ['幸运题！🍀', '★'] : owl ? ['夜猫子加成 🦉', null] : ok ? [pick(['答对了！', '漂亮！✨', '稳！😎', '就是这个！👍', '对啦！(๑•̀ㅂ•́)و', '好耶！🎉']), null] : [`正确答案是 ${L5[q.ans]}`, null];
    $('#verdictIn').innerHTML = `<div class="head"><i>${head[1] ? `<b>${head[1]}</b>` : icon(ok ? 'check' : 'x')}</i>${head[0]}</div>
      ${lucky ? '<p>这题被你抽中了隐藏的好运 🍀 下一题也会对的。</p>' : ''}${explainHTML(q, ok, false)}
      ${ok && wasWrong ? '<div class="warn" style="color:var(--ok)">这题拿下了 💪 已经移出错题本。</div>' : ''}
      ${ok && wasDue ? `<div class="warn" style="color:var(--ok)">${S.p.due[q.id] ? `复习过关 📅 ${GAPS[S.p.due[q.id][0]]} 天后再考你一次。` : '这题隔天复习全过了，毕业 🎓'}</div>` : !ok ? '<div class="warn">明天它会出现在“今日复习”里 📅</div>' : ''}
      <button class="btn ${lucky ? 'btn-y' : ok ? 'btn-ok' : 'btn-c'}" type="button" id="goNext" style="width:100%;margin-top:14px">继续</button>`;
    $$('#verdictIn [data-card]').forEach(x => x.onclick = () => goCard(x.dataset.card));
    const v = $('#verdict'); v.className = 'verdict ' + (lucky ? 'lucky' : ok ? 'ok' : 'no');
    document.body.classList.add('has-verdict');
    requestAnimationFrame(() => v.classList.add('on'));
    $('#goNext').onclick = nextQuestion;
    later(() => $('#goNext')?.focus({ preventScroll: true }), 300);
    const qtop = $('#quiz').getBoundingClientRect().top + scrollY - $('#bar').offsetHeight - 6;
    if (scrollY < qtop - 40 || scrollY > qtop + 80) scrollTo({ top: qtop, behavior: calm ? 'auto' : 'smooth' });
    if (ok) {
      const r = $('#verdict .head i').getBoundingClientRect();
      later(() => confetti(r.left + 17, innerHeight - (v.offsetHeight || 220) + 30, lucky ? 40 : 16, lucky ? 360 : 220, lucky ? GOLD : COLS), 200);
      const m = STREAK[s.streak];
      if (m) later(() => showCheer(`${s.streak}<small>连对</small>`, m[0], m[1], 'var(--y)', 'var(--c)', true), 650);
      else if (newBest && s.streak >= 5 && s.streak > before.streak) later(() => toast(`新纪录！连对 ${s.streak} 题 🔥`, { y: true }), 500);
    }
    if (s.done > before.done && s.done % 100 === 0) later(() => toast(`这是你在${S.d.name}刷的第 ${s.done} 道题 💯`, { y: true, ms: 4200 }), 700);
    const b4 = before.done / before.total * 100, af = s.done / s.total * 100;
    for (const qq of [25, 50, 75, 100]) if (b4 < qq && af >= qq) { const m = QUART[qq]; later(() => showCheer(`${qq}<small>%</small>`, m[0], m[1], 'var(--m)', 'var(--p)', true), 900); }
  }
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  function hideVerdict() { $('#verdict')?.classList.remove('on'); document.body.classList.remove('has-verdict'); }
  function openGrid() {
    const btns = S.list.map((id, n) => {
      const q = S.qMap[id], a = S.p.a[id];
      const c = q.st === 'stop' ? 's' : a ? (a[1] ? 'r' : 'w') : '';
      return `<button type="button" class="num ${c}${n === S.cur ? ' cur' : ''}" data-n="${n}" aria-label="第 ${n + 1} 题">${n + 1}</button>`;
    }).join('');
    openSheet(`<h2 id="sheetTitle">题号列表 🗂️</h2><p>点题号直接跳过去。现在这个范围有 ${S.list.length} 道题。</p>
      <div class="legend"><span><i style="background:var(--ok)"></i>答对</span><span><i style="background:var(--c)"></i>答错</span><span><i style="border:2px solid var(--line)"></i>没做</span><span><i style="border:2px dashed var(--line)"></i>不计分</span></div>
      <div class="qgrid">${btns}</div>`);
    sheet.querySelector('.qgrid').onclick = e => { const b = e.target.closest('[data-n]'); if (!b) return; S.cur = +b.dataset.n; closeSheet(); hideVerdict(); paintQuestion(); };
    sheet.querySelector('.cur')?.scrollIntoView({ block: 'center' });
  }
  // 今日复习（r20）：刷题区切到“今日复习”，范围筛选清空，免得有题被筛掉
  function startDue() {
    const n = dueIds(S.p, S.qMap).length;
    if (!n) { toast('今天没有要复习的错题 🎉', { y: true }); return; }
    S.round = null;
    S.p.f = { ch: '', src: '', mode: 'due', stop: false, rand: S.p.f.rand || 0 };
    setTab(2, false, true);
    scrollTo({ top: $('#bar').offsetTop, behavior: calm ? 'auto' : 'smooth' });
    flash($('#quiz'));
    toast(`今日复习：${n} 道 📅 做完一道少一道。`, { bottom: true });
  }

  /* ───── 章节弱项表（r20）：按章算做了几道、对了几成；做满 5 道的章才排“最该补” ───── */
  function chapterStats() {
    return S.d.chapters.filter(c => !c.appendix).map(c => {
      const qs = S.d.quiz.filter(q => q.ch === c.id && q.st !== 'stop');
      const ans = qs.filter(q => S.p.a[q.id]), right = ans.filter(q => S.p.a[q.id][1]).length;
      return { c, total: qs.length, done: ans.length, right, rate: ans.length ? Math.round(right / ans.length * 100) : null };
    }).filter(x => x.total);
  }
  const rateCls = r => r == null ? 'none' : r < 60 ? 'bad' : r < 80 ? 'mid' : 'good';
  function showWeak() {
    const rows = chapterStats();
    const weak = rows.filter(x => x.done >= 5 && x.rate < 80).sort((a, b) => a.rate - b.rate || b.done - a.done).slice(0, 3);
    const enough = rows.some(x => x.done >= 5);
    const rowHTML = x => `<button class="wk-row" type="button" data-ch="${esc(x.c.id)}">
        <span class="wk-no num">${esc(x.c.id)}</span>
        <span class="wk-t"><strong>${esc(x.c.title)}</strong><small>${x.done ? `做了 ${x.done} / ${x.total}，对了 ${x.right}` : `${x.total} 道，还没做`}</small>
          <span class="wk-bar"><i class="${rateCls(x.rate)}" style="width:${x.rate ?? 0}%"></i></span></span>
        <span class="wk-rate num ${rateCls(x.rate)}">${x.rate == null ? '—' : x.rate + '<em>%</em>'}</span></button>`;
    openSheet(`<h2 id="sheetTitle">哪几章最弱？📊</h2>
      <p>${!enough ? '每章做满 5 道才排得出来，先多刷几道再来看 (・ω・)' : weak.length ? '这几章错得最多，先补它们最划算：' : '做过 5 道以上的章正确率都过 80% 了，很稳 😎'}</p>
      ${weak.length ? `<div class="wk-top">${weak.map(x => `<div class="wk-pick"><span><b>${esc(x.c.id)} ${esc(x.c.title)}</b><small>正确率 ${x.rate}%（${x.done} 道）</small></span>
        <span class="wk-acts"><button class="btn btn-b sm" type="button" data-ch="${esc(x.c.id)}">刷这章</button><button class="btn btn-ghost sm" type="button" data-chap="${esc(x.c.id)}">看考点</button></span></div>`).join('')}</div>` : ''}
      <h3 class="grid-part">全部章节<small>　点一章只刷这章</small></h3>
      <div class="wk-list">${rows.map(rowHTML).join('')}</div>
      <div class="legend"><span><i style="background:var(--c)"></i>60% 以下</span><span><i style="background:var(--y)"></i>60–79%</span><span><i style="background:var(--ok)"></i>80% 以上</span></div>`);
    sheet.onclick = e => {
      const b = e.target.closest('[data-ch],[data-chap]'); if (!b) return;
      closeSheet();
      if (b.dataset.chap) { goChapter(b.dataset.chap); return; }
      S.round = null;
      S.p.f = { ch: b.dataset.ch, src: '', mode: '', stop: false, rand: S.p.f.rand || 0 };
      setTab(2, false, true);
      scrollTo({ top: $('#bar').offsetTop, behavior: calm ? 'auto' : 'smooth' });
      flash($('#quiz'));
      toast(`只刷第 ${b.dataset.ch} 章：${S.list.length} 道 ✏️ 换回全部章节在上面的下拉框里。`, { bottom: true, ms: 3600 });
    };
  }

  function goQuiz(id) {
    const q = S.d.quiz.find(x => x.id === id); if (!q) return;
    const f = S.p.f;
    const fits = (f.stop || q.st !== 'stop') && (!f.ch || q.ch === f.ch) && (!f.src || q.src === f.src) && (!f.stt || q.st === f.stt) && !f.mode;
    if (!fits) S.p.f = { ch: '', src: '', mode: '', stop: q.st === 'stop' || f.stop, rand: f.rand || 0 };
    S.p.last = id; save();
    setTab(2, false);
    scrollTo({ top: $('#bar').offsetTop });
    flash($('#quiz'));
  }

  // 从模拟卷解析跳到背诵栏的某道题，并展开答案（r16）
  function goSubj(id) {
    closeExam(); closeSheet();
    setTab(3, false);
    const sq = $(`.sq[data-id="${CSS.escape(id)}"]`); if (!sq) return;
    sq.classList.add('open');
    sq.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' }); flash(sq);
  }

  /* ═════════════ 主观题（背诵） ═════════════ */
  function renderSubj(panel) {
    const sj = S.d.subjective, got = new Set(S.p.got);
    const all = sj.groups.flatMap(g => g.items.filter(i => i.id).map(i => i.id));
    const n = all.filter(id => got.has(id)).length;
    panel.innerHTML = `
      <div class="subj-top"><span class="got">已背会 <span class="num" id="gotN">${n}</span> / ${all.length}</span><button class="btn btn-ghost sm" type="button" id="openAll">答案全部展开</button></div>
      ${sj.intro ? `<details class="hint"><summary><b>这些题怎么背？</b></summary><div class="md">${sj.intro}</div></details>` : ''}
      ${sj.groups.map(g => `<h2 class="group-title">${esc(g.title)}</h2>${g.note ? `<div class="group-note md">${g.note}</div>` : ''}
        <div class="sq-list">${g.items.map(it => `<article class="sq${got.has(it.id) ? ' got' : ''}" data-id="${esc(it.id)}">
          ${it.id ? `<span class="sid num">${esc(it.id)}</span>` : ''}<h3>${esc(it.title)}</h3>
          <button class="btn btn-ghost reveal" type="button">${icon('eye')}先背一遍，再点开看答案</button>
          <div class="ans"><div class="md">${it.html}</div>
            <div class="acts"><button class="btn btn-ghost sm" type="button" data-fold>收起答案</button>${it.id ? `<button class="btn sm ${got.has(it.id) ? 'btn-ok' : 'btn-ghost'}" type="button" data-got>${got.has(it.id) ? '✓ 背会了' : '我背会了'}</button>` : ''}</div></div>
        </article>`).join('')}</div>`).join('')}`;
    let allOpen = false;
    $('#openAll').onclick = () => { allOpen = !allOpen; $$('.sq', panel).forEach(s => s.classList.toggle('open', allOpen)); $('#openAll').textContent = allOpen ? '答案全部收起' : '答案全部展开'; };
    panel.onclick = e => {
      const sq = e.target.closest('.sq'); if (!sq) return;
      if (e.target.closest('.reveal')) sq.classList.add('open');
      else if (e.target.closest('[data-fold]')) { sq.classList.remove('open'); if (sq.getBoundingClientRect().top < 0) sq.scrollIntoView({ block: 'start' }); }
      else if (e.target.closest('[data-got]')) {
        const id = sq.dataset.id, set = new Set(S.p.got), btn = e.target.closest('[data-got]');
        if (set.has(id)) set.delete(id); else set.add(id);
        S.p.got = [...set];
        const on = set.has(id); logDay(S.p, 'got', on ? 1 : -1); save(); sq.classList.toggle('got', on);
        btn.className = `btn sm ${on ? 'btn-ok' : 'btn-ghost'}`; btn.textContent = on ? '✓ 背会了' : '我背会了';
        const k = all.filter(x => set.has(x)).length; $('#gotN').textContent = k;
        if (on) {
          const r = btn.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top, 12, 160);
          if (k === all.length) setTimeout(() => showCheer('🎓', '全部背会了！', `${all.length} 道主观题都过了一遍，考场上写出来就是分。`, 'var(--p)', 'var(--y)', true), 400);
          else if (k % 10 === 0) toast(`已经背会 ${k} 道了，记忆力满分 🧠`, { y: true });
        }
      }
    };
  }

  /* ═════════════ 自主期末测试 ═════════════ */
  const examEl = $('#exam');
  let E = null; // 当前测试
  const examKey = () => progressKey(S.slug) + ':exam';
  function choiceQs(ex) { return ex.parts.flatMap(p => p.qs.filter(q => q.opts.length).map(q => ({ q, score: p.score || 1 }))); }
  function openExamStart() {
    hideVerdict();
    const ex = S.d.exam, saved = store.get(examKey(), null);
    const nChoice = choiceQs(ex).length;
    const unfinished = saved && !saved.sub, answered = unfinished ? Object.keys(saved.ans || {}).length : 0;
    openSheet(`<h2 id="sheetTitle">${esc(ex.title || '自主期末测试')}</h2>
      <div class="exam-intro"><div class="md">${ex.intro}</div></div>
      <p>单选做完交卷自动判分；主观题写在草稿纸上，交卷后对照参考答案自己估分，这里不算分。${ex.minutes ? `建议 ${ex.minutes} 分钟，到点会提醒你 ⏰ 但不会强行收卷。` : ''}</p>
      <div class="acts">${unfinished
        ? `<button class="btn btn-p" type="button" id="exResume" data-focus>接着做（已答 ${answered} / ${nChoice}）</button><button class="btn btn-ghost" type="button" id="exNew">重新开始</button>`
        : `<button class="btn btn-p" type="button" id="exNew" data-focus>开始答题 ✍️</button>${saved && saved.sub ? `<button class="btn btn-ghost" type="button" id="exLast">看上次的结果（单选 ${S.p.examLast ? `${S.p.examLast.score}/${S.p.examLast.total}` : ''}）</button>` : `<button class="btn btn-ghost" type="button" data-close>再准备一下</button>`}`}</div>`);
    const fresh = () => startExam({ ans: {}, start: Date.now(), sub: false, alarmed: false });
    $('#exResume')?.addEventListener('click', () => { closeSheet(); startExam(saved); });
    $('#exLast')?.addEventListener('click', () => { closeSheet(); startExam(saved); });
    $('#exNew').onclick = () => {
      // 没交卷又答过题，重新开始前再确认一次（r16）
      if (!answered) { closeSheet(); fresh(); return; }
      openSheet(`<h2 id="sheetTitle">真的重新开始？🤔</h2><p>上次已经答了 ${answered} 道，重新开始会清掉这些作答。</p><div class="acts"><button class="btn btn-c" type="button" id="exWipe">清掉，重新开始</button><button class="btn btn-ghost" type="button" id="exBack" data-focus>不了，接着做</button></div>`);
      $('#exWipe').onclick = () => { closeSheet(); fresh(); };
      $('#exBack').onclick = () => { closeSheet(); startExam(saved); };
    };
  }
  function resumeExamIfNeeded() {
    const saved = store.get(examKey(), null);
    if (saved && !saved.sub && Object.keys(saved.ans || {}).length && !ss.get('study:examAsk:' + S.slug)) {
      ss.set('study:examAsk:' + S.slug, '1');
      setTimeout(() => toast('上次的模拟卷还没交 📝 要接着做吗？', { action: ['接着做', () => startExam(saved)], ms: 7000 }), 900);
    }
  }
  const fmt = s => `${String(Math.floor(Math.abs(s) / 60)).padStart(2, '0')}:${String(Math.abs(s) % 60).padStart(2, '0')}`;
  function startExam(state) {
    const ex = S.d.exam;
    E = Object.assign({ ans: {}, start: Date.now(), sub: false, alarmed: false }, state);
    store.set(examKey(), strip(E));
    examEl.innerHTML = `<div class="etop"><div class="wrap">
        <button class="icon-btn" type="button" id="exClose" aria-label="离开测试">${icon('x')}</button>
        <div class="prog"><i id="exProg"></i></div>
        <span class="timer num" id="timer" role="timer">${fmt((ex.minutes || 0) * 60)}</span></div></div>
      <div class="ebody" id="ebody"><div class="wrap" id="exBody"></div></div>
      <div class="efoot" id="exFoot"><div class="wrap">
        <button class="btn btn-ghost" type="button" id="exGrid">${icon('grid')}答题卡</button>
        <button class="btn btn-p" type="button" id="exSubmit">交卷</button></div></div>`;
    examEl.classList.add('on'); document.body.style.overflow = 'hidden'; pushLayer();
    paintExam();
    // 回到上次看到的位置；滚动时记下来
    const eb = $('#ebody');
    if (!E.sub && E.top) setTimeout(() => { eb.scrollTop = E.top; }, 0);
    let st; eb.onscroll = () => { if (E.sub) return; clearTimeout(st); st = setTimeout(() => { E.top = eb.scrollTop; store.set(examKey(), strip(E)); }, 400); };
    $('#exClose').onclick = askLeaveExam;
    $('#exGrid').onclick = examGrid;
    $('#exSubmit').onclick = trySubmit;
    clearInterval(E.tmr); E.tmr = setInterval(tick, 1000); tick();
  }
  function askLeaveExam() {
    if (!E || E.sub) { closeExam(); return; }
    openSheet(`<h2 id="sheetTitle">先离开一下？🚪</h2><p>作答会保存在这台手机上，回来可以接着做。计时不会暂停哦 ⏱️</p><div class="acts"><button class="btn btn-p" type="button" data-close data-focus>继续答题</button><button class="btn btn-ghost" type="button" id="exLeave">先离开</button></div>`);
    $('#exLeave').onclick = () => { closeSheet(); closeExam(); };
  }
  function closeExam() { if (!examEl.classList.contains('on')) return; clearInterval(E?.tmr); examEl.classList.remove('on'); document.body.style.overflow = ''; if (S) renderSubjectCta(); releaseLayer(); }
  function renderSubjectCta() {
    const last = S.p.examLast, small = $('#openExam small');
    if (small) small.textContent = examSummary(S.d.exam) + (last ? `，上次单选 ${last.score}/${last.total}` : '');
  }
  function tick() {
    if (!E || E.sub) return;
    const ex = S.d.exam, left = (ex.minutes || 0) * 60 - Math.floor((Date.now() - E.start) / 1000);
    const t = $('#timer'); if (!t) return;
    if (!ex.minutes) { t.textContent = fmt(Math.floor((Date.now() - E.start) / 1000)); return; }
    t.textContent = (left < 0 ? '+' : '') + fmt(left);
    t.classList.toggle('over', left < 0);
    if (left <= 0 && !E.alarmed) { E.alarmed = true; store.set(examKey(), strip(E)); toast(`建议用时 ${ex.minutes} 分钟到了 ⏰ 没做完可以接着做，做完再交卷。`, { y: true, ms: 7000 }); }
  }
  // top：在卷子里看到哪儿了；end / added：交卷时间和收进错题本的题数（交卷后整份留着，能回看，r16）
  const strip = e => ({ ans: e.ans, start: e.start, sub: e.sub, alarmed: e.alarmed, top: e.top || 0, end: e.end, added: e.added });
  function paintExam() {
    const ex = S.d.exam, cq = choiceQs(ex);
    let h = '';
    if (E.sub) {
      const right = cq.filter(({ q }) => E.ans[q.n] === q.ans), wrong = cq.filter(({ q }) => E.ans[q.n] != null && E.ans[q.n] !== q.ans);
      const score = right.reduce((n, x) => n + x.score, 0), total = cq.reduce((n, x) => n + x.score, 0);
      const used = Math.floor(((E.end || Date.now()) - E.start) / 1000);
      h += `<div class="result"><small>单选得分</small><div class="big"><strong class="num">${+score.toFixed(1)}</strong><span class="num">/ ${+total.toFixed(1)}</span></div>
        <div class="row"><span>答对 ${right.length}</span><span>答错 ${wrong.length}</span><span>没做 ${cq.length - right.length - wrong.length}</span><span>用时 ${fmt(used)}</span></div>
        <p>${ex.parts.some(p => p.qs.some(q => !q.opts.length)) ? '主观题请对照下面的参考答案自己估分，这里不算分。' : ''}${E.added ? `做错的 ${E.added} 道真题已经收进错题本。` : ''}</p></div>`;
    }
    for (const p of ex.parts) {
      h += `<div class="part">${esc(p.title)}</div>`;
      for (const q of p.qs) {
        const a = E.ans[q.n];
        h += `<article class="eq" id="eq${q.n}"><p class="stem"><span class="n num">${q.n}</span>${q.stem}</p>`;
        if (q.opts.length) {
          h += '<div class="opts">' + q.opts.map((o, i) => {
            let c = ''; if (E.sub) c = i === q.ans ? 'right' : i === a ? 'wrong' : 'dim'; else if (i === a) c = 'picked';
            return `<button class="opt ${c}" type="button" data-n="${q.n}" data-i="${i}" ${E.sub ? 'disabled' : ''}><span class="k">${L5[i]}</span><span class="tx">${o}</span></button>`;
          }).join('') + '</div>';
          if (E.sub) h += `<div class="exp"><b>${a === q.ans ? '答对了' : a == null ? '没做' : '答错了'}，正确答案 ${L5[q.ans]}。</b>${q.ex || ''}${q.src ? `<span class="src">${q.src}</span>` : ''}</div>`;
        } else {
          h += E.sub ? `<div class="exp"><b>参考答案${q.ref ? ' ' + q.ref : ''}：</b>${q.ex || '见背诵栏目。'}${q.src ? `<span class="src">${q.src}</span>` : ''}</div>`
            : `<div class="draft">写在草稿纸上，交卷后对照参考答案。</div>`;
        }
        h += '</article>';
      }
    }
    if (E.sub && ex.tip) h += `<div class="hint md">${ex.tip}</div><button class="btn btn-p" type="button" id="exAgain" style="width:100%;margin-top:6px">再做一遍</button>`;
    $('#exBody').innerHTML = h;
    $('#exFoot').hidden = E.sub;
    $('#exProg').style.width = (E.sub ? 100 : Object.keys(E.ans).length / Math.max(1, cq.length) * 100) + '%';
    $$('#exBody .opt:not([disabled])').forEach(o => o.onclick = () => {
      E.ans[o.dataset.n] = +o.dataset.i; store.set(examKey(), strip(E));
      const art = o.closest('.eq'); $$('.opt', art).forEach(x => x.classList.toggle('picked', x === o));
      $('#exProg').style.width = Object.keys(E.ans).length / cq.length * 100 + '%';
    });
    $('#exAgain')?.addEventListener('click', () => startExam({ ans: {}, start: Date.now(), sub: false, alarmed: false }));
    $$('#exBody [data-subj]').forEach(b => b.onclick = () => goSubj(b.dataset.subj));
    if (E.sub) { clearInterval(E.tmr); $('#timer').textContent = '已交卷'; $('#timer').classList.remove('over'); }
  }
  function examGrid() {
    const cq = choiceQs(S.d.exam);
    // 按部分列出全部题号，主观题也能直接跳过去（r16）
    openSheet(`<h2 id="sheetTitle">答题卡</h2><p>单选已答 ${Object.keys(E.ans).length} / ${cq.length}，点题号跳过去。</p>
      <div id="egrid">${S.d.exam.parts.map(p => `<h3 class="grid-part">${esc(p.title.replace(/（.*$/, ''))}</h3><div class="qgrid">${p.qs.map(q => `<button type="button" class="num ${!q.opts.length ? 's' : E.ans[q.n] != null ? 'd' : ''}" data-n="${q.n}">${q.n}</button>`).join('')}</div>`).join('')}</div>`);
    sheet.querySelector('#egrid').onclick = e => { const b = e.target.closest('[data-n]'); if (!b) return; closeSheet(); $('#eq' + b.dataset.n)?.scrollIntoView({ block: 'start' }); };
  }
  function trySubmit() {
    const cq = choiceQs(S.d.exam), left = cq.length - Object.keys(E.ans).length;
    if (left > 0) {
      openSheet(`<h2 id="sheetTitle">还有 ${left} 道单选没做 👀</h2><p>没做的按错算。要先回去补完吗？</p><div class="acts"><button class="btn btn-p" type="button" data-close data-focus>回去补完</button><button class="btn btn-ghost" type="button" id="subAnyway">就这样交卷</button></div>`);
      $('#subAnyway').onclick = () => { closeSheet(); submitExam(); };
    } else submitExam();
  }
  function submitExam() {
    E.sub = true; E.end = Date.now();
    const cq = choiceQs(S.d.exam);
    const right = cq.filter(({ q }) => E.ans[q.n] === q.ans);
    const score = right.reduce((n, x) => n + x.score, 0), total = cq.reduce((n, x) => n + x.score, 0);
    S.p.examLast = { score: +score.toFixed(1), total: +total.toFixed(1), at: Date.now() };
    // 做错的真题收进刷题区的错题本（测试卷里的改编题没有对应题号，不收）
    let added = 0;
    for (const { q } of cq) {
      if (E.ans[q.n] == null) continue; // 没做的题不算做错，不收进错题本（r17）
      const right = E.ans[q.n] === q.ans;
      for (const tok of plain(q.src || '').match(/[A-Z]*\d*-?[A-Z]?\d+(?:-[A-Z]?\d+)?/g) || []) {
        if (!S.qMap[tok] || S.qMap[tok].st === 'stop') continue;
        if (right) { S.p.wrong = S.p.wrong.filter(x => x !== tok); schedRight(S.p, tok); } // 模拟卷里做对了，也移出错题本（r16）
        else { schedWrong(S.p, tok); if (!S.p.wrong.includes(tok)) { S.p.wrong.push(tok); added++; } } // 做错的明天进今日复习（r20）
        break;
      }
    }
    E.added = added;
    logDay(S.p, 'n', 0); S.p.log[dayKey()].ex = [S.p.examLast.score, S.p.examLast.total]; // 收工卡上写一笔（r20）
    save(); store.set(examKey(), strip(E));
    paintExam(); paintStats(false); $('#ebody').scrollTop = 0;
    const pct = total ? Math.round(score / total * 100) : 0;
    const m = pct === 100 ? ['满分！💯', '一道没错，这一套已经完全拿下了。', 'var(--y)', 'var(--p)', true]
      : pct >= 90 ? ['学霸本霸 😎', '只错了零星几道，看完解析就是满分。', 'var(--y)', 'var(--p)', true]
      : pct >= 80 ? ['稳了 👍', '大部分都会了，错的几道再看一眼解析。', 'var(--m)', 'var(--y)', true]
      : pct >= 60 ? ['及格了 🙂', '基础已经打好，把错题弄懂还能再涨一截。', 'var(--b)', 'var(--y)', false]
      : ['先别慌 🫂', '这次就当摸底，看完解析，下一遍会好很多。', 'var(--c)', 'var(--b)', false];
    setTimeout(() => showCheer(`${pct}<small>分</small>`, m[0], `单选折合百分制。${m[1]}`, m[2], m[3], m[4], '看解析'), 350);
  }

  /* ═════════════ 启动 ═════════════ */
  function route() {
    closeSheet(); closeCheer(); hideVerdict(); visit++;
    if (examEl.classList.contains('on')) closeExam();
    const slug = decodeURIComponent(location.hash.slice(1));
    if (!slug) renderHome(); else renderSubject(slug);
  }
  (async () => {
    try { INDEX = await getJSON('/study-data/index.json'); }
    catch (_) {
      app.innerHTML = `<div class="wrap"><div class="empty"><big>📡</big>没连上网 (；′⌒｀) 复习资料没加载出来。<br>联网后刷新一下就好。<br><br><button class="btn btn-b" type="button" onclick="location.reload()">刷新</button></div></div>`;
      return;
    }
    addEventListener('hashchange', route);
    route();
    if (!prefs.welcomed) setTimeout(() => showWelcome(true), 500);
    else nightCheck();
    // 离线包跟着版本更新
    if (prefs.offline === 'yes' && prefs.offlineV !== V) enableOffline(true);
  })();
})();
