import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { C } from '../src/theme/tokens'
import { BackHeader } from '../src/components/AppBar'
import { LanguageChoice } from '../src/components/start/LanguageChoice'
import { Button } from '../src/components/ui'
import { useT } from '../src/i18n'
import { goBack } from '../src/lib/nav'

// W02 from Account → Til. The first-launch version of this screen is step 0 of
// onboarding (app/onboarding.tsx); both render `LanguageChoice`, which applies
// and stores the pick on tap, so Save only closes.
export default function Language() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const t = useT()

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <BackHeader />
      <View style={{ flex: 1, padding: 16, paddingTop: 28 }}>
        <LanguageChoice />
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 24) }}>
        <Button title={t('common.save')} onPress={() => goBack(router)} />
      </View>
    </View>
  )
}
