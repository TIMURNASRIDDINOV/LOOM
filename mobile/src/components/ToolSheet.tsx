import React, { useState } from 'react'
import { ActivityIndicator, Image, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'

import { C, COLORS, RULE, SIZES, fmt, noShadow, offset } from '../theme/tokens'
import { body, disp, label as labelType, mono } from '../theme/type'
import { uploadFile } from '../api/client'
import { fetchArtworks, useAsync } from '../api/catalog'
import { useStudio } from '../state/studio'
import { useToast } from '../state/toast'
import { Upload } from './icons'
import { Button, Panel, T, Tap } from './ui'

const TITLES: Record<string, string> = {
  text: 'Текст',
  image: 'Графика',
  color: 'Цвет вещи',
  size: 'Размер',
}

/** The on-demand sheet. It only opens when a tool is picked, so the garment
 *  keeps the stage the rest of the time. */
export function ToolSheet({ maxHeight }: { maxHeight: number }) {
  const { tool, closeTool } = useStudio()
  if (!tool) return null

  return (
    <Panel raised size={2} style={styles.sheet}>
      <View style={styles.sheetHead}>
        <T style={{ ...mono(12, 1, { ls: 0.18, upper: true }), fontFamily: 'IBMPlexMono_700Bold' }}>
          {TITLES[tool]}
        </T>
        <Tap style={styles.closeBtn} onPress={closeTool} hitSlop={8}>
          <T style={{ fontSize: 14, lineHeight: 18, color: C.ink }}>×</T>
        </Tap>
      </View>
      <ScrollView style={{ maxHeight }} contentContainerStyle={{ padding: 12 }}>
        {tool === 'text' ? <TextTool /> : null}
        {tool === 'image' ? <ImageTool /> : null}
        {tool === 'color' ? <ColorTool /> : null}
        {tool === 'size' ? <SizeTool /> : null}
      </ScrollView>
    </Panel>
  )
}

function Label({ children }: { children: string }) {
  return <T style={[labelType(), { marginBottom: 7 }]}>{children}</T>
}

function TextTool() {
  const { active, setText, removeText } = useStudio()
  const t = active.text
  const fonts = ['Inter Tight', 'Inter', 'IBM Plex Mono']

  return (
    <View style={{ gap: 12 }}>
      <View>
        <Label>Надпись</Label>
        <TextInput
          value={t?.content ?? ''}
          onChangeText={(content) => (content.length ? setText({ content: content.slice(0, 40) }) : removeText())}
          placeholder="Введите текст…"
          placeholderTextColor={C.i38}
          style={styles.input}
          allowFontScaling={false}
          maxLength={40}
          returnKeyType="done"
        />
        <T style={[mono(9.5, 1.5, { color: C.i38 }), { marginTop: 6 }]}>
          Размер, поворот и положение — тапните по надписи на макете.
        </T>
      </View>

      <View>
        <Label>Шрифт</Label>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {fonts.map((f) => {
            const on = (t?.font ?? 'Inter Tight') === f
            return (
              <Tap
                key={f}
                onPress={() => setText({ font: f })}
                style={[styles.chip, { flex: 1, backgroundColor: on ? C.ink : C.white }]}
              >
                <T
                  style={{
                    fontFamily:
                      f === 'IBM Plex Mono'
                        ? 'IBMPlexMono_600SemiBold'
                        : f === 'Inter'
                          ? 'Inter_600SemiBold'
                          : 'InterTight_600SemiBold',
                    fontSize: 10.5,
                    color: on ? C.paper : C.i70,
                  }}
                >
                  {f === 'IBM Plex Mono' ? 'Plex Mono' : f}
                </T>
              </Tap>
            )
          })}
        </View>
      </View>

      <View>
        <Label>Цвет надписи</Label>
        <View style={{ flexDirection: 'row', gap: 7 }}>
          {['#131311', '#ffffff', C.coral, '#2b3e5e'].map((c) => {
            const on = (t?.color ?? '#131311').toLowerCase() === c.toLowerCase()
            return (
              <Tap
                key={c}
                onPress={() => setText({ color: c })}
                style={[styles.swatch40, { backgroundColor: c }, on && styles.swatchOn]}
              />
            )
          })}
        </View>
      </View>
    </View>
  )
}

function ImageTool() {
  const { setArt, updateArt } = useStudio()
  const { flash } = useToast()
  const [busy, setBusy] = useState(false)

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      flash('Нужен доступ к фото, чтобы загрузить графику')
      return
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      exif: false,
    })
    if (res.canceled || !res.assets?.length) return

    const asset = res.assets[0]
    const mime = asset.mimeType ?? 'image/png'
    const name = asset.fileName ?? 'Ваша графика'
    if (asset.fileSize && asset.fileSize > 20 * 1024 * 1024) {
      flash('Файл больше 20 МБ — сожмите его и попробуйте снова')
      return
    }
    setBusy(true)
    // Place the layer immediately so the stage responds; the R2 upload backfills
    // the key that the print pipeline needs. A failed upload is not fatal here —
    // checkout retries before the order is submitted.
    setArt({ name, uri: asset.uri, mime, uploadKey: null, price: 0 })
    flash('Готово — правьте размер и положение в панели слоя')
    try {
      const key = await uploadFile(asset.uri, asset.fileName ?? 'artwork.png', mime)
      updateArt({ uploadKey: key })
    } catch {
      flash('Файл не загрузился — попробуем ещё раз при оформлении')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: 13 }}>
      <Button
        title="Загрузить файл"
        size={14}
        vPad={15}
        loading={busy}
        icon={<Upload />}
        onPress={pick}
        style={offset(2, C.ink)}
      />
      <T style={mono(10.5, 1.5, { ls: 0.04, color: C.i38 })}>
        PNG · JPEG · SVG · до 20 МБ · мин. 1500 px
      </T>

      <View>
        <Label>От дизайнеров</Label>
        <DesignerGrid />
      </View>
    </View>
  )
}

