import { useState, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import ScreenHeader from '../../components/layout/ScreenHeader'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { useProjectStore } from '../../store/project'
import { useToastStore } from '../../store/toast'
import { useDailyChecks } from '../../hooks/useEquipment'
import { api } from '../../lib/api'
import { compressImage } from '../../lib/compressImage'
import { DailyCheckMachine } from '../../types'

const CONDITION_OPTIONS: { value: string; label: string; color: string; bg: string }[] = [
  { value: 'good', label: 'Good', color: Colors.success, bg: 'rgba(61,139,65,0.15)' },
  { value: 'fair', label: 'Fair', color: Colors.warning, bg: 'rgba(201,106,0,0.15)' },
  { value: 'poor', label: 'Poor', color: '#E65100', bg: 'rgba(230,81,0,0.15)' },
  { value: 'broken_down', label: 'Broken Down', color: Colors.error, bg: 'rgba(198,40,40,0.15)' },
]

function MachineCheckCard({
  machine,
  onCheck,
}: {
  machine: DailyCheckMachine
  onCheck: () => void
}) {
  const checked = !!machine.check
  const condition = machine.check?.condition
  const condOpt = CONDITION_OPTIONS.find((c) => c.value === condition)

  return (
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <View style={[styles.accentBar, { backgroundColor: checked ? Colors.success : Colors.border }]} />
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: checked ? 'rgba(61,139,65,0.15)' : Colors.surface }]}>
          <Ionicons
            name={checked ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={checked ? Colors.success : Colors.textLight}
          />
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{machine.name}</Text>
          {machine.type ? <Text style={styles.type}>{machine.type}</Text> : null}
          {machine.source === 'hired' ? (
            <Text style={[styles.type, { color: Colors.warning }]}>Hired</Text>
          ) : null}
        </View>
        <View style={styles.right}>
          {checked && condOpt ? (
            <View style={[styles.conditionPill, { backgroundColor: condOpt.bg }]}>
              <Text style={[styles.conditionText, { color: condOpt.color }]}>{condOpt.label}</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.checkBtn} onPress={onCheck} activeOpacity={0.8}>
              <Text style={styles.checkBtnText}>Check</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {checked && machine.check?.notes ? (
        <View style={styles.notesBanner}>
          <Text style={styles.notesText} numberOfLines={1}>{machine.check.notes}</Text>
        </View>
      ) : null}
    </Card>
  )
}

