import React from 'react'
import { View } from 'react-native'

import { C } from '../../src/theme/tokens'
import { kicker } from '../../src/theme/type'
import { BackHeader } from '../../src/components/AppBar'
import { Centered, T } from '../../src/components/ui'
import { useT } from '../../src/i18n'

// W26 Lab history. LOOM-246 stub so the route exists in both layouts;
// LOOM-250 builds it.
export default function LabHistory() {
  const t = useT()
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <BackHeader title="LOOM Lab" />
      <Centered>
        <T style={kicker()}>{t('common.soon')}</T>
      </Centered>
    </View>
  )
}
