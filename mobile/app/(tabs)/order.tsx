import React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'

import { C } from '../../src/theme/tokens'
import { kicker } from '../../src/theme/type'
import { BackHeader } from '../../src/components/AppBar'
import { Centered, T } from '../../src/components/ui'
import { useT } from '../../src/i18n'

// W31 order detail, `/order?id=`. LOOM-246 stub so the route exists in both
// layouts (no tab bar here); LOOM-251 builds it on `GET /api/me/orders/:id`.
export default function Order() {
  const t = useT()
  const { id } = useLocalSearchParams<{ id?: string }>()
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <BackHeader title={id ? `#LM-${id}` : undefined} />
      <Centered>
        <T style={kicker()}>{t('common.soon')}</T>
      </Centered>
    </View>
  )
}
