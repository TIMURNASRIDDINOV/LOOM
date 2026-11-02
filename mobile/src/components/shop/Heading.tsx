import React from 'react'
import { Text, type StyleProp, type TextStyle } from 'react-native'

/** `T` with the header role, so screen readers can jump between a screen's titles and sections. */
export function Heading({ style, children }: { style?: StyleProp<TextStyle>; children?: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" allowFontScaling={false} style={style}>
      {children}
    </Text>
  )
}
