import React, { useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'

import { C } from '../theme/tokens'
import { body, mono } from '../theme/type'
import { T } from './ui'

// Real 3D preview, rendered by the same three.js the website uses.
//
// The web configurator paints the print onto a canvas and feeds it to the GLB
// as a texture. Rebuilding that natively would mean a second implementation of
// the print pipeline — and any drift between the two would show up as a
// mis-printed garment, not just a wrong preview. So the app hosts the identical
// code in a WebView and passes the design in.
//
// three.js r128 + GLTFLoader + OrbitControls, matching configurator.html.
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0'

export type Model3DProps = {
  /** `glb_url` from the product API. Nothing renders without it. */
  glbUrl: string | null
  /** Base garment colour, multiplied over the fabric like the web does. */
  color: string
  /** PNG/JPEG data URI or remote URL of the artwork to lay on the print area. */
  artUrl?: string | null
  /** Artwork placement, in the same normalised space as design_json v2. */
  placement?: { nx: number; ny: number; scale: number; rotation: number }
}

function buildHtml(p: Model3DProps): string {
  const placement = p.placement ?? { nx: 0.5, ny: 0.5, scale: 0.58, rotation: 0 }
  // The print rect inside the 2048² texture — the same LEGACY_PRINT_AREA the
  // web configurator and the admin print master use.
  const PRINT = { x: 560, y: 360, w: 928, h: 1120 }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html,body{margin:0;height:100%;background:${C.paper};overflow:hidden;
    -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
  #c{width:100%;height:100%;display:block;touch-action:none}
  #err{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
    padding:24px;text-align:center;font:400 13px/1.6 -apple-system,sans-serif;color:rgba(19,19,17,.55)}
</style>
<script src="${THREE_CDN}/build/three.min.js"></script>
<script src="${THREE_CDN}/examples/js/loaders/GLTFLoader.js"></script>
<script src="${THREE_CDN}/examples/js/controls/OrbitControls.js"></script>
</head>
<body>
<canvas id="c"></canvas>
<div id="err">Не удалось загрузить 3D-модель.</div>
<script>
(function () {
  var post = function (m) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m));
  };
  var fail = function (why) {
    document.getElementById('err').style.display = 'flex';
    post({ type: 'error', message: why });
  };
  if (!window.THREE) return fail('three.js did not load');

  var canvas = document.getElementById('c');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputEncoding = THREE.sRGBEncoding;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0.05, 2.6);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d3c8, 1.15));
  var key = new THREE.DirectionalLight(0xffffff, 0.75);
  key.position.set(2, 3, 4);
  scene.add(key);
  var fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-3, 1, -2);
  scene.add(fill);

  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.4;
  controls.maxDistance = 4.5;
  // Keep the garment upright — the web viewer clamps the same way.
  controls.minPolarAngle = Math.PI * 0.25;
  controls.maxPolarAngle = Math.PI * 0.72;

  var TEX = 2048;
  var PRINT = ${JSON.stringify(PRINT)};
  var PLACE = ${JSON.stringify(placement)};
  var GARMENT = ${JSON.stringify(p.color)};
  var ART = ${JSON.stringify(p.artUrl ?? null)};

  // The garment texture: flat base colour with the artwork composited into the
  // print rect, exactly as the web builds it.
  function buildTexture(cb) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = TEX;
    var g = cv.getContext('2d');
    g.fillStyle = GARMENT;
    g.fillRect(0, 0, TEX, TEX);

    var finish = function () {
      var t = new THREE.CanvasTexture(cv);
      t.flipY = false;
      t.encoding = THREE.sRGBEncoding;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      cb(t);
    };

    if (!ART) return finish();
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      var w = PRINT.w * PLACE.scale;
      var h = w * (img.height / img.width);
      var cx = PRINT.x + PRINT.w * PLACE.nx;
      var cy = PRINT.y + PRINT.h * PLACE.ny;
      g.save();
      g.translate(cx, cy);
      g.rotate((PLACE.rotation * Math.PI) / 180);
      g.drawImage(img, -w / 2, -h / 2, w, h);
      g.restore();
      finish();
    };
    // A broken artwork URL must still leave a usable garment.
    img.onerror = function () { finish(); };
    img.src = ART;
  }

  var loader = new THREE.GLTFLoader();
  loader.load(${JSON.stringify(p.glbUrl ?? '')}, function (gltf) {
    var model = gltf.scene;

    buildTexture(function (tex) {
      model.traverse(function (o) {
        if (!o.isMesh) return;
        o.material = new THREE.MeshStandardMaterial({
          map: tex, roughness: 0.86, metalness: 0.02,
        });
      });

      // Frame the garment: centre it and scale so it fills the viewport.
      var box = new THREE.Box3().setFromObject(model);
      var size = box.getSize(new THREE.Vector3());
      var centre = box.getCenter(new THREE.Vector3());
      var scale = 1.7 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(scale);
      model.position.sub(centre.multiplyScalar(scale));

      scene.add(model);
      post({ type: 'ready' });
    });
  }, undefined, function () {
    fail('GLB failed to load');
  });

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  (function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();
})();
</script>
</body>
</html>`
}

export function Model3D(props: Model3DProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const webRef = useRef<WebView>(null)

  // Rebuilding the HTML remounts the WebView, so key only on what the scene
  // actually depends on — not on every studio keystroke.
  const html = useMemo(
    () => buildHtml(props),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.glbUrl, props.color, props.artUrl, JSON.stringify(props.placement)],
  )

  if (!props.glbUrl) {
    return (
      <View style={styles.fallback}>
        <T style={mono(9.5, 1.5, { ls: 0.16, upper: true, color: C.i38, align: 'center' })}>
          3D-модель для этой вещи ещё не загружена
        </T>
      </View>
    )
  }

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        source={{ html }}
        style={styles.web}
        // The scene paints its own paper ground; a white flash on load would
        // read as a broken screen.
        containerStyle={{ backgroundColor: C.paper }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        allowsInlineMediaPlayback
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        onMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data) as { type: string }
            if (msg.type === 'ready') setState('ready')
            if (msg.type === 'error') setState('error')
          } catch {
            // Ignore anything that is not our own protocol.
          }
        }}
        onError={() => setState('error')}
      />
      {state === 'loading' ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={C.coral} />
          <T style={[mono(9.5, 1.4, { ls: 0.16, upper: true, color: C.i38 }), { marginTop: 10 }]}>
            Загружаем 3D
          </T>
        </View>
      ) : null}
      {state === 'error' ? (
        <View style={styles.overlay} pointerEvents="none">
          <T style={body(12.5, 1.6, { color: C.i55, align: 'center' })}>
            3D недоступно. Проверьте соединение.
          </T>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: 'transparent' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: C.paper,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.line,
  },
})
