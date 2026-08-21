import React, { useState } from 'react'
import { Image, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'

import { C, RULE, fmt, noShadow, offset } from '../../src/theme/tokens'
import { body, disp, kicker, label as labelType, mono, monoSemi } from '../../src/theme/type'
import { AppBar } from '../../src/components/AppBar'
import { Hatch } from '../../src/components/ArtPattern'
import { ChevronLeft } from '../../src/components/icons'
import { Button, Panel, T, Tap } from '../../src/components/ui'
import { useToast } from '../../src/state/toast'

// ─── MOCK FLOW ───────────────────────────────────────────────────────────────
// Designer publishing has no backend yet: there is no artwork table, no markup
// column and no moderation queue. The file picker and validation are real; the
// submit is local. Wiring this up is the remaining backend task.

const MARKUPS = [15000, 25000, 35000]

export default function Publish() {
  const router = useRouter()
  const { flash } = useToast()
  const [step, setStep] = useState(1)
  const [file, setFile] = useState<{ uri: string; name: string; w: number; h: number; size: number } | null>(null)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [markup, setMarkup] = useState(25000)

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      flash('Нужен доступ к фото, чтобы выбрать работу')
      return
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
    if (res.canceled || !res.assets?.length) return
    const a = res.assets[0]
    if (Math.max(a.width, a.height) < 1500) {
      flash('Минимум 1500 px по длинной стороне')
      return
    }
    setFile({
      uri: a.uri,
      name: a.fileName ?? 'artwork.png',
      w: a.width,
      h: a.height,
      size: a.fileSize ?? 0,
    })
    setTitle(a.fileName?.replace(/\.[^.]+$/, '') ?? '')
    setStep(2)
  }

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="ДИЗАЙН" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <Tap style={styles.back} onPress={() => (step > 1 ? setStep(step - 1) : router.push('/market'))}>
          <ChevronLeft size={13} width={2.4} color={C.i55} />
          <T style={mono(10.5, 1, { ls: 0.16, upper: true, color: C.i55 })}>Назад</T>
        </Tap>

        <T style={kicker()}>Дизайнерам</T>
        <T style={[disp(30, 0.98, { ls: -0.035 }), { marginTop: 10, marginBottom: 8 }]}>
          {step === 3 ? 'На модерации.' : 'Опубликовать работу'}
        </T>

        <View style={styles.progress}>
          {[1, 2, 3].map((n) => (
            <View
              key={n}
              style={{ width: 22, height: 4, backgroundColor: step >= n ? C.coral : 'rgba(19,19,17,.16)' }}
            />
          ))}
        </View>

        {step === 1 ? (
          <>
            <T style={[body(13.5, 1.6, { color: C.i55 }), { marginBottom: 16 }]}>
              Загрузите графику — покупатели смогут напечатать её на любой вещи из каталога. Вы
              получаете процент с каждой продажи.
            </T>
            <Tap onPress={pick}>
              <Hatch style={styles.dropzone}>
                <View style={styles.dropPlus}>
                  <T style={{ fontSize: 24, lineHeight: 30, color: C.white }}>+</T>
                </View>
                <T style={disp(14, 1, { ls: 0.06, upper: true })}>Выбрать файл</T>
                <T style={mono(10, 1.4, { ls: 0.1, upper: true, color: C.i38 })}>
                  PNG · SVG · до 20 МБ
                </T>
              </Hatch>
            </Tap>
            <View style={styles.reqs}>
              <T style={[labelType(), { marginBottom: 8 }]}>Требования</T>
              {[
                'Прозрачный фон, без рамки',
                'Минимум 1500 px по длинной стороне',
                'Только ваши права на изображение',
              ].map((t) => (
                <T key={t} style={[body(11.5, 1.5, { color: C.i70 }), { marginBottom: 5 }]}>
                  {`— ${t}`}
                </T>
              ))}
            </View>
          </>
        ) : null}

        {step === 2 && file ? (
          <>
            <Panel style={styles.fileCard}>
              <Image source={{ uri: file.uri }} style={styles.filePreview} resizeMode="cover" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T style={disp(13, 1.2)} numberOfLines={1}>
                  {file.name}
                </T>
                <T style={[mono(10.5, 1.4, { color: C.i55 }), { marginTop: 3 }]}>
                  {`${file.w}×${file.h} · ${(file.size / 1024 / 1024).toFixed(1)} МБ`}
                </T>
                <T style={[monoSemi(9.5, 1, { ls: 0.1, upper: true, color: C.green }), { marginTop: 4 }]}>
                  ✓ подходит для печати
                </T>
              </View>
            </Panel>

            <Field label="Название" value={title} onChange={setTitle} placeholder="Chorsu Nights" />
            <Field label="Теги" value={tags} onChange={setTags} placeholder="Ташкент, ночь, типографика" />

            <View style={{ marginBottom: 11 }}>
              <T style={[labelType(9.5, { color: C.i70 }), { marginBottom: 6 }]}>Ваша наценка</T>
              <View style={{ flexDirection: 'row', gap: 7 }}>
                {MARKUPS.map((v) => {
                  const on = v === markup
                  return (
                    <Tap
                      key={v}
                      onPress={() => setMarkup(v)}
                      style={[
                        styles.markup,
                        { backgroundColor: on ? C.ink : C.white },
                        on ? offset(2, C.coral) : noShadow,
                      ]}
                    >
                      <T style={{ ...mono(12, 1, { color: on ? C.paper : C.i70 }), fontFamily: 'IBMPlexMono_600SemiBold' }}>
                        {fmt(v)}
                      </T>
                    </Tap>
                  )
                })}
              </View>
              <T style={[body(10.5, 1.5, { color: C.i38 }), { marginTop: 8 }]}>
                {`Покупатель платит 150 000 + ${fmt(markup)}. LOOM удерживает 30% с наценки.`}
              </T>
            </View>

            <Button
              title="Отправить на проверку"
              size={16}
              vPad={17}
              onPress={() => {
                setStep(3)
                flash('Работа отправлена на модерацию')
              }}
            />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Panel raised raisedColor={C.coral} style={{ padding: 18, marginBottom: 16 }}>
              <T style={[monoSemi(10, 1, { ls: 0.2, upper: true, color: C.amber }), { marginBottom: 8 }]}>
                Проверка · 1–2 дня
              </T>
              <T style={[disp(20, 1.1, { ls: -0.02 }), { marginBottom: 6 }]}>{title || 'Ваша работа'}</T>
              <T style={body(12.5, 1.6, { color: C.i55 })}>
                Мы проверим права и качество печати. Ответ придёт в Telegram — после одобрения работа
                появится в каталоге дизайнеров.
              </T>
            </Panel>
            <Button
              title="Загрузить ещё одну"
              variant="outline"
              size={12.5}
              vPad={15}
              onPress={() => {
                setFile(null)
                setTitle('')
                setStep(1)
              }}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <View style={{ marginBottom: 11 }}>
      <T style={[labelType(9.5, { color: C.i70 }), { marginBottom: 6 }]}>{label}</T>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.i38}
        style={styles.input}
        allowFontScaling={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingBottom: 14 },
  progress: { flexDirection: 'row', gap: 5, marginTop: 16, marginBottom: 20 },
  dropzone: {
    aspectRatio: 4 / 3,
    borderWidth: RULE,
    borderStyle: 'dashed',
    borderColor: C.ink,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 14,
  },
  dropPlus: {
    width: 44,
    height: 44,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqs: { borderWidth: 1, borderColor: C.line, backgroundColor: C.white, padding: 13 },
  fileCard: { flexDirection: 'row', gap: 12, padding: 11, marginBottom: 16 },
  filePreview: { width: 68, height: 68, borderWidth: 1, borderColor: C.ink },
  input: {
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderWidth: RULE,
    borderColor: C.ink,
    backgroundColor: C.white,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    color: C.ink,
  },
  markup: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderWidth: RULE,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
