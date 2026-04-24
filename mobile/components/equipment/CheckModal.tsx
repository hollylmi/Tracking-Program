import { useState, useEffect } from 'react'
import {
  View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Alert, Image, Platform,
  Keyboard, InputAccessoryView, KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { compressImage } from '../../lib/compressImage'

// NFC is optional (missing in Expo Go) — guarded require.
let NfcManager: any = null
let NfcTech: any = null
try {
  const nfc = require('react-native-nfc-manager')
  NfcManager = nfc.default
  NfcTech = nfc.NfcTech
} catch {
  // NFC unavailable
}

export const CONDITION_OPTIONS = [
  { value: 'good', label: 'Good', color: Colors.success, bg: 'rgba(61,139,65,0.15)' },
  { value: 'fair', label: 'Fair', color: Colors.warning, bg: 'rgba(201,106,0,0.15)' },
  { value: 'poor', label: 'Poor', color: '#E65100', bg: 'rgba(230,81,0,0.15)' },
  { value: 'broken_down', label: 'Broken Down', color: Colors.error, bg: 'rgba(198,40,40,0.15)' },
]

export type CheckSubmit = (
  condition: string,
  notes: string,
  hoursReading: string | undefined,
  photos: { uri: string; filename: string }[],
  tagUid: string | undefined,
) => Promise<void>

interface Props {
  visible: boolean
  machineName: string
  isFleetMachine: boolean
  activeTagUid: string | null
  onClose: () => void
  onSubmit: CheckSubmit
}

export default function CheckModal({ visible, machineName, isFleetMachine, activeTagUid, onClose, onSubmit }: Props) {
  const [condition, setCondition] = useState('good')
  const [notes, setNotes] = useState('')
  const [hoursReading, setHoursReading] = useState('')
  const [photos, setPhotos] = useState<{ uri: string; filename: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [verifiedTagUid, setVerifiedTagUid] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const tagRequired = !!activeTagUid
  const MAX_PHOTOS = 10

  useEffect(() => {
    if (!visible) {
      setVerifiedTagUid(null)
      setCondition('good'); setNotes(''); setHoursReading(''); setPhotos([])
    }
  }, [visible])

  const triggerScan = async () => {
    if (!NfcManager) {
      Alert.alert('NFC Not Available', 'This device does not support NFC.')
      return
    }
    if (scanning) return
    setVerifiedTagUid(null)
    try { await NfcManager.cancelTechnologyRequest() } catch {}
    setScanning(true)
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef)
      const tag = await NfcManager.getTag()
      const uid: string | undefined = tag?.id
      try { await NfcManager.cancelTechnologyRequest() } catch {}
      setScanning(false)
      if (!uid) {
        Alert.alert('Scan Failed', 'Could not read the NFC tag.')
        return
      }
      if (activeTagUid && uid !== activeTagUid) {
        Alert.alert('Wrong Machine', `That tag does not match "${machineName}".`)
        return
      }
      setVerifiedTagUid(uid)
    } catch (e: any) {
      try { await NfcManager.cancelTechnologyRequest() } catch {}
      setScanning(false)
      if (e?.message !== 'cancelled') {
        Alert.alert('Scan Failed', 'Could not read the NFC tag. Try again.')
      }
    }
  }

  const handleSubmit = async () => {
    if (tagRequired && !verifiedTagUid) {
      Alert.alert('Scan Required', 'Scan the NFC tag on this machine first.')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(condition, notes, hoursReading || undefined, photos, verifiedTagUid || undefined)
      setCondition('good'); setNotes(''); setHoursReading(''); setPhotos([])
      setVerifiedTagUid(null)
    } finally { setSubmitting(false) }
  }

  const addCompressed = async (uri: string) => {
    const compressed = await compressImage(uri)
    setPhotos(prev => [...prev, { uri: compressed, filename: `dc_${Date.now()}_${prev.length + 1}.jpg` }].slice(0, MAX_PHOTOS))
  }

  const takePhoto = async () => {
    if (photos.length >= MAX_PHOTOS) { Alert.alert('Limit reached', `Maximum ${MAX_PHOTOS} photos.`); return }
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Camera access is needed.'); return }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
    if (!result.canceled && result.assets.length > 0) await addCompressed(result.assets[0].uri)
  }

  const pickFromGallery = async () => {
    if (photos.length >= MAX_PHOTOS) { Alert.alert('Limit reached', `Maximum ${MAX_PHOTOS} photos.`); return }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Photo library access is needed.'); return }
    const remaining = MAX_PHOTOS - photos.length
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    })
    if (!result.canceled && result.assets.length > 0) {
      // Compress in parallel — serial compression is noticeably slow on older
      // phones when picking several images at once.
      const compressed = await Promise.all(
        result.assets.slice(0, remaining).map(async (a, i) => ({
          uri: await compressImage(a.uri),
          filename: `dc_${Date.now()}_${i}.jpg`,
        }))
      )
      setPhotos((prev) => [...prev, ...compressed].slice(0, MAX_PHOTOS))
    }
  }

  const removePhoto = (i: number) => setPhotos(prev => prev.filter((_, idx) => idx !== i))

  const submitDisabled = submitting || (tagRequired && !verifiedTagUid)

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose}><Text style={s.cancel}>Cancel</Text></TouchableOpacity>
          <Text style={s.title} numberOfLines={1}>{machineName}</Text>
          <TouchableOpacity onPress={handleSubmit} disabled={submitDisabled} style={{ opacity: submitDisabled ? 0.4 : 1 }}>
            {submitting ? <ActivityIndicator size="small" color={Colors.primary} /> : (
              <Text style={s.save}>{tagRequired && !verifiedTagUid ? 'Scan first' : 'Submit'}</Text>
            )}
          </TouchableOpacity>
        </View>
        <View style={s.headerAccent} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            {tagRequired && (
              verifiedTagUid ? (
                <View style={[s.scanBanner, { borderColor: Colors.success, backgroundColor: 'rgba(61,139,65,0.12)' }]}>
                  <View style={[s.scanIconWrap, { backgroundColor: Colors.success }]}>
                    <Ionicons name="checkmark" size={22} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.scanBannerTitle, { color: Colors.success }]}>Tag verified</Text>
                    <Text style={s.scanBannerSubtitle}>You can submit this check</Text>
                  </View>
                </View>
              ) : (
                <TouchableOpacity onPress={triggerScan} activeOpacity={0.85}
                  style={[s.scanBanner, { borderColor: Colors.warning, backgroundColor: 'rgba(201,106,0,0.1)' }]}>
                  <View style={[s.scanIconWrap, { backgroundColor: Colors.warning }]}>
                    <Ionicons name="scan-outline" size={22} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.scanBannerTitle, { color: Colors.warning }]}>Scan NFC tag required</Text>
                    <Text style={s.scanBannerSubtitle}>Tap here, then hold phone to the tag</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={Colors.warning} />
                </TouchableOpacity>
              )
            )}
            <Text style={s.label}>Condition</Text>
            <View style={s.conditionRow}>
              {CONDITION_OPTIONS.map((opt) => (
                <TouchableOpacity key={opt.value}
                  style={[s.conditionBtn, condition === opt.value && { backgroundColor: opt.bg, borderColor: opt.color }]}
                  onPress={() => setCondition(opt.value)} activeOpacity={0.8}>
                  <Text style={[s.conditionBtnText, condition === opt.value && { color: opt.color, fontWeight: '700' }]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {isFleetMachine && (
              <>
                <Text style={[s.label, { marginTop: Spacing.md }]}>Machine Hours</Text>
                <TextInput style={[s.input, { minHeight: 0 }]} value={hoursReading} onChangeText={setHoursReading}
                  placeholder="Current hours reading" placeholderTextColor={Colors.textLight}
                  keyboardType="decimal-pad"
                  returnKeyType="done" onSubmitEditing={Keyboard.dismiss} blurOnSubmit
                  inputAccessoryViewID={Platform.OS === 'ios' ? 'checkDoneBar' : undefined} />
              </>
            )}
            <Text style={[s.label, { marginTop: Spacing.md }]}>Notes</Text>
            <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="Optional notes"
              placeholderTextColor={Colors.textLight} multiline numberOfLines={3} textAlignVertical="top"
              inputAccessoryViewID={Platform.OS === 'ios' ? 'checkDoneBar' : undefined} />
            <Text style={[s.label, { marginTop: Spacing.md }]}>Photos ({photos.length}/{MAX_PHOTOS})</Text>
            {photos.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: Spacing.sm }}>
                {photos.map((p, i) => (
                  <View key={i} style={{ position: 'relative' }}>
                    <Image source={{ uri: p.uri }} style={s.photoThumb} />
                    <TouchableOpacity
                      onPress={() => removePhoto(i)}
                      style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#fff', borderRadius: 12 }}
                    >
                      <Ionicons name="close-circle" size={22} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            {photos.length < MAX_PHOTOS && (
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                <TouchableOpacity style={[s.photoBtn, { flex: 1 }]} onPress={takePhoto} activeOpacity={0.8}>
                  <Ionicons name="camera-outline" size={20} color={Colors.primary} />
                  <Text style={s.photoBtnText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.photoBtn, { flex: 1 }]} onPress={pickFromGallery} activeOpacity={0.8}>
                  <Ionicons name="images-outline" size={20} color={Colors.primary} />
                  <Text style={s.photoBtnText}>Gallery</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
        {scanning && (
          <View style={[StyleSheet.absoluteFillObject, {
            backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: Spacing.lg,
          }]}>
            <View style={{ backgroundColor: '#fff', padding: Spacing.lg, borderRadius: BorderRadius.lg, width: '100%', maxWidth: 400, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={{ ...Typography.h4, color: Colors.textPrimary, marginTop: Spacing.md, textAlign: 'center' }}>
                Scan the NFC tag
              </Text>
              <Text style={{ ...Typography.bodySmall, color: Colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
                Hold your phone against the tag on {machineName}.
              </Text>
              <TouchableOpacity
                onPress={async () => {
                  try { await NfcManager?.cancelTechnologyRequest() } catch {}
                  setScanning(false)
                }}
                style={{ marginTop: Spacing.md, padding: Spacing.sm }}
              >
                <Text style={{ color: Colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID="checkDoneBar">
          <View style={{ backgroundColor: '#f1f3f5', padding: 8, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <TouchableOpacity onPress={Keyboard.dismiss} style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
              <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 15 }}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
    </Modal>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.dark, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 4 },
  headerAccent: { height: 3, backgroundColor: Colors.primary },
  cancel: { ...Typography.body, color: Colors.textLight },
  title: { ...Typography.h4, color: Colors.white, flex: 1, textAlign: 'center', marginHorizontal: Spacing.sm },
  save: { ...Typography.body, color: Colors.primary, fontWeight: '700' },
  body: { padding: Spacing.md },
  label: { ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm },
  conditionRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  conditionBtn: { flex: 1, minWidth: '45%', paddingVertical: Spacing.sm + 2, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, alignItems: 'center' },
  conditionBtnText: { ...Typography.bodySmall, color: Colors.textSecondary, fontWeight: '500' },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, ...Typography.body, color: Colors.textPrimary, minHeight: 80 },
  photoThumb: { width: 80, height: 80, borderRadius: BorderRadius.sm },
  photoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.primary, borderStyle: 'dashed' },
  photoBtnText: { ...Typography.body, color: Colors.primary, fontWeight: '600' },
  scanBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 2, marginBottom: Spacing.md },
  scanIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  scanBannerTitle: { ...Typography.body, fontWeight: '700' },
  scanBannerSubtitle: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
})
