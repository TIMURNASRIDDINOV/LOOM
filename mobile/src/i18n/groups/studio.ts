import type { Group } from '../strings'

// Studio group (LOOM-249): the design and size steps and their tool sheets.
// Add every key to ru, uz and en — a key in one language only fails `tsc`.
const ru = {
  // 3D stage states and the diagnostics overlay (LOOM-262)
  'st.unavail3d': '3D недоступно на этом устройстве.',
  'st.diagTitle': 'Диагностика 3D',
  'st.diagYes': 'да',
  'st.diagNo': 'нет',
  'st.diagNone': 'нет',
  'st.diagCanvas': 'Холст',
  'st.diagEnv': 'Карта окружения',
  'st.diagTimes': 'Время, мс',
  'st.diagTimesVal': 'скрипты {a} · модель {b} · первый кадр {c}',
  'st.diagError': 'Последняя ошибка',
}

export const studio: Group<typeof ru> = {
  ru,
  uz: {
    'st.unavail3d': '3D bu qurilmada mavjud emas.',
    'st.diagTitle': '3D diagnostikasi',
    'st.diagYes': 'ha',
    'st.diagNo': 'yo‘q',
    'st.diagNone': 'yo‘q',
    'st.diagCanvas': 'Kanvas',
    'st.diagEnv': 'Muhit xaritasi',
    'st.diagTimes': 'Vaqt, ms',
    'st.diagTimesVal': 'skriptlar {a} · model {b} · birinchi kadr {c}',
    'st.diagError': 'Oxirgi xato',
  },
  en: {
    'st.unavail3d': '3D is not available on this device.',
    'st.diagTitle': '3D diagnostics',
    'st.diagYes': 'yes',
    'st.diagNo': 'no',
    'st.diagNone': 'none',
    'st.diagCanvas': 'Canvas',
    'st.diagEnv': 'Environment map',
    'st.diagTimes': 'Timings, ms',
    'st.diagTimesVal': 'scripts {a} · model {b} · first frame {c}',
    'st.diagError': 'Last error',
  },
}
