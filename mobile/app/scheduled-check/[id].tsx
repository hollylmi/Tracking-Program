import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
  Modal, TextInput, ActivityIndicator, Alert, Image,
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
import { compressImage } from '../../lib/compressImage'
import { ScheduledCheckMachine } from '../../types'

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
            Moving to {machine.pending_transfer!.to_project} — {new Date(machine.pending_transfer!.scheduled_date + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
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

function CheckModal({ visible, machineName, onClose, onSubmit, initialCondition, initialNotes, initialHours }: {
  visible: boolean; machineName: string; onClose: () => void
  onSubmit: (condition: string, notes: string, hoursReading?: string, photoUri?: string, photoFilename?: string) => Promise<void>
  initialCondition?: string; initialNotes?: string; initialHours?: string
}) {
  const [condition, setCondition] = useState(initialCondition || 'good')
  const [notes, setNotes] = useState(initialNotes || '')
  const [hoursReading, setHoursReading] = useState(initialHours || '')
  const [photo, setPhoto] = useState<{ uri: string; filename: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Update state when initial values change (e.g. opening modal for a different machine)
  useEffect(() => {
    setCondition(initialCondition || 'good')
    setNotes(initialNotes || '')
    setHoursReading(initialHours || '')
  }, [initialCondition, initialNotes, initialHours])

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await onSubmit(condition, notes, hoursReading || undefined, photo?.uri, photo?.filename)
      setCondition('good'); setNotes(''); setHoursReading(''); setPhoto(null)
    } finally { setSubmitting(false) }
  }

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Camera access is needed.'); return }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
    if (!result.canceled && result.assets.length > 0) {
      const compressed = await compressImage(result.assets[0].uri)
      setPhoto({ uri: compressed, filename: `sc_${Date.now()}.jpg` })
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={m.root} edges={['top', 'bottom']}>
        <View style={m.header}>
          <TouchableOpacity onPress={onClose}><Text style={m.cancel}>Cancel</Text></TouchableOpacity>
          <Text style={m.title} numberOfLines={1}>{machineName}</Text>
          <TouchableOpacity onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator size="small" color={Colors.primary} /> : <Text style={m.save}>Submit</Text>}
          </TouchableOpacity>
        </View>
        <View style={m.body}>
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
            placeholder="Current hours reading" placeholderTextColor={Colors.textLight} keyboardType="decimal-pad" />
          <Text style={[m.label, { marginTop: Spacing.md }]}>Notes</Text>
          <TextInput style={m.input} value={notes} onChangeText={setNotes} placeholder="Optional notes"
            placeholderTextColor={Colors.textLight} multiline numberOfLines={3} textAlignVertical="top" />
          <Text style={[m.label, { marginTop: Spacing.md }]}>Photo</Text>
          {photo ? (
            <View style={m.photoRow}>
              <Image source={{ uri: photo.uri }} style={m.photoThumb} />
              <TouchableOpacity onPress={() => setPhoto(null)}><Ionicons name="close-circle" size={24} color={Colors.error} /></TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={m.photoBtn} onPress={takePhoto} activeOpacity={0.8}>
              <Ionicons name="camera-outline" size={20} color={Colors.primary} />
              <Text style={m.photoBtnText}>Take Photo</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
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
    async (condition: string, notes: string, hoursReading?: string, photoUri?: string, photoFilename?: string) => {
      if (!checkingMachine || !data) return
      try {
        await api.equipment.submitDailyCheck({
          machine_id: checkingMachine.machine_id,
          project_id: data.project_id,
          condition,
          notes: notes || undefined,
          hours_reading: hoursReading,
          photo_uri: photoUri,
          photo_filename: photoFilename,
        })
        show('Check recorded', 'success')
        setCheckingMachine(null)
        queryClient.invalidateQueries({ queryKey: ['scheduled-check', checkId] })
        if (condition === 'broken_down') {
          router.push({ pathname: '/breakdown/new', params: { machine_id: String(checkingMachine.machine_id), machine_name: checkingMachine.name } })
        }
      } catch { show('Failed to submit check', 'error') }
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
        <CheckModal visible={!!checkingMachine} machineName={checkingMachine.name}
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
})
