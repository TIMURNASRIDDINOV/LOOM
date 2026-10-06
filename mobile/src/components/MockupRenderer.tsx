import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'

import { SITE_ORIGIN } from '../lib/scene-html'
import { buildMockupHtml, mockupBridge, type MockupRendererHandle } from '../lib/mockup-html'

// Hidden page that draws the order mockups (lib/mockup-html.ts). Mounted with
// the studio so it is ready by the time the customer adds to the cart.
export const MockupRenderer = forwardRef<MockupRendererHandle>(function MockupRenderer(_, ref) {
  const web = useRef<WebView>(null)
  const bridge = useRef(mockupBridge()).current
  const html = useMemo(buildMockupHtml, [])

  useImperativeHandle(ref, () => ({
    render: (req) => bridge.request(req, (msg) => web.current?.injectJavaScript(`window.__loomRender(${msg}); true;`)),
  }), [bridge])

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={web}
        // Same-origin with the garment art, so the canvas stays exportable.
        source={{ html, baseUrl: SITE_ORIGIN }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        onMessage={(e) => bridge.receive(e.nativeEvent.data)}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
})
