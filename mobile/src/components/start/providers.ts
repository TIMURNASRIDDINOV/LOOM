import type { ProviderId, ProviderInfo } from '../../api/oauth'

// Buttons in the order W06 draws them. A provider the Worker does not list never
// shows (no «скоро» placeholders in a store build), and Apple is iOS-only:
// Android and web have no Sign in with Apple here.
const ORDER: ProviderId[] = ['apple', 'google', 'facebook', 'discord']

export function visibleProviders(live: ProviderInfo[], os: string): ProviderId[] {
  return ORDER.filter((id) => live.some((p) => p.id === id) && (id !== 'apple' || os === 'ios'))
}
