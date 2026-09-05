// ════════════════════════════════════════════════════════════════════════════
// Admin capabilities — the single source of truth for who may do what.
//
// The admin panel renders its permission matrix from GET /api/admin/permissions
// /catalog, which serves the constants below verbatim. There is deliberately no
// second copy of this list in the frontend: a capability added here shows up in
// the owner's UI on the next page load, already labelled.
//
// MODEL
//   Each admin row carries a role (owner | manager | staff). A role maps to a
//   PRESET set of capabilities. On top of that, the owner may grant or revoke
//   individual capabilities per admin; those overrides live in admin_permissions
//   (migration 0015) and are applied over the preset:
//
//       effective = preset(role) ∪ {granted = 1} \ {granted = 0}
//
//   The owner short-circuits to "everything" and ignores overrides entirely, so
//   there is no sequence of toggles that can strip the owner of control.
//
// WHY THERE IS NO `team.manage` CAPABILITY
//   Team membership and permission editing stay gated on requireRole('owner').
//   If managing the team were itself a grantable capability, whoever held it
//   could grant themselves every other capability — the grant graph has to have
//   a root that cannot be handed out.
// ════════════════════════════════════════════════════════════════════════════

import type { AdminRole } from '../db/schema'

export const CAPABILITIES = [
  // ── Заказы ──────────────────────────────────────────────────────────────
  {
    id: 'orders.view',
    group: 'orders',
    label: 'Просматривать заказы',
    description: 'Список заказов и карточка заказа: клиент, доставка, макет.',
  },
  {
    id: 'orders.status',
    group: 'orders',
    label: 'Менять статус заказа',
    description: 'Переводить заказ между статусами и оставлять заметку в истории.',
  },
  {
    id: 'orders.approve',
    group: 'orders',
    label: 'Утверждать макет в производство',
    description: 'Подтверждать, что макет проверен. Без этого заказ нельзя перевести в «Производство».',
  },

  // ── Клиенты ─────────────────────────────────────────────────────────────
  {
    id: 'users.view',
    group: 'users',
    label: 'Просматривать клиентов',
    description: 'Список клиентов, карточка, история заказов и активности.',
  },
  {
    id: 'users.edit',
    group: 'users',
    label: 'Редактировать данные клиента',
    description: 'Имя, email, телефон и адрес доставки.',
  },
  {
    id: 'users.status',
    group: 'users',
    label: 'Блокировать клиентов',
    description: 'Закрывать и возвращать доступ к аккаунту.',
  },
  {
    id: 'users.password',
    group: 'users',
    label: 'Отправлять сброс пароля',
    description: 'Запрос на смену пароля уходит клиенту в Telegram. Пароль не виден администратору.',
  },
  {
    id: 'users.role',
    group: 'users',
    label: 'Менять роль клиента',
    description: 'Повышать клиента до привилегированной роли на сайте.',
  },

  // ── Каталог ─────────────────────────────────────────────────────────────
  {
    id: 'products.view',
    group: 'products',
    label: 'Просматривать товары',
    description: 'Каталог и карточки товаров.',
  },
  {
    id: 'products.edit',
    group: 'products',
    label: 'Редактировать товары',
    description: 'Создавать, изменять и удалять товары, цены и изображения.',
  },

  // ── Дизайнеры ───────────────────────────────────────────────────────────
  {
    id: 'artworks.view',
    group: 'artworks',
    label: 'Смотреть работы дизайнеров',
    description: 'Очередь модерации и все загруженные работы с их статусом.',
  },
  {
    id: 'artworks.review',
    group: 'artworks',
    label: 'Одобрять и отклонять работы',
    description: 'Публиковать работу в маркетплейс или вернуть её дизайнеру с причиной.',
  },

  // ── Уведомления ─────────────────────────────────────────────────────────
  {
    id: 'notifications.view',
    group: 'notifications',
    label: 'Смотреть историю отправок',
    description: 'Какие сообщения и кому уже уходили.',
  },
  {
    id: 'notifications.send',
    group: 'notifications',
    label: 'Отправлять уведомления',
    description: 'Писать клиентам в Telegram от имени магазина.',
  },

  // ── Аналитика ───────────────────────────────────────────────────────────
  {
    id: 'analytics.view',
    group: 'analytics',
    label: 'Смотреть аналитику',
    description: 'Обзор, выручка, статистика посетителей.',
  },

  // ── AI ──────────────────────────────────────────────────────────────────
  {
    id: 'ai.use',
    group: 'ai',
    label: 'Пользоваться AI-лабораторией',
    description: 'Генерация изображений. Расходует общий платный бюджет.',
  },
] as const

export type Capability = (typeof CAPABILITIES)[number]['id']

// Display order + section headings for the owner's permission matrix.
export const CAPABILITY_GROUPS = [
  { id: 'orders', label: 'Заказы' },
  { id: 'users', label: 'Клиенты' },
  { id: 'products', label: 'Каталог' },
  { id: 'artworks', label: 'Дизайнеры' },
  { id: 'notifications', label: 'Уведомления' },
  { id: 'analytics', label: 'Аналитика' },
  { id: 'ai', label: 'AI' },
] as const

export const ALL_CAPABILITIES: Capability[] = CAPABILITIES.map((c) => c.id)

// ── Role presets ────────────────────────────────────────────────────────────
// These reproduce the behaviour that shipped before migration 0015, so applying
// the migration changes nobody's access until the owner actually flips a switch.
//   manager — everything except users.role, which was owner-only.
//   staff   — everything that used to be plain requireAdmin, i.e. read access
//             plus order status (which had no role gate at all) and ai.use
//             (routes/admin-ai.ts was requireAdmin only). The owner can now
//             revoke either with one toggle — that is the point of the change.
export const ROLE_PRESETS: Record<AdminRole, Capability[]> = {
  owner: ALL_CAPABILITIES,
  manager: ALL_CAPABILITIES.filter((c) => c !== 'users.role'),
  staff: [
    'orders.view',
    'orders.status',
    'users.view',
    'products.view',
    'artworks.view',
    'notifications.view',
    'analytics.view',
    'ai.use',
  ],
}

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && (ALL_CAPABILITIES as string[]).includes(value)
}

export function presetFor(role: string): Capability[] {
  return ROLE_PRESETS[role as AdminRole] ?? ROLE_PRESETS.staff
}

// Resolve preset + overrides into the set the request is actually allowed.
// `overrides` is capability → granted (true = add, false = remove).
export function resolveCapabilities(
  role: string,
  overrides: Record<string, boolean> = {},
): Set<Capability> {
  if (role === 'owner') return new Set(ALL_CAPABILITIES)

  const effective = new Set<Capability>(presetFor(role))
  for (const [cap, granted] of Object.entries(overrides)) {
    if (!isCapability(cap)) continue
    if (granted) effective.add(cap)
    else effective.delete(cap)
  }
  return effective
}

// The catalog served to the admin panel.
export function permissionCatalog() {
  return {
    groups: CAPABILITY_GROUPS,
    capabilities: CAPABILITIES,
    presets: ROLE_PRESETS,
    roles: [
      {
        id: 'owner',
        label: 'Владелец',
        description: 'Полный доступ. Единственная роль, которая управляет командой и доступами.',
      },
      {
        id: 'manager',
        label: 'Менеджер',
        description: 'Ведёт заказы, клиентов и каталог. Права можно настроить точечно.',
      },
      {
        id: 'staff',
        label: 'Сотрудник',
        description: 'Работает с заказами и смотрит справочные данные. Права можно расширить точечно.',
      },
    ],
  }
}
