import React from 'react'
import { StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'

import { C, RULE, offset } from '../../theme/tokens'
import { useT } from '../../i18n'
import { useCart } from '../../state/cart'
import { Cart } from '../icons'
import { Badge, Tap } from '../ui'

/** The cart square with its count, for `BackHeader`'s `right` slot (W13), where `AppBar` is not used. */
export function CartButton() {
  const router = useRouter()
  const t = useT()
  const { count } = useCart()
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={t('common.cart')}
      style={[styles.square, offset(2)]}
      onPress={() => router.push('/cart')}
    >
      <Cart />
      {count > 0 ? <Badge count text={count} style={styles.count} /> : null}
    </Tap>
  )
}

const styles = StyleSheet.create({
  square: {
    width: 44,
    height: 44,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { position: 'absolute', top: -9, right: -9 },
})
