import type { useRouter } from 'expo-router'

type Router = ReturnType<typeof useRouter>

/**
 * Go back, or home when there is nothing behind us. A screen reached by a
 * deep link or as the first route after onboarding has no history, and a bare
 * `router.back()` there raises "GO_BACK was not handled" and does nothing.
 */
export function goBack(router: Router, fallback: '/' | '/catalog' | '/market' = '/') {
  if (router.canGoBack()) router.back()
  else router.replace(fallback)
}
