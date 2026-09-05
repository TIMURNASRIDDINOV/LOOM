import React from 'react'
import { StyleSheet, View } from 'react-native'

import { C } from '../theme/tokens'
import { body, disp } from '../theme/type'
import { tStatic } from '../i18n'
import { Button, T, Wordmark } from './ui'

// A render error anywhere below this boundary shows a recoverable screen
// instead of the red box (dev) or a silent crash to the home screen (prod).
// Class component, so translations go through the static accessor.

type State = { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <View style={styles.screen}>
        <Wordmark size={17} />
        <T style={[disp(30, 0.98, { ls: -0.035 }), { marginTop: 22, marginBottom: 10 }]}>
          {tStatic('err.title')}<T style={{ color: C.coral }}>/</T>
        </T>
        <T style={[body(14.5, 1.6, { color: C.i55 }), { marginBottom: 24 }]}>{tStatic('err.body')}</T>
        <Button title={tStatic('err.retry')} variant="ink" size={12.5} vPad={16} onPress={() => this.setState({ error: null })} />
        {__DEV__ ? (
          <T style={[body(11, 1.5, { color: C.i38 }), { marginTop: 18 }]}>{String(this.state.error.message)}</T>
        ) : null}
      </View>
    )
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.paper, justifyContent: 'center', paddingHorizontal: 24 },
})
