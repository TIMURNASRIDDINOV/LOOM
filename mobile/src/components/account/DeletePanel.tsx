import React from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { C, RULE, offset } from '../../theme/tokens'
import { body, disp } from '../../theme/type'
import { useT } from '../../i18n'
import { Trash } from '../icons'
import { T, Tap } from '../ui'

/**
 * W36: the delete-account confirmation, a bottom panel over a veiled Account.
 * "Hisobni o'chirish" opens it, "O'chirish" deletes: two taps (Apple 5.1.1(v)).
 */
export function DeletePanel({
  visible,
  busy,
  onConfirm,
  onCancel,
}: {
  visible: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useT()
  const insets = useSafeAreaInsets()
  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.veil}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} style={StyleSheet.absoluteFill} onPress={busy ? undefined : onCancel} />
        <View accessibilityViewIsModal role="dialog" aria-modal style={[styles.sheet, { paddingBottom: 30 + insets.bottom }]}>
          <View style={styles.grip} />
          <View style={styles.tile}>
            <Trash size={26} color={C.deep} width={2.2} />
          </View>
          <View style={{ gap: 10 }}>
            <T style={disp(28, 1.05, { ls: -0.03 })}>{t('acc.deleteTitle')}</T>
            <T style={body(15, 22 / 15, { color: C.i70 })}>{t('acc.deleteBody')}</T>
          </View>
          <View style={{ gap: 10, marginTop: 4 }}>
            <Tap
              accessibilityRole="button"
              accessibilityState={{ busy: !!busy, disabled: !!busy }}
              disabled={busy}
              onPress={onConfirm}
              style={[styles.btn, { backgroundColor: C.deep }, offset(2)]}
            >
              {busy ? <ActivityIndicator color={C.white} size="small" /> : <T style={disp(14, 1, { ls: 0.14, upper: true, color: C.white })}>{t('acc.deleteConfirm')}</T>}
            </Tap>
            <Tap accessibilityRole="button" disabled={busy} onPress={onCancel} style={[styles.btn, { backgroundColor: C.white }, offset(2)]}>
              <T style={disp(14, 1, { ls: 0.14, upper: true })}>{t('common.cancel')}</T>
            </Tap>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  veil: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(244,242,237,0.84)' },
  sheet: {
    gap: 16,
    paddingTop: 10,
    paddingHorizontal: 16,
    backgroundColor: C.white,
    borderTopWidth: RULE,
    borderTopColor: C.ink,
    boxShadow: `0px -4px 0 ${C.coral}`,
  },
  grip: { alignSelf: 'center', width: 36, height: 4, backgroundColor: 'rgba(19,19,17,0.2)' },
  tile: {
    width: 56,
    height: 56,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btn: { height: 52, borderWidth: RULE, borderColor: C.ink, alignItems: 'center', justifyContent: 'center' },
})
