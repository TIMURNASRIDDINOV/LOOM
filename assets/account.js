'use strict';
(function () {
  // These must match ORDER_STATUSES in backend/src/db/schema.ts
  const STATUS_LABELS = {
    new:        { label: 'Новый',         bg: 'rgba(59,130,246,0.15)',  color: '#60a5fa' },
    confirmed:  { label: 'Подтверждён',   bg: 'rgba(234,179,8,0.15)',   color: '#facc15' },
    producing:  { label: 'В производстве', bg: 'rgba(249,115,22,0.15)', color: '#fb923c' },
    shipped:    { label: 'Отправлен',     bg: 'rgba(168,85,247,0.15)',  color: '#c084fc' },
    delivered:  { label: 'Доставлен',     bg: 'rgba(16,185,129,0.2)',   color: '#22c55e' },
    cancelled:  { label: 'Отменён',       bg: 'rgba(239,68,68,0.12)',   color: '#f87171' },
  };

  // Orders in these statuses may still change — poll for updates
  const ACTIVE_STATUSES = new Set(['new', 'confirmed', 'producing', 'shipped']);

  function formatPrice(p) {
    return Number(p).toLocaleString('ru-RU') + ' сум';
  }

  function formatDate(ts) {
    if (!ts) return '—';
    return new Date(Number(ts)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function statusBadge(status) {
    const s = STATUS_LABELS[status] || { label: status, bg: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' };
    return `<span class="status-badge" style="background:${s.bg};color:${s.color}">${s.label}</span>`;
  }

  function renderProfile(user, container) {
    const rows = [
      ['Телефон', user.phone || '—'],
      ['Email',   (!user.email || user.email.includes('@telegram.loom')) ? '—' : user.email],
      ['Роль',    user.role || '—'],
    ];
    container.innerHTML = rows.map(([label, val]) => `
      <div class="profile-row">
        <span class="profile-label">${label}</span>
        <span class="profile-value">${val}</span>
      </div>
    `).join('');
  }

  function renderAvatar(user) {
    const initials = (user.first_name || user.name || user.phone || '?')[0].toUpperCase();
    const initialsEl = document.getElementById('avatar-initials');
    const imgEl = document.getElementById('avatar-img');
    const nameEl = document.getElementById('display-name');

    if (nameEl) nameEl.textContent = user.first_name || user.name || user.phone || '';

    if (user.avatar_url) {
      if (imgEl) { imgEl.src = user.avatar_url; imgEl.style.display = ''; }
      if (initialsEl) initialsEl.style.display = 'none';
    } else {
      if (imgEl) imgEl.style.display = 'none';
      if (initialsEl) { initialsEl.style.display = ''; initialsEl.textContent = initials; }
    }
  }

  function renderOrders(orders, container) {
    if (!orders || !orders.length) {
      container.innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:0.85rem;padding:0.5rem 0">Заказов пока нет.</p>';
      return;
    }
    container.innerHTML = `
      <table class="orders-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Дата</th>
            <th>Статус</th>
            <th style="text-align:right">Сумма</th>
          </tr>
        </thead>
        <tbody>
          ${orders.map(o => `
            <tr>
              <td>#${o.id}</td>
              <td>${formatDate(o.created_at)}</td>
              <td>${statusBadge(o.status)}</td>
              <td style="text-align:right">${formatPrice(o.total_price)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  async function fetchOrders(API, token) {
    const headers = token ? { Authorization: 'Bearer ' + token } : {}
    const res = await fetch(API + '/api/me/orders', {
      headers,
      credentials: 'include',  // needed for cookie-based (Telegram) auth
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data.orders || [];
  }

  async function fetchProfile(API, token) {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const res = await fetch(API + '/api/me', { headers, credentials: 'include' });
    if (!res.ok) return null;
    return res.json();
  }

  async function init() {
    const API = window.LOOM_CONFIG?.API_BASE ?? 'https://api.looom.me';

    // Guard: redirect if not logged in
    const user = await window.LOOM_AUTH.getCurrentUser();
    if (!user) {
      window.location.href = 'login.html?redirect=account.html';
      return;
    }

    const token = window.LOOM_AUTH.getToken();

    // Populate email in sidebar
    const emailEl = document.getElementById('account-email');
    if (emailEl) emailEl.textContent = user.phone || user.email || '';

    // Fetch full profile from /api/me (has avatar_url, role, etc.)
    let profile = user;
    try {
      const fetched = await fetchProfile(API, token);
      if (fetched) profile = fetched;
    } catch { /* use local user object */ }

    // Render avatar and profile
    renderAvatar(profile);
    const profileEl = document.getElementById('profile-rows');
    if (profileEl) renderProfile(profile, profileEl);

    // ── Avatar upload ────────────────────────────────────────────────────────
    const avatarWrap = document.getElementById('avatar-wrap');
    const avatarInput = document.getElementById('avatar-input');
    const avatarStatus = document.getElementById('avatar-status');

    if (avatarWrap && avatarInput) {
      avatarWrap.addEventListener('click', () => avatarInput.click());
      avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files && avatarInput.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
          if (avatarStatus) avatarStatus.textContent = 'Файл слишком большой (макс. 2 МБ)';
          return;
        }
        if (avatarStatus) avatarStatus.textContent = 'Загрузка…';
        try {
          const fd = new FormData();
          fd.append('file', file);
          const headers = token ? { Authorization: 'Bearer ' + token } : {};
          const res = await fetch(API + '/api/me/avatar', {
            method: 'POST',
            headers,
            body: fd,
            credentials: 'include',
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Ошибка загрузки');
          }
          const { avatar_url } = await res.json();
          profile.avatar_url = avatar_url;
          renderAvatar(profile);
          if (avatarStatus) avatarStatus.textContent = 'Фото обновлено';
          setTimeout(() => { if (avatarStatus) avatarStatus.textContent = ''; }, 3000);
        } catch (err) {
          if (avatarStatus) avatarStatus.textContent = err.message || 'Ошибка';
        }
        avatarInput.value = '';
      });
    }

    // ── Name edit ────────────────────────────────────────────────────────────
    const nameEditBtn = document.getElementById('name-edit-btn');
    const nameEditForm = document.getElementById('name-edit-form');
    const nameInput = document.getElementById('name-input');
    const nameSaveBtn = document.getElementById('name-save-btn');
    const nameCancelBtn = document.getElementById('name-cancel-btn');
    const nameSaveStatus = document.getElementById('name-save-status');

    if (nameEditBtn && nameEditForm) {
      nameEditBtn.addEventListener('click', () => {
        nameEditForm.style.display = '';
        nameEditBtn.closest('#name-display').querySelector('#display-name').style.display = 'none';
        nameEditBtn.style.display = 'none';
        if (nameInput) nameInput.value = profile.first_name || '';
        nameInput && nameInput.focus();
      });

      const cancelEdit = () => {
        nameEditForm.style.display = 'none';
        const nameDisplay = document.getElementById('display-name');
        if (nameDisplay) nameDisplay.style.display = '';
        if (nameEditBtn) nameEditBtn.style.display = '';
        if (nameSaveStatus) nameSaveStatus.textContent = '';
      };

      if (nameCancelBtn) nameCancelBtn.addEventListener('click', cancelEdit);

      if (nameSaveBtn) {
        nameSaveBtn.addEventListener('click', async () => {
          const newName = (nameInput && nameInput.value.trim()) || '';
          if (!newName) { if (nameSaveStatus) { nameSaveStatus.style.color = '#f87171'; nameSaveStatus.textContent = 'Введите имя'; } return; }
          if (nameSaveStatus) { nameSaveStatus.style.color = 'rgba(255,255,255,0.4)'; nameSaveStatus.textContent = 'Сохранение…'; }
          try {
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;
            const res = await fetch(API + '/api/me', {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ first_name: newName }),
              credentials: 'include',
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || 'Ошибка');
            }
            const updated = await res.json();
            profile.first_name = updated.first_name;
            renderAvatar(profile);
            cancelEdit();
          } catch (err) {
            if (nameSaveStatus) { nameSaveStatus.style.color = '#f87171'; nameSaveStatus.textContent = err.message || 'Ошибка'; }
          }
        });
      }

      if (nameInput) {
        nameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') nameSaveBtn && nameSaveBtn.click();
          if (e.key === 'Escape') cancelEdit();
        });
      }
    }

    const ordersContainer = document.getElementById('orders-container');

    // Initial load
    let currentOrders = [];

    try {
      currentOrders = await fetchOrders(API, token);
      if (ordersContainer) renderOrders(currentOrders, ordersContainer);
    } catch (err) {
      if (ordersContainer) ordersContainer.innerHTML = '<p style="color:#f87171;font-size:0.82rem">Не удалось загрузить заказы.</p>';
      return;
    }

    // Poll every 30 s if any order is in a non-terminal state
    let pollInterval = null;

    function hasActiveOrders(orders) {
      return orders.some(o => ACTIVE_STATUSES.has(o.status));
    }

    async function refresh() {
      try {
        const fresh = await fetchOrders(API, token);
        currentOrders = fresh;
        if (ordersContainer) renderOrders(currentOrders, ordersContainer);
        // Stop polling once all orders reach terminal state
        if (!hasActiveOrders(currentOrders) && pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      } catch {
        // ignore transient errors during background poll
      }
    }

    if (hasActiveOrders(currentOrders)) {
      pollInterval = setInterval(refresh, 30_000);
    }

    // Refetch when the tab becomes visible again
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh();
    });

    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => window.LOOM_AUTH.logout());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
