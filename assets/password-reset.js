/* ================================================================
   LOOM — Forgot-password recovery via Telegram.
   Flow: phone → confirm in @looom_design_bot (share contact) →
   set a brand-new password. Nothing secret is ever sent over chat.
   Public API: window.LOOM_RESET.open()
================================================================ */
'use strict';
(function () {
  const API = (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) ||
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:8787' : 'https://api.loomdesign.uz');
  const T = (k, fb) => { try { return (window.LOOM_I18N ? window.LOOM_I18N.t(k) : fb) || fb; } catch (e) { return fb; } };

  let overlay = null, pollTimer = null, sessionId = null;

  function close() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (overlay) { overlay.remove(); overlay = null; }
    sessionId = null;
  }

  function step(html) {
    overlay.querySelector('#lr-body').innerHTML = html;
  }

  function open() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'lr-overlay';
    overlay.innerHTML =
      '<div class="lr-card">' +
        '<button class="lr-close" aria-label="Close">&times;</button>' +
        '<h2 class="lr-title">' + T('reset.title', 'Восстановление доступа') + '</h2>' +
        '<div id="lr-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.lr-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    phoneStep();
  }

  function phoneStep(err) {
    step(
      '<p class="lr-sub">' + T('reset.phoneHint', 'Введите номер телефона — подтвердите его в Telegram, затем задайте новый пароль.') + '</p>' +
      '<div class="lr-phone"><span class="lr-cc">+998</span><input id="lr-phone" class="lr-input" inputmode="numeric" placeholder="90 123 45 67" /></div>' +
      (err ? '<p class="lr-err">' + err + '</p>' : '<p class="lr-err"></p>') +
      '<button id="lr-start" class="lr-btn lr-btn-tg">' + T('auth.viaTelegram', 'Продолжить через Telegram') + '</button>'
    );
    const input = overlay.querySelector('#lr-phone');
    input.focus();
    overlay.querySelector('#lr-start').addEventListener('click', startReset);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') startReset(); });
  }

  async function startReset() {
    const raw = overlay.querySelector('#lr-phone').value.replace(/\D/g, '');
    const phone = '+998' + raw;
    if (phone.length < 12) { overlay.querySelector('.lr-err').textContent = T('auth.errPhone', 'Введите полный номер телефона'); return; }
    const btn = overlay.querySelector('#lr-start');
    btn.disabled = true; btn.textContent = '…';
    try {
      const res = await fetch(API + '/api/auth/telegram/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, purpose: 'reset' }),
      });
      const data = await res.json();
      if (!res.ok) { phoneStep(data.error || 'Ошибка. Попробуйте снова.'); return; }
      sessionId = data.session_id;
      window.open(data.telegram_deep_link, '_blank', 'noopener');
      waitStep(data.telegram_deep_link);
      poll(data.expires_at);
    } catch (e) {
      phoneStep('Нет соединения. Попробуйте снова.');
    }
  }

  function waitStep(deepLink) {
    step(
      '<p class="lr-sub">' + T('reset.waitHint', 'Откройте бота, нажмите «Старт» и поделитесь номером телефона. Ожидаем подтверждение…') + '</p>' +
      '<div class="lr-spinner"></div>' +
      '<a href="' + deepLink + '" target="_blank" rel="noopener" class="lr-link">' + T('reset.openBot', 'Открыть Telegram ещё раз') + '</a>'
    );
  }

  function poll(expiresAt) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!sessionId) return;
      if (Date.now() > expiresAt) { clearInterval(pollTimer); pollTimer = null; phoneStep(T('reset.expired', 'Время ожидания истекло. Попробуйте снова.')); return; }
      try {
        const res = await fetch(API + '/api/auth/telegram/status?session_id=' + encodeURIComponent(sessionId));
        const data = await res.json();
        if (data.status === 'verified') { clearInterval(pollTimer); pollTimer = null; setPasswordStep(); }
        else if (data.status === 'failed') { clearInterval(pollTimer); pollTimer = null; phoneStep(T('reset.notFound', 'Аккаунт не найден или номер не совпал.')); }
      } catch (e) { /* keep polling */ }
    }, 2500);
  }

  function setPasswordStep(err) {
    step(
      '<p class="lr-sub lr-ok">✓ ' + T('reset.verified', 'Номер подтверждён. Задайте новый пароль.') + '</p>' +
      '<input id="lr-pw1" type="password" class="lr-input" placeholder="' + T('reset.newPw', 'Новый пароль (мин. 8)') + '" />' +
      '<input id="lr-pw2" type="password" class="lr-input" style="margin-top:0.6rem" placeholder="' + T('reset.confirmPw', 'Повторите пароль') + '" />' +
      (err ? '<p class="lr-err">' + err + '</p>' : '<p class="lr-err"></p>') +
      '<button id="lr-set" class="lr-btn">' + T('reset.setBtn', 'Сохранить пароль') + '</button>'
    );
    overlay.querySelector('#lr-pw1').focus();
    overlay.querySelector('#lr-set').addEventListener('click', submitNewPassword);
  }

  async function submitNewPassword() {
    const p1 = overlay.querySelector('#lr-pw1').value;
    const p2 = overlay.querySelector('#lr-pw2').value;
    if (p1.length < 8) { overlay.querySelector('.lr-err').textContent = T('auth.errPwLen', 'Пароль должен содержать минимум 8 символов'); return; }
    if (p1 !== p2) { overlay.querySelector('.lr-err').textContent = T('reset.mismatch', 'Пароли не совпадают'); return; }
    const btn = overlay.querySelector('#lr-set');
    btn.disabled = true; btn.textContent = '…';
    try {
      const res = await fetch(API + '/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, new_password: p1 }),
      });
      const data = await res.json();
      if (!res.ok) { setPasswordStep(data.error || 'Ошибка. Попробуйте снова.'); return; }
      step(
        '<p class="lr-sub lr-ok">✅ ' + T('reset.done', 'Пароль обновлён! Теперь войдите с новым паролем.') + '</p>' +
        '<button id="lr-done" class="lr-btn">' + T('reset.toLogin', 'Войти') + '</button>'
      );
      overlay.querySelector('#lr-done').addEventListener('click', close);
    } catch (e) {
      setPasswordStep('Нет соединения. Попробуйте снова.');
    }
  }

  // Minimal styles (scoped to .lr-*) — light editorial system
  const css = document.createElement('style');
  css.textContent =
    '.lr-overlay{position:fixed;inset:0;z-index:5000;background:rgba(19,19,17,0.45);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:1.25rem}' +
    '.lr-card{width:100%;max-width:380px;background:#fff;border:1px solid rgba(19,19,17,0.16);border-radius:2px;padding:1.75rem;position:relative;font-family:"Inter",-apple-system,sans-serif;color:#131311;box-shadow:0 30px 80px rgba(19,19,17,0.18)}' +
    '.lr-close{position:absolute;top:0.6rem;right:0.8rem;background:none;border:none;color:rgba(19,19,17,0.38);font-size:1.5rem;cursor:pointer;line-height:1}' +
    '.lr-close:hover{color:#131311}' +
    '.lr-title{color:#131311;font-size:1.15rem;font-weight:600;margin:0 0 0.4rem}' +
    '.lr-sub{color:rgba(19,19,17,0.55);font-size:0.85rem;line-height:1.5;margin:0 0 1rem}' +
    '.lr-ok{color:#15803d}' +
    '.lr-phone{display:flex;gap:0.5rem;align-items:stretch}' +
    '.lr-cc{display:flex;align-items:center;padding:0 0.75rem;border:1px solid rgba(19,19,17,0.16);border-radius:2px;background:#f4f2ed;color:rgba(19,19,17,0.7);font-size:0.9rem}' +
    '.lr-input{width:100%;padding:0.7rem 0.9rem;border-radius:2px;border:1px solid rgba(19,19,17,0.16);background:#f4f2ed;color:#131311;font-family:inherit;font-size:0.9rem;outline:none}' +
    '.lr-input:focus{border-color:#131311}' +
    '.lr-err{color:#d6382d;font-size:0.78rem;min-height:1em;margin:0.5rem 0}' +
    '.lr-btn{width:100%;padding:0.8rem;border-radius:2px;border:1px solid #131311;background:#131311;color:#fff;font-family:inherit;font-size:0.8rem;font-weight:600;letter-spacing:0.04em;cursor:pointer;margin-top:0.6rem}' +
    '.lr-btn:hover:not(:disabled){background:#fc5044;border-color:#fc5044}' +
    '.lr-btn:disabled{opacity:0.5;cursor:default}' +
    '.lr-btn-tg{background:#229ED9;border-color:#229ED9;color:#fff}' +
    '.lr-btn-tg:hover:not(:disabled){background:#1b8ec2;border-color:#1b8ec2}' +
    '.lr-link{display:block;text-align:center;color:rgba(19,19,17,0.55);font-size:0.8rem;margin-top:0.9rem;text-decoration:underline}' +
    '.lr-spinner{width:34px;height:34px;border-radius:50%;border:3px solid rgba(19,19,17,0.12);border-top-color:#229ED9;animation:lrspin 0.8s linear infinite;margin:1rem auto}' +
    '@keyframes lrspin{to{transform:rotate(360deg)}}';
  document.head.appendChild(css);

  window.LOOM_RESET = { open: open };
})();
