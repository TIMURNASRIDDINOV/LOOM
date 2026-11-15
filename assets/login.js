'use strict';
/* login.html (LOOM-323 phase 11): sign in with a +998 phone number that
   @looom_design_bot confirms. No email, password or social login.

   Flow: phone → POST /api/auth/telegram/start → the bot opens → the
   visitor taps Start and shares the number → the webhook verifies the
   session → GET /api/auth/telegram/status says "verified" and sets the
   user_token cookie → back to ?next= (same-origin only).
   status "failed" = the shared number differs from the typed one. */
(function () {
  var POLL_MS = 2000;
  var KEY = 'loom_login_session';          // survives the trip to Telegram and back
  var tma = document.documentElement.classList.contains('tma');
  var W = window.Telegram && window.Telegram.WebApp;

  function $(id) { return document.getElementById(id); }
  function api() { return (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) || 'https://api.loomdesign.uz'; }
  function t(key, fallback) {
    try { var s = window.LOOM_I18N && window.LOOM_I18N.t(key); return s && s !== key ? s : fallback; }
    catch (e) { return fallback; }
  }
  function ss(op, v) {
    try {
      if (op === 'get') return JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (op === 'set') sessionStorage.setItem(KEY, JSON.stringify(v));
      else sessionStorage.removeItem(KEY);
    } catch (e) { return null; }
  }

  /* ?next= (or the old ?redirect=) — same origin only, never back to login */
  var next = (function () {
    var q = new URLSearchParams(location.search);
    var raw = q.get('next') || q.get('redirect');
    if (!raw) return 'account.html';
    try {
      var u = new URL(raw, location.href);
      if (u.origin !== location.origin || /\/(login|register)(\.html)?$/.test(u.pathname)) return 'account.html';
      return u.href;
    } catch (e) { return 'account.html'; }
  })();

  /* ── phone: fixed +998, the field holds 9 digits as "90 123 45 67" ── */
  function digits(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length >= 12 && d.indexOf('998') === 0) d = d.slice(3);   // pasted / autofilled +998…
    return d.slice(0, 9);
  }
  function fmt(d) {
    return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
  }
  var input = $('lg-input');
  var go = $('lg-go');
  function paintGo() { go.setAttribute('aria-disabled', digits(input.value).length === 9 ? 'false' : 'true'); }
  input.addEventListener('input', function () {
    var d = digits(input.value);
    input.value = fmt(d);
    paintGo();
    if (err) setErr(null);
  });

  /* ── messages (kept as keys so a language switch re-renders them) ── */
  var err = null;      // [key, fallback]
  var banner = null;   // phone shown in the mismatch banner
  function setErr(e) {
    err = e;
    var el = $('lg-err');
    el.hidden = !e;
    el.textContent = e ? t(e[0], e[1]) : '';
    $('lg-box').classList.toggle('atl-inp-err', !!e || !!banner);
    input.setAttribute('aria-invalid', e || banner ? 'true' : 'false');
  }
  function setBanner(phone) {
    banner = phone;
    $('lg-banner').hidden = !phone;
    $('lg-banner-tx').textContent = phone
      ? t('atl.login.mismatch', 'Raqam mos kelmadi. Siz {phone} kiritdingiz, Telegramda boshqa raqam ulashildi. To‘g‘ri raqamni kiriting yoki Telegramdagi raqamingiz bilan kiring.').replace('{phone}', phone)
      : '';
    setErr(err);
  }
  function paintS2(d) {
    $('lg-s2sub').textContent = t('atl.login.s2Sub', '{phone} raqami bilan').replace('{phone}', '+998 ' + fmt(d));
  }
  function paintTitle() {
    var h = document.querySelector('.atl-mbar h1');
    var s = t('atl.login.title', 'Kirish');
    if (h) h.textContent = s;
    document.title = 'LOOM — ' + s;
  }

  function show(step) {
    ['phone', 'wait', 'done'].forEach(function (s) { $('lg-' + s).hidden = s !== step; });
    var h = step === 'wait' ? $('lg-wait-h1') : null;
    if (h) h.focus();
  }

  /* ── open the bot ── */
  function openBot(link, win) {
    if (tma && W && W.openTelegramLink) { try { W.openTelegramLink(link); return; } catch (e) { /* fall through */ } }
    if (win) { try { win.location.href = link; return; } catch (e) { /* fall through */ } }
    try { window.open(link, '_blank', 'noopener'); } catch (e) { /* the Reopen link is the way in */ }
  }

  var busy = false;
  $('lg-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var d = digits(input.value);
    if (d.length !== 9) { setErr(['auth.errPhone', 'To‘liq telefon raqamini kiriting']); input.focus(); return; }
    setErr(null);
    setBanner(null);

    // Open the tab inside the tap: phone browsers block window.open after an await.
    var win = null;
    if (!tma) { try { win = window.open('', '_blank'); } catch (x) { win = null; } }

    busy = true;
    $('lg-go-tx').textContent = t('atl.sending', 'Yuborilmoqda…');
    fetch(api() + '/api/auth/telegram/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ phone: '+998' + d })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) { return { r: r, data: data }; });
    }).then(function (x) {
      if (!x.r.ok || !x.data.session_id) {
        if (win) try { win.close(); } catch (y) { /* already gone */ }
        setErr(x.r.status === 429
          ? ['atl.login.errRate', 'Juda ko‘p urinish. Bir necha daqiqadan keyin qayta urinib ko‘ring.']
          : ['atl.state.errT', 'Nimadir noto‘g‘ri ketdi']);
        return;
      }
      var s = { id: x.data.session_id, link: x.data.telegram_deep_link, exp: x.data.expires_at, phone: d };
      ss('set', s);
      openBot(s.link, win);
      wait(s);
    }).catch(function () {
      if (win) try { win.close(); } catch (y) { /* already gone */ }
      setErr(['atl.login.errNet', 'Internet yo‘q. Ulanishni tekshirib, qayta urinib ko‘ring.']);
    }).then(function () {
      busy = false;
      $('lg-go-tx').textContent = t('atl.login.viaTg', 'Telegram orqali davom etish');
    });
  });

  /* ── wait for the bot ── */
  var timer = null, deadline = null, session = null;
  function stop() {
    if (timer) clearInterval(timer);
    if (deadline) clearTimeout(deadline);
    timer = deadline = null;
    session = null;
    ss('del');
  }
  function wait(s) {
    session = s;
    $('lg-reopen').href = s.link;
    paintS2(s.phone);
    show('wait');
    timer = setInterval(poll, POLL_MS);
    deadline = setTimeout(expired, Math.max(0, s.exp - Date.now()));
  }
  function backToPhone(d) {
    stop();
    input.value = fmt(d || '');
    paintGo();
    show('phone');
  }
  function expired() {
    var d = session && session.phone;
    backToPhone(d);
    setErr(['reset.expired', 'Vaqt tugadi. Qaytadan urinib ko‘ring.']);
  }
  function poll() {
    if (!session) return;
    var s = session;
    // In the Mini App the cookie is third-party (Telegram Web iframe): take the token in the body.
    var url = api() + '/api/auth/telegram/status?session_id=' + encodeURIComponent(s.id) + (tma ? '&client=app' : '');
    fetch(url, { credentials: 'include' }).then(function (r) {
      if (r.status === 404) return { status: 'expired' };
      return r.json();
    }).then(function (data) {
      if (session !== s || !data) return;
      if (data.status === 'verified') signedIn(data.token);
      else if (data.status === 'failed') { backToPhone(s.phone); setBanner('+998 ' + fmt(s.phone)); input.focus(); }
      else if (data.status === 'expired' || data.status === 'used') expired();
    }).catch(function () { /* transient network error: keep polling */ });
  }
  $('lg-change').addEventListener('click', function () {
    var d = session && session.phone;
    backToPhone(d);
    input.focus();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && session) poll();
  });

  function signedIn(token) {
    stop();
    var A = window.LOOM_AUTH;
    // A stored Bearer token (old email account) would win over the new cookie.
    if (A) { if (token) A.setToken(token); else A.clearToken(); }
    show('done');
    try { window.LOOM_TRACK && window.LOOM_TRACK.event('login'); } catch (e) { /* optional */ }
    var leave = function () { location.replace(next); };
    if (A) A.getCurrentUser(true).then(function () { setTimeout(leave, 900); }, leave);
    else setTimeout(leave, 900);
  }

  /* ── start ── */
  function checkUser() {
    if (!window.LOOM_AUTH || session) return Promise.resolve();
    return window.LOOM_AUTH.getCurrentUser(true).then(function (user) {
      if (!user || session) return;
      // Only a verified phone counts: checkout sends unverified (old email) accounts here to confirm one.
      if (user.phone_verified) { location.replace(next); return; }
      if (user.phone && !input.value) { input.value = fmt(digits(user.phone)); paintGo(); }
    }, function () { /* offline: the form still works */ });
  }

  paintTitle();
  paintGo();
  var saved = ss('get');
  if (saved && saved.id && saved.exp > Date.now()) { wait(saved); poll(); }
  else { ss('del'); checkUser(); }
  // The Mini App signs the visitor in by itself (tma.js) a moment after load.
  if (tma) setTimeout(checkUser, 2500);

  window.addEventListener('loom:langchange', function () {
    paintTitle();
    setBanner(banner);
    if (session) paintS2(session.phone);
    if (!busy) $('lg-go-tx').textContent = t('atl.login.viaTg', 'Telegram orqali davom etish');
  });
})();
