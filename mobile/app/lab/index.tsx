import React from 'react'
import { View } from 'react-native'

import { C } from '../../src/theme/tokens'
import { disp, kicker } from '../../src/theme/type'
import { BackHeader } from '../../src/components/AppBar'
import { Centered, T } from '../../src/components/ui'
import { useT } from '../../src/i18n'

// W23–W29 LOOM Lab. LOOM-246 stub so the route exists in both layouts; nothing
// links here yet. LOOM-250 builds the flow behind `useLabEnabled()`.
export default function Lab() {
  const t = useT()
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <BackHeader close title="LOOM Lab" />
      <Centered>
        <T style={disp(28, 1.05, { ls: -0.03 })}>LOOM Lab</T>
        <T style={kicker()}>{t('common.soon')}</T>
      </Centered>
    </View>
  )
}
