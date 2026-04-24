import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
  Modal, TextInput, ActivityIndicator, Alert, Image,
  Platform, Keyboard, KeyboardAvoidingView, InputAccessoryView, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import ScreenHeader from '../../components/layout/ScreenHeader'
import Card from '../../components/ui/Card'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { useToastStore } from '../../store/toast'
import { api } from '../../lib/api'
import { formatDate as fmtDateAU } from '../../lib/dates'
import { compressImage } from '../../lib/compressImage'
import { ScheduledCheckMachine } from '../../types'

let NfcManager: any = null
let NfcTech: any = null
try {
  const nfc = require('react-native-nfc-manager')
  NfcManager = nfc.default
  NfcTech = nfc.NfcTech
} catch {}

const CONDITION_OPTIONS: { value: string; label: string; color: string; bg: string }[] = [
  { value: 'good', label: 'Good', color: Colors.success, bg: 'rgba(61,139,65,0.15)' },
  { value: 'fair', label: 'Fair', color: Colors.warning, bg: 'rgba(201,106,0,0.15)' },
  { value: 'poor', label: 'Poor', color: '#E65100', bg: 'rgba(230,81,0,0.15)' },
  { value: 'broken_down', label: 'Broken Down', color: Colors.error, bg: 'rgba(198,40,40,0.15)' },
]

function MachineCheckCard({ machine, onCheck }: { machine: ScheduledCheckMachine; onCheck: () => void }) {
  const checked = !!machine.check
  const condOpt = CONDITION_OPTIONS.find((c) => c.value === machine.check?.condition)
  const hasAlerts = machine.alerts.length > 0
  const hasTransfer = !!machine.pending_transfer

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onCheck}>
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <View style={[s.accentBar, { backgroundColor: checked ? Colors.success : hasAlerts ? Colors.warning : Colors.border }]} />
      <View style={s.row}>
        <View style={[s.iconWrap, { backgroundColor: checked ? 'rgba(61,139,65,0.15)' : Colors.surface }]}>
          <Ionicons name={checked ? 'checkmark-circle' : 'ellipse-outline'} size={22}
            color={checked ? Colors.success : Colors.textLight} />
        </View>
        <View style={s.info}>
          <Text style={s.name}>{machine.name}</Text>
          {machine.type ? <Text style={s.type}>{machine.type}</Text> : null}
          {checked && machine.check?.hours_reading != null ? (
            <Text style={s.type}>{machine.check.hours_reading} hrs</Text>
          ) : null}
          {checked && machine.check?.checked_by ? (
            <Text style={s.type}>{machine.check.checked_by}{machine.check.checked_at ? ' — ' + new Date(machine.check.checked_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }) : ''}</Text>
          ) : null}
        </View>
        <View style={s.right}>
          {checked && condOpt ? (
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <View style={[s.statusPill, { backgroundColor: condOpt.bg }]}>
                <Text style={[s.statusText, { color: condOpt.color }]}>{condOpt.label}</Text>
              </View>
              <Text style={{ fontSize: 9, color: Colors.textLight }}>Tap to edit</Text>
            </View>
          ) : (
            <View style={s.checkBtn}>
              <Text style={s.checkBtnText}>Check</Text>
            </View>
          )}
        </View>
      </View>
      {hasAlerts && (
        <View style={s.alertBanner}>
          {machine.alerts.map((a, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name={a.type === 'inspection' ? 'search' : 'trash'} size={12}
                color={a.urgency === 'danger' ? Colors.error : Colors.warning} />
              <Text style={[s.alertText, { color: a.urgency === 'danger' ? Colors.error : Colors.warning }]}>{a.message}</Text>
            </View>
          ))}
        </View>
      )}
      {hasTransfer && (
        <View style={s.transferBanner}>
          <Ionicons name="arrow-forward-circle" size={12} color="#1565C0" />
          <Text style={s.transferText}>
            Moving to {machine.pending_transfer!.to_project} — {fmtDateAU(machine.pending_transfer!.scheduled_date, { day: 'numeric', month: 'short' })}
          </Text>
        </View>
      )}
      {checked && machine.check?.notes ? (
        <View style={s.notesBanner}>
          <Text style={s.notesText} numberOfLines={1}>{machine.check.notes}</Text>
        </View>
      ) : null}
    </Card>
    </TouchableOpacity>
  )
}

