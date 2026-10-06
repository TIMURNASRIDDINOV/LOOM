import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'

import { buildMockupHtml, mockupBridge, type MockupRendererHandle } from '../lib/mockup-html'

// Web build: the same mockup page in a hidden iframe, over postMessage.
export const MockupRenderer = forwardRef<MockupRendererHandle>(function MockupRenderer(_, ref) {
  const frame = useRef<HTMLIFrameElement>(null)
  const bridge = useRef(mockupBridge()).current
  const html = useMemo(buildMockupHtml, [])

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source === frame.current?.contentWindow) bridge.receive(e.data)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [bridge])

  useImperativeHandle(ref, () => ({
    render: (req) => bridge.request(req, (msg) => frame.current?.contentWindow?.postMessage(msg, '*')),
  }), [bridge])

  return (
    <iframe
      ref={frame}
      srcDoc={html}
      title="mockup"
      aria-hidden
      tabIndex={-1}
      sandbox="allow-scripts allow-same-origin"
      style={{ position: 'absolute', width: 1, height: 1, border: 0, opacity: 0, pointerEvents: 'none' }}
    />
  )
})