/** Approved marketplace artwork, applied to the garment in one tap. */
function DesignerGrid() {
  const { setArt } = useStudio()
  const { flash } = useToast()
  const { data, loading } = useAsync(fetchArtworks, [])
  const items = data ?? []

  if (loading) return <ActivityIndicator color={C.coral} style={{ marginVertical: 16 }} />
  if (!items.length) {
    return (
      <T style={mono(10, 1.5, { color: C.i38 })}>
        Работ пока нет — загрузите свою графику выше.
      </T>
    )
  }

  return (
    <View style={styles.artGrid}>
      {items.slice(0, 8).map((a) => (
        <Tap
          key={a.id}
          style={styles.artCard}
          onPress={() => {
            setArt({
              name: a.title,
              uri: a.image_url,
              // The print shop fetches the designer's own file; the id credits
              // the sale to them at checkout.
              uploadKey: a.image_key,
              artworkId: a.id,
              price: a.markup,
              author: a.author,
            })
            flash(a.markup > 0 ? `${a.title} · +${fmt(a.markup)} сум` : a.title)
          }}
        >
          <Image source={{ uri: a.image_url }} style={styles.artThumb} resizeMode="cover" />
          <View style={{ paddingHorizontal: 8, paddingVertical: 7 }}>
            <T style={disp(11.5, 1.15)} numberOfLines={1}>
              {a.title}
            </T>
            <T style={[mono(9, 1.2, { color: C.i55 }), { marginTop: 2 }]} numberOfLines={1}>
              {a.markup > 0 ? `${a.author} · +${fmt(a.markup)}` : a.author}
            </T>
          </View>
        </Tap>
      ))}
    </View>
  )
}

function ColorTool() {
  const { s, setColor } = useStudio()
  return (
    <View>
      <View style={styles.colorGrid}>
        {COLORS.map((c) => {
          const on = s.color === c.hex
          return (
            <Tap
              key={c.hex}
              onPress={() => setColor(c.hex, c.name)}
              style={[styles.colorSwatch, { backgroundColor: c.hex }, on && styles.swatchOn]}
            />
          )
        })}
      </View>
      <T style={[mono(11.5, 1.4, { ls: 0.06, color: C.i70 }), { marginTop: 12 }]}>
        Выбрано: {s.colorName}
      </T>
    </View>
  )
}

const FIT: Record<string, string> = {
  XS: 'Обхват груди 84–88 см · длина 66 см · US XS · EU 42',
  S: 'Обхват груди 88–92 см · длина 68 см · US S · EU 44',
  M: 'Обхват груди 96–100 см · длина 71 см · US M · EU 48',
  L: 'Обхват груди 100–104 см · длина 73 см · US L · EU 50',
  XL: 'Обхват груди 108–112 см · длина 75 см · US XL · EU 54',
  XXL: 'Обхват груди 116–120 см · длина 77 см · US XXL · EU 56',
  XXXL: 'Обхват груди 124–128 см · длина 79 см · US 3XL · EU 60',
}

function SizeTool() {
  const { s, setSize } = useStudio()
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
        {SIZES.map((z) => {
          const on = s.size === z
          return (
            <Tap
              key={z}
              onPress={() => setSize(z)}
              style={[
                styles.sizeBtn,
                { backgroundColor: on ? C.ink : C.white },
                on ? offset(2, C.coral) : noShadow,
              ]}
            >
              <T style={disp(13.5, 1, { color: on ? C.paper : C.i70 })}>{z}</T>
            </Tap>
          )
        })}
      </View>
      <View style={styles.fitBox}>
        <T style={[labelType(), { marginBottom: 6 }]}>{`Размер ${s.size}`}</T>
        <T style={body(11.5, 1.6, { color: C.i70 })}>{FIT[s.size]}</T>
        <T style={[body(10.5, 1.5, { color: C.i38 }), { marginTop: 8 }]}>
          Между размерами — берите больший для свободной посадки.
        </T>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: { marginHorizontal: 12, marginBottom: 8, overflow: 'hidden' },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: RULE,
    borderBottomColor: C.ink,
    backgroundColor: C.paper,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontFamily: 'Inter_400Regular',
    // 16px keeps iOS from zooming the field on focus.
    fontSize: 16,
    color: C.ink,
  },
  chip: {
    paddingVertical: 11,
    paddingHorizontal: 3,
    borderWidth: RULE,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch40: { width: 40, height: 40, borderWidth: RULE, borderColor: C.ink },
  swatchOn: { borderColor: C.coral, borderWidth: 3.5 },
  artGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  artCard: {
    width: '47.5%',
    flexGrow: 1,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
  },
  artThumb: { width: '100%', aspectRatio: 1, borderBottomWidth: RULE, borderBottomColor: C.ink },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorSwatch: { width: '14.5%', aspectRatio: 1, borderWidth: RULE, borderColor: C.ink },
  sizeBtn: {
    minWidth: 46,
    paddingVertical: 13,
    paddingHorizontal: 10,
    borderWidth: RULE,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fitBox: { borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, padding: 12 },
})