function CheckModal({ visible, machine, onClose, onSubmit, initialCondition, initialNotes, initialHours }: {
  visible: boolean; machine: ScheduledCheckMachine | null; onClose: () => void
  onSubmit: (data: { condition: string; notes: string; hoursReading?: string; tagUid?: string; photos: { uri: string; filename: string }[] }) => Promise<void>
  initialCondition?: string; initialNotes?: string; initialHours?: string
}) {
  const [condition, setCondition] = useState(initialCondition || 'good')
  const [notes, setNotes] = useState(initialNotes || '')
  const [hoursReading, setHoursReading] = useState(initialHours || '')
  const [photos, setPhotos] = useState<{ uri: string; filename: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [verifiedTagUid, setVerifiedTagUid] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const tagRequired = !!machine?.active_tag_uid
  const MAX_PHOTOS = 10

  useEffect(() => {
    setCondition(initialCondition || 'good')
    setNotes(initialNotes || '')
    setHoursReading(initialHours || '')
    setPhotos([])
    setVerifiedTagUid(null)
  }, [initialCondition, initialNotes, initialHours, machine?.machine_id])

  const triggerScan = async () => {
    if (!NfcManager || !machine) {
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
      if (machine.active_tag_uid && uid !== machine.active_tag_uid) {
        Alert.alert('Wrong Machine', `That tag does not match "${machine.name}".`)
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

  const addPhoto = async (source: 'camera' | 'library') => {
    if (photos.length >= MAX_PHOTOS) { Alert.alert('Limit', `Max ${MAX_PHOTOS} photos.`); return }
    try {
      const perm = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (perm.status !== 'granted') return
      const r = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({
            quality: 0.8, allowsMultipleSelection: true,
            selectionLimit: MAX_PHOTOS - photos.length,
          })
      if (!r.canceled && r.assets.length > 0) {
        const picked = await Promise.all(r.assets.slice(0, MAX_PHOTOS - photos.length).map(async (a, i) => ({
          uri: await compressImage(a.uri),
          filename: `sc_${Date.now()}_${i}.jpg`,
        })))
        setPhotos(prev => [...prev, ...picked])
      }
    } catch {}
  }

  const handleSubmit = async () => {
    if (tagRequired && !verifiedTagUid) {
      Alert.alert('Scan Required', 'Scan the NFC tag on this machine first.')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit({
        condition,
        notes,
        hoursReading: hoursReading || undefined,
        tagUid: verifiedTagUid || undefined,
        photos,
      })
      setCondition('good'); setNotes(''); setHoursReading(''); setPhotos([])
      setVerifiedTagUid(null)
    } catch (e) {
      Alert.alert('Error', 'Failed to submit check. Please try again.')
    } finally { setSubmitting(false) }
  }

  if (!machine) return null
  const submitDisabled = submitting || (tagRequired && !verifiedTagUid)

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={m.root} edges={['top', 'bottom']}>
        <View style={m.header}>
          <TouchableOpacity onPress={onClose}><Text style={m.cancel}>Cancel</Text></TouchableOpacity>
          <Text style={m.title} numberOfLines={1}>{machine.name}</Text>
          <TouchableOpacity onPress={handleSubmit} disabled={submitDisabled} style={{ opacity: submitDisabled ? 0.4 : 1 }}>
            {submitting
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <Text style={m.save}>{tagRequired && !verifiedTagUid ? 'Scan first' : 'Submit'}</Text>}
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={m.body} keyboardShouldPersistTaps="handled">
          {tagRequired && (
            verifiedTagUid ? (
              <View style={[m.scanBanner, { borderColor: Colors.success, backgroundColor: 'rgba(61,139,65,0.12)' }]}>
                <View style={[m.scanIconWrap, { backgroundColor: Colors.success }]}>
                  <Ionicons name="checkmark" size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[m.scanBannerTitle, { color: Colors.success }]}>Tag verified</Text>
                  <Text style={m.scanBannerSubtitle}>You can submit this check</Text>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={triggerScan} activeOpacity={0.85}
                style={[m.scanBanner, { borderColor: Colors.warning, backgroundColor: 'rgba(201,106,0,0.1)' }]}>
                <View style={[m.scanIconWrap, { backgroundColor: Colors.warning }]}>
                  <Ionicons name="scan-outline" size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[m.scanBannerTitle, { color: Colors.warning }]}>Scan NFC tag required</Text>
                  <Text style={m.scanBannerSubtitle}>Tap here, then hold phone to the tag</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={Colors.warning} />
              </TouchableOpacity>
            )
          )}

          <Text style={m.label}>Condition</Text>
          <View style={m.conditionRow}>
            {CONDITION_OPTIONS.map((opt) => (
              <TouchableOpacity key={opt.value}
                style={[m.conditionBtn, condition === opt.value && { backgroundColor: opt.bg, borderColor: opt.color }]}
                onPress={() => setCondition(opt.value)} activeOpacity={0.8}>
                <Text style={[m.conditionBtnText, condition === opt.value && { color: opt.color, fontWeight: '700' }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[m.label, { marginTop: Spacing.md }]}>Machine Hours</Text>
          <TextInput style={[m.input, { minHeight: 0 }]} value={hoursReading} onChangeText={setHoursReading}
            placeholder="Current hours reading" placeholderTextColor={Colors.textLight} keyboardType="decimal-pad"
            returnKeyType="done" onSubmitEditing={Keyboard.dismiss} blurOnSubmit
            inputAccessoryViewID={Platform.OS === 'ios' ? 'schedDoneBar' : undefined} />
          <Text style={[m.label, { marginTop: Spacing.md }]}>Notes</Text>
          <TextInput style={m.input} value={notes} onChangeText={setNotes} placeholder="Optional notes"
            placeholderTextColor={Colors.textLight} multiline numberOfLines={3} textAlignVertical="top"
            inputAccessoryViewID={Platform.OS === 'ios' ? 'schedDoneBar' : undefined} />

          <Text style={[m.label, { marginTop: Spacing.md }]}>Photos ({photos.length}/{MAX_PHOTOS})</Text>
          {photos.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: Spacing.sm }}>
              {photos.map((p, i) => (
                <View key={i} style={{ position: 'relative' }}>
                  <Image source={{ uri: p.uri }} style={{ width: 60, height: 60, borderRadius: 6 }} />
                  <TouchableOpacity onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#fff', borderRadius: 12 }}>
                    <Ionicons name="close-circle" size={20} color={Colors.error} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          {photos.length < MAX_PHOTOS && (
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <TouchableOpacity style={[m.photoBtn, { flex: 1 }]} onPress={() => addPhoto('camera')}>
                <Ionicons name="camera-outline" size={18} color={Colors.primary} />
                <Text style={m.photoBtnText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[m.photoBtn, { flex: 1 }]} onPress={() => addPhoto('library')}>
                <Ionicons name="images-outline" size={18} color={Colors.primary} />
                <Text style={m.photoBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
        </KeyboardAvoidingView>

        {/* Scanning overlay */}
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
                Hold your phone against the tag on {machine.name}.
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
        <InputAccessoryView nativeID="schedDoneBar">
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

export default function ScheduledCheckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const checkId = id ? Number(id) : undefined
  const router = useRouter()
  const queryClient = useQueryClient()
  const { show } = useToastStore()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['scheduled-check', checkId],
    queryFn: () => api.tasks.scheduledCheck(checkId!).then((r) => r.data),
    enabled: !!checkId,
    staleTime: 30 * 1000,
  })

  const [refreshing, setRefreshing] = useState(false)
  const [checkingMachine, setCheckingMachine] = useState<ScheduledCheckMachine | null>(null)
  const [completing, setCompleting] = useState(false)

  const handleRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false) }

  const handleSubmitCheck = useCallback(
    async (payload: { condition: string; notes: string; hoursReading?: string; tagUid?: string; photos: { uri: string; filename: string }[] }) => {
      if (!checkingMachine || !data) throw new Error('No machine / data')
      await api.equipment.submitDailyCheck({
        machine_id: checkingMachine.machine_id,
        project_id: data.project_id,
        condition: payload.condition,
        notes: payload.notes || undefined,
        hours_reading: payload.hoursReading,
        tag_uid: payload.tagUid,
        photos: payload.photos,
      })
      show('Check recorded', 'success')
      setCheckingMachine(null)
      queryClient.invalidateQueries({ queryKey: ['scheduled-check', checkId] })
      queryClient.invalidateQueries({ queryKey: ['admin-task-overview'] })
      queryClient.invalidateQueries({ queryKey: ['my-todos'] })
      if (payload.condition === 'broken_down') {
        router.push({ pathname: '/breakdown/new', params: { machine_id: String(checkingMachine.machine_id), machine_name: checkingMachine.name } })
      }
    },
    [checkingMachine, data, checkId, queryClient, router, show]
  )

  const handleComplete = async () => {
    if (!checkId) return
    setCompleting(true)
    try {
      await api.tasks.completeScheduledCheck(checkId)
      show('Check completed', 'success')
      queryClient.invalidateQueries({ queryKey: ['my-todos'] })
      queryClient.invalidateQueries({ queryKey: ['scheduled-check', checkId] })
      queryClient.invalidateQueries({ queryKey: ['admin-task-overview'] })
      queryClient.invalidateQueries({ queryKey: ['scheduled-checks'] })
      router.back()
    } catch { show('Failed to complete', 'error') }
    finally { setCompleting(false) }
  }

  const machines = data?.machines ?? []
  const sorted = [...machines].sort((a, b) => (a.check ? 1 : 0) - (b.check ? 1 : 0))
  const total = data?.total ?? 0
  const checked = data?.checked ?? 0
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0
  const allDone = total > 0 && checked >= total

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <ScreenHeader title={data?.name ?? 'Equipment Check'} subtitle={data?.project_name ?? undefined} showBack />

      {/* Progress */}
      {total > 0 && (
        <View style={s.progressWrap}>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${pct}%`, backgroundColor: allDone ? Colors.success : Colors.primary }]} />
          </View>
          <Text style={s.progressLabel}>{checked} / {total} machines checked</Text>
        </View>
      )}

      {isLoading ? (
        <View style={s.body}>{[0, 1, 2].map((i) => <View key={i} style={s.skeleton} />)}</View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => String(item.machine_id)}
          renderItem={({ item }) => <MachineCheckCard machine={item} onCheck={() => setCheckingMachine(item)} />}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={allDone && !data?.completed_today ? (
            <TouchableOpacity style={s.completeBtn} onPress={handleComplete} disabled={completing} activeOpacity={0.85}>
              {completing ? <ActivityIndicator size="small" color={Colors.dark} /> : (
                <><Ionicons name="checkmark-circle" size={20} color={Colors.dark} /><Text style={s.completeBtnText}>MARK CHECK COMPLETE</Text></>
              )}
            </TouchableOpacity>
          ) : data?.completed_today ? (
            <View style={s.doneBanner}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={s.doneText}>Check completed for today</Text>
            </View>
          ) : null}
        />
      )}

      {checkingMachine && (
        <CheckModal visible={!!checkingMachine} machine={checkingMachine}
          onClose={() => setCheckingMachine(null)} onSubmit={handleSubmitCheck}
          initialCondition={checkingMachine.check?.condition}
          initialNotes={checkingMachine.check?.notes}
          initialHours={checkingMachine.check?.hours_reading != null ? String(checkingMachine.check.hours_reading) : undefined}
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },
  body: { flex: 1, backgroundColor: Colors.background, padding: Spacing.md, gap: Spacing.sm },
  list: { padding: Spacing.md, gap: Spacing.sm, backgroundColor: Colors.background, paddingBottom: Spacing.xxl },
  progressWrap: { backgroundColor: Colors.background, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  progressTrack: { height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressLabel: { ...Typography.caption, color: Colors.textLight, marginTop: Spacing.xs },
  accentBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, borderTopLeftRadius: BorderRadius.md, borderBottomLeftRadius: BorderRadius.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.md, paddingLeft: Spacing.md + 4, paddingRight: Spacing.md, gap: Spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: BorderRadius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  info: { flex: 1 },
  name: { ...Typography.h4, color: Colors.textPrimary },
  type: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusPill: { borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { ...Typography.caption, fontWeight: '700' },
  checkBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2 },
  checkBtnText: { ...Typography.caption, color: Colors.dark, fontWeight: '700' },
  alertBanner: { paddingHorizontal: Spacing.md + 4, paddingVertical: 5, gap: 3, backgroundColor: 'rgba(201,106,0,0.08)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(201,106,0,0.2)' },
  alertText: { ...Typography.caption, fontWeight: '600' },
  transferBanner: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md + 4, paddingVertical: 5, backgroundColor: 'rgba(21,101,192,0.08)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(21,101,192,0.2)' },
  transferText: { ...Typography.caption, color: '#1565C0', fontWeight: '600' },
  notesBanner: { paddingHorizontal: Spacing.md + 4, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  notesText: { ...Typography.caption, color: Colors.textSecondary },
  skeleton: { height: 72, backgroundColor: Colors.surface, borderRadius: BorderRadius.md },
  completeBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  completeBtnText: { ...Typography.h4, color: Colors.dark, letterSpacing: 0.5 },
  doneBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.md, backgroundColor: 'rgba(61,139,65,0.12)', borderRadius: BorderRadius.sm, paddingVertical: Spacing.sm },
  doneText: { ...Typography.caption, color: Colors.success, fontWeight: '700' },
})

const m = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.dark, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 4 },
  cancel: { ...Typography.body, color: Colors.textLight },
  title: { ...Typography.h4, color: Colors.white, flex: 1, textAlign: 'center', marginHorizontal: Spacing.sm },
  save: { ...Typography.body, color: Colors.primary, fontWeight: '700' },
  body: { padding: Spacing.md },
  label: { ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm },
  conditionRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  conditionBtn: { flex: 1, minWidth: '45%', paddingVertical: Spacing.sm + 2, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, alignItems: 'center' },
  conditionBtnText: { ...Typography.bodySmall, color: Colors.textSecondary, fontWeight: '500' },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, ...Typography.body, color: Colors.textPrimary, minHeight: 80 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  photoThumb: { width: 80, height: 80, borderRadius: BorderRadius.sm },
  photoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.primary, borderStyle: 'dashed' },
  photoBtnText: { ...Typography.body, color: Colors.primary, fontWeight: '600' },
  scanBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md, borderWidth: 2,
    marginBottom: Spacing.md,
  },
  scanIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  scanBannerTitle: { ...Typography.body, fontWeight: '700' },
  scanBannerSubtitle: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
})
