'use strict'

// Home-page hero picture (GET/PUT/DELETE /api/admin/site/hero).
;(function () {
  const { apiJSON, apiFetch } = window.LOOM
  const { toast, confirmDialog, apiErrorMessage } = window.LOOM_UI
  const DEFAULT_SRC = '/images/home/hero-khabib-tee-v1.webp'
  const MAX_BYTES = 3 * 1024 * 1024

  const el = (id) => document.getElementById(id)

  function show(hero) {
    el('hero-img').src = hero ? hero.url : DEFAULT_SRC
    el('hero-status').textContent = hero
      ? 'Сейчас на сайте ваша картинка.'
      : 'Сейчас на сайте стандартная картинка (футболка KHABIB).'
    el('hero-alt').value = hero ? hero.alt : ''
    el('hero-reset').hidden = !hero
  }

  async function send(method, body) {
    const res = await apiFetch('/api/admin/site/hero', { method, body })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(data.error || 'Не удалось сохранить.'), { status: res.status, data })
    return data.hero
  }

  el('hero-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const file = el('hero-file').files[0]
    const err = el('hero-err')
    err.textContent = ''
    if (!file) { err.textContent = 'Выберите файл.'; return }
    if (file.size > MAX_BYTES) { err.textContent = 'Файл больше 3 МБ. Сожмите его или уменьшите до 1200×1200.'; return }
    const fd = new FormData()
    fd.append('image', file)
    fd.append('alt', el('hero-alt').value.trim())
    const btn = el('hero-save')
    btn.disabled = true
    btn.textContent = 'Сохраняю…'
    try {
      show(await send('PUT', fd))
      el('hero-file').value = ''
      toast('Картинка сохранена. На сайте — в течение минуты.', 'success')
    } catch (ex) {
      err.textContent = apiErrorMessage(ex)
    } finally {
      btn.disabled = false
      btn.textContent = 'Сохранить картинку'
    }
  })

  el('hero-reset').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Вернуть стандартную картинку?',
      body: 'На главной снова будет футболка KHABIB. Вашу картинку можно будет загрузить заново.',
      confirmLabel: 'Вернуть стандартную',
    })
    if (!ok) return
    try {
      show(await send('DELETE'))
      toast('Стандартная картинка возвращена.', 'success')
    } catch (ex) {
      toast(apiErrorMessage(ex), 'error')
    }
  })

  // The nav entry and layout.js keep admins without products.edit off this page.
  LOOM_LAYOUT.onReady(() => {
    apiJSON('/api/admin/site/hero')
      .then((d) => show(d.hero))
      .catch((ex) => { el('hero-status').textContent = apiErrorMessage(ex) })
  })
})()