function CheckModal({
  visible,
  machineName,
  onClose,
  onSubmit,
}: {
  visible: boolean
  machineName: string
  onClose: () => void
  onSubmit: (condition: string, notes: string, photoUri?: string, photoFilename?: string) => Promise<void>
}) {
  const [condition, setCondition] = useState('good')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<{ uri: string; filename: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await onSubmit(condition, notes, photo?.uri, photo?.filename)
      setCondition('good')
      setNotes('')
      setPhoto(null)
    } finally {
      setSubmitting(false)
    }
  }

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Camera access is needed.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    })
    if (!result.canceled && result.assets.length > 0) {
      const compressed = await compressImage(result.assets[0].uri)
      setPhoto({ uri: compressed, filename: `dc_${Date.now()}.jpg` })
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modalStyles.root} edges={['top', 'bottom']}>
        <View style={modalStyles.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={modalStyles.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={modalStyles.title} numberOfLines={1}>{machineName}</Text>
          <TouchableOpacity onPress={handleSubmit} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Text style={modalStyles.save}>Submit</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={modalStyles.body}>
          <Text style={modalStyles.label}>Condition</Text>
          <View style={modalStyles.conditionRow}>
            {CONDITION_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  modalStyles.conditionBtn,
                  condition === opt.value && { backgroundColor: opt.bg, borderColor: opt.color },
                ]}
                onPress={() => setCondition(opt.value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    modalStyles.conditionBtnText,
                    condition === opt.value && { color: opt.color, fontWeight: '700' },
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[modalStyles.label, { marginTop: Spacing.md }]}>Notes</Text>
          <TextInput
            style={modalStyles.input}
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional notes"
            placeholderTextColor={Colors.textLight}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          <Text style={[modalStyles.label, { marginTop: Spacing.md }]}>Photo</Text>
          {photo ? (
            <View style={modalStyles.photoRow}>
              <Image source={{ uri: photo.uri }} style={modalStyles.photoThumb} />
              <TouchableOpacity onPress={() => setPhoto(null)}>
                <Ionicons name="close-circle" size={24} color={Colors.error} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={modalStyles.photoBtn} onPress={takePhoto} activeOpacity={0.8}>
              <Ionicons name="camera-outline" size={20} color={Colors.primary} />
              <Text style={modalStyles.photoBtnText}>Take Photo</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  )
}

export default function EquipmentChecksScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { show } = useToastStore()
  const activeProject = useProjectStore((s) => s.activeProject)
  const projectId = activeProject?.id

  const { data, isLoading, refetch } = useDailyChecks(projectId)
  const [refreshing, setRefreshing] = useState(false)
  const [checkingMachine, setCheckingMachine] = useState<DailyCheckMachine | null>(null)

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  const handleSubmitCheck = useCallback(
    async (condition: string, notes: string, photoUri?: string, photoFilename?: string) => {
      if (!checkingMachine || !projectId) return
      try {
        const result = await api.equipment.submitDailyCheck({
          machine_id: checkingMachine.machine_id ?? undefined,
          hired_machine_id: checkingMachine.hired_machine_id ?? undefined,
          project_id: projectId,
          condition,
          notes: notes || undefined,
          photo_uri: photoUri,
          photo_filename: photoFilename,
        })
        show('Check recorded', 'success')
        setCheckingMachine(null)
        queryClient.invalidateQueries({ queryKey: ['daily-checks'] })

        if (condition === 'broken_down') {
          router.push({
            pathname: '/breakdown/new',
            params: {
              machine_id: String(checkingMachine.machine_id ?? ''),
              machine_name: checkingMachine.name,
            },
          })
        }
      } catch {
        show('Failed to submit check', 'error')
      }
    },
    [checkingMachine, projectId, queryClient, router, show]
  )

  const total = data?.total ?? 0
  const checked = data?.checked ?? 0
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0
  const allDone = total > 0 && checked >= total

  const machines = data?.machines ?? []
  // Sort: unchecked first
  const sorted = [...machines].sort((a, b) => (a.check ? 1 : 0) - (b.check ? 1 : 0))

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title="Daily Checks"
        subtitle={total > 0 ? `${checked} / ${total} checked` : undefined}
      />

      {/* Progress bar */}
      {total > 0 && (
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${pct}%`,
                  backgroundColor: allDone ? Colors.success : Colors.primary,
                },
              ]}
            />
          </View>
          {allDone && (
            <View style={styles.doneBanner}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.doneText}>All machines checked</Text>
            </View>
          )}
        </View>
      )}

      {isLoading ? (
        <View style={styles.body}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeleton} />
          ))}
        </View>
      ) : machines.length === 0 ? (
        <EmptyState
          icon="🔧"
          title="No machines"
          subtitle="No equipment assigned to this project"
        />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) =>
            item.machine_id ? `m-${item.machine_id}` : `h-${item.hired_machine_id}`
          }
          renderItem={({ item }) => (
            <MachineCheckCard
              machine={item}
              onCheck={() => setCheckingMachine(item)}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Check Modal */}
      {checkingMachine && (
        <CheckModal
          visible={!!checkingMachine}
          machineName={checkingMachine.name}
          onClose={() => setCheckingMachine(null)}
          onSubmit={handleSubmitCheck}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },
  body: { flex: 1, backgroundColor: Colors.background, padding: Spacing.md, gap: Spacing.sm },
  list: { padding: Spacing.md, gap: Spacing.sm, backgroundColor: Colors.background },

  progressWrap: {
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  progressTrack: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  doneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    backgroundColor: 'rgba(61,139,65,0.12)',
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.xs,
  },
  doneText: {
    ...Typography.caption,
    color: Colors.success,
    fontWeight: '700',
  },

  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: BorderRadius.md,
    borderBottomLeftRadius: BorderRadius.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingLeft: Spacing.md + 4,
    paddingRight: Spacing.md,
    gap: Spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  info: { flex: 1 },
  name: { ...Typography.h4, color: Colors.textPrimary },
  type: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

  conditionPill: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  conditionText: { ...Typography.caption, fontWeight: '700' },

  checkBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
  },
  checkBtnText: { ...Typography.caption, color: Colors.dark, fontWeight: '700' },

  notesBanner: {
    paddingHorizontal: Spacing.md + 4,
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  notesText: { ...Typography.caption, color: Colors.textSecondary },

  skeleton: {
    height: 72,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
  },
})

const modalStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.dark,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
  },
  cancel: { ...Typography.body, color: Colors.textLight },
  title: { ...Typography.h4, color: Colors.white, flex: 1, textAlign: 'center', marginHorizontal: Spacing.sm },
  save: { ...Typography.body, color: Colors.primary, fontWeight: '700' },
  body: { padding: Spacing.md },
  label: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  conditionRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  conditionBtn: {
    flex: 1,
    minWidth: '45%',
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  conditionBtnText: { ...Typography.bodySmall, color: Colors.textSecondary, fontWeight: '500' },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.body,
    color: Colors.textPrimary,
    minHeight: 80,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  photoThumb: { width: 80, height: 80, borderRadius: BorderRadius.sm },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
  },
  photoBtnText: { ...Typography.body, color: Colors.primary, fontWeight: '600' },
})
