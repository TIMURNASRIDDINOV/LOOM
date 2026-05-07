'use strict';
(function () {
  const STATUS_LABELS = {
    pending:    { label: 'Ожидает',    bg: 'rgba(234,179,8,0.15)',   color: '#facc15' },
    confirmed:  { label: 'Подтверждён', bg: 'rgba(59,130,246,0.15)',  color: '#60a5fa' },
    processing: { label: 'В работе',   bg: 'rgba(139,92,246,0.15)',  color: '#a78bfa' },
    shipped:    { label: 'Отправлен',  bg: 'rgba(16,185,129,0.15)', color: '#4ade80' },
    delivered:  { label: 'Доставлен',  bg: 'rgba(16,185,129,0.2)',  color: '#22c55e' },
    cancelled:  { label: 'Отменён',    bg: 'rgba(239,68,68,0.12)',   color: '#f87171' },
  };

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
      ['Email',   user.email || '—'],
      ['Имя',     user.name  || '—'],
      ['Телефон', user.phone || '—'],
    ];
    container.innerHTML = rows.map(([label, val]) => `
      <div class="profile-row">
        <span class="profile-label">${label}</span>
        <span class="profile-value">${val}</span>
      </div>
    `).join('');
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

  async function init() {
    const API = window.LOOM_CONFIG?.API_BASE ?? 'https://api.looom.me';

    // Guard: redirect if not logged in
    const user = await window.LOOM_AUTH.getCurrentUser();
    if (!user) {
      window.location.href = 'login.html?redirect=account.html';
      return;
    }

    // Populate email in sidebar
    const emailEl = document.getElementById('account-email');
    if (emailEl) emailEl.textContent = user.email || '';

    // Render profile section
    const profileEl = document.getElementById('profile-rows');
    if (profileEl) renderProfile(user, profileEl);

    // Fetch orders
    const ordersEl = document.getElementById('orders-body');
    if (ordersEl) {
      ordersEl.innerHTML = '<tr><td colspan="4" style="color:rgba(255,255,255,0.35);font-size:0.82rem;padding:0.75rem">Загрузка…</td></tr>';
      try {
        const token = window.LOOM_AUTH.getToken();
        const res = await fetch(API + '/api/me/orders', {
          headers: { Authorization: 'Bearer ' + token },
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        renderOrders(data.orders || [], document.getElementById('orders-container'));
      } catch (err) {
        const c = document.getElementById('orders-container');
        if (c) c.innerHTML = '<p style="color:#f87171;font-size:0.82rem">Не удалось загрузить заказы.</p>';
      }
    }

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
