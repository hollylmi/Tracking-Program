import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Image,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as ImagePicker from 'expo-image-picker'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import ScreenHeader from '../../components/layout/ScreenHeader'
import { formatDate as fmtDateAU } from '../../lib/dates'
import Card from '../../components/ui/Card'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { api } from '../../lib/api'
import { cachedQuery } from '../../lib/cachedQuery'
import { compressImage } from '../../lib/compressImage'
import { useToastStore } from '../../store/toast'
import { Machine } from '../../types'

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function MachineRow({ machine, selected, onPress }: {
  machine: Machine
  selected: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.machineRow, selected && styles.machineRowSelected]}
    >
      <View style={styles.machineRowLeft}>
        <Ionicons name="construct-outline" size={18} color={selected ? Colors.dark : Colors.textSecondary} />
        <View>
          <Text style={[styles.machineRowName, selected && styles.machineRowNameSelected]}>
            {machine.name}
          </Text>
          <Text style={styles.machineRowType}>{machine.type}</Text>
        </View>
      </View>
      {selected && <Ionicons name="checkmark-circle" size={20} color={Colors.dark} />}
    </TouchableOpacity>
  )
}

const STATUS_OPTIONS: { value: 'pending' | 'in_progress'; label: string }[] = [
  { value: 'pending', label: 'Pending Repair' },
  { value: 'in_progress', label: 'In Progress' },
]

export default function NewBreakdownScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ machine_id?: string; machine_name?: string }>()
  const { show } = useToastStore()

  const preselectedId = params.machine_id ? Number(params.machine_id) : null

  const [machineId, setMachineId] = useState<number | null>(preselectedId)
  const [date, setDate] = useState(today())
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [incidentTime, setIncidentTime] = useState('')
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [description, setDescription] = useState('')
  const [repairingBy, setRepairingBy] = useState('')
  const [repairStatus, setRepairStatus] = useState<'pending' | 'in_progress'>('pending')
  const [anticipatedReturn, setAnticipatedReturn] = useState<string | null>(null)
  const [showReturnPicker, setShowReturnPicker] = useState(false)
  const [photos, setPhotos] = useState<{ uri: string; filename: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ machine?: string; description?: string }>({})

  const { data: machines = [], isLoading: machinesLoading } = useQuery({
    queryKey: ['machines'],
    queryFn: () =>
      cachedQuery('equipment_all', () =>
        api.equipment.list().then(r => r.data.machines)
      ),
    staleTime: 5 * 60 * 1000,
  })

  const activeMachines = machines.filter(m => m.active)

  const validate = () => {
    const e: typeof errors = {}
    if (!machineId) e.machine = 'Select a machine'
    if (!description.trim()) e.description = 'Enter a description of the breakdown'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitting(true)
    try {
      const result = await api.equipment.createBreakdown({
        machine_id: machineId!,
        breakdown_date: date,
        description: description.trim(),
        incident_time: incidentTime.trim() || undefined,
        repairing_by: repairingBy.trim() || undefined,
        repair_status: repairStatus,
        anticipated_return: anticipatedReturn || undefined,
      })
      // Upload photos if any
      if (photos.length > 0) {
        await Promise.allSettled(
          photos.map(p => api.equipment.uploadBreakdownPhoto(result.data.id, p.uri, p.filename))
        )
      }
      show('Breakdown reported', 'success')
      router.back()
    } catch {
      show('Failed to submit. Check your connection.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Camera access is needed to take photos.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    })
    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0]
      const compressed = await compressImage(asset.uri)
      setPhotos(prev => [...prev, { uri: compressed, filename: `bd_${Date.now()}.jpg` }])
    }
  }

  async function pickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Photo library access is needed.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: true,
    })
    if (!result.canceled) {
      const picked = await Promise.all(
        result.assets.map(async a => ({
          uri: await compressImage(a.uri),
          filename: `bd_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`,
        }))
      )
      setPhotos(prev => [...prev, ...picked])
    }
  }

  function addPhoto() {
    Alert.alert('Add Photo', 'Choose a source', [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Library', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const displayDate = fmtDateAU(date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })

  const displayReturn = anticipatedReturn
    ? fmtDateAU(anticipatedReturn, { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="Report Breakdown" showBack />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Machine selection */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Machine *</Text>
          {errors.machine && <Text style={styles.fieldError}>{errors.machine}</Text>}

          {machinesLoading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.sm }} />
          ) : activeMachines.length === 0 ? (
            <Text style={styles.emptyText}>No active machines found</Text>
          ) : (
            <View style={styles.machineList}>
              {activeMachines.map(m => (
                <MachineRow
                  key={m.id}
                  machine={m}
                  selected={machineId === m.id}
                  onPress={() => {
                    setMachineId(m.id)
                    setErrors(e => ({ ...e, machine: undefined }))
                  }}
                />
              ))}
            </View>
          )}
        </Card>

        {/* Date & Time */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Date & Time</Text>
          <TouchableOpacity
            style={styles.dateBtn}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="calendar-outline" size={18} color={Colors.textSecondary} />
            <Text style={styles.dateBtnText}>{displayDate}</Text>
            <Ionicons name="chevron-down" size={16} color={Colors.textLight} />
          </TouchableOpacity>

          {showDatePicker && (
            <DateTimePicker
              value={new Date(date + 'T00:00:00')}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              maximumDate={new Date()}
              onChange={(_, selected) => {
                setShowDatePicker(Platform.OS === 'ios')
                if (selected) {
                  const y = selected.getFullYear()
                  const m = String(selected.getMonth() + 1).padStart(2, '0')
                  const d = String(selected.getDate()).padStart(2, '0')
                  setDate(`${y}-${m}-${d}`)
                }
              }}
            />
          )}

          <View style={styles.timeRow}>
            <TouchableOpacity
              style={[styles.dateBtn, styles.timeBtn]}
              onPress={() => setShowTimePicker(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="time-outline" size={18} color={Colors.textSecondary} />
              <Text style={[styles.dateBtnText, !incidentTime && { color: Colors.textLight }]}>
                {incidentTime || 'Time (optional)'}
              </Text>
              <Ionicons name="chevron-down" size={16} color={Colors.textLight} />
            </TouchableOpacity>
            {incidentTime ? (
              <TouchableOpacity onPress={() => setIncidentTime('')} style={styles.clearBtn}>
                <Ionicons name="close-circle" size={20} color={Colors.textLight} />
              </TouchableOpacity>
            ) : null}
          </View>

          {showTimePicker && (
            <DateTimePicker
              value={(() => {
                if (incidentTime) {
                  const [h, m] = incidentTime.split(':').map(Number)
                  const d = new Date()
                  d.setHours(h, m, 0, 0)
                  return d
                }
                return new Date()
              })()}
              mode="time"
              is24Hour
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, selected) => {
                setShowTimePicker(Platform.OS === 'ios')
                if (selected) {
                  const h = String(selected.getHours()).padStart(2, '0')
                  const m = String(selected.getMinutes()).padStart(2, '0')
                  setIncidentTime(`${h}:${m}`)
                }
              }}
            />
          )}
        </Card>

        {/* Description */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Description *</Text>
          <Text style={styles.sectionHint}>Describe what happened and any visible damage or symptoms.</Text>
          {errors.description && <Text style={styles.fieldError}>{errors.description}</Text>}
          <TextInput
            style={[styles.textArea, errors.description && styles.inputError]}
            value={description}
            onChangeText={t => {
              setDescription(t)
              if (t.trim()) setErrors(e => ({ ...e, description: undefined }))
            }}
            placeholder="e.g. Hydraulic leak on left arm, machine unable to operate"
            placeholderTextColor={Colors.textLight}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
        </Card>

        {/* Repair Details */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Repair Details</Text>

          <Text style={styles.fieldLabel}>Status</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.statusBtn, repairStatus === opt.value && styles.statusBtnActive]}
                onPress={() => setRepairStatus(opt.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.statusBtnText, repairStatus === opt.value && styles.statusBtnTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: Spacing.md }]}>Repairing By</Text>
          <TextInput
            style={styles.input}
            value={repairingBy}
            onChangeText={setRepairingBy}
            placeholder="Name or workshop"
            placeholderTextColor={Colors.textLight}
          />

          <Text style={[styles.fieldLabel, { marginTop: Spacing.md }]}>Anticipated Return</Text>
          <View style={styles.timeRow}>
            <TouchableOpacity
              style={[styles.dateBtn, styles.timeBtn]}
              onPress={() => setShowReturnPicker(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="calendar-outline" size={18} color={Colors.textSecondary} />
              <Text style={[styles.dateBtnText, !displayReturn && { color: Colors.textLight }]}>
                {displayReturn || 'Select date (optional)'}
              </Text>
              <Ionicons name="chevron-down" size={16} color={Colors.textLight} />
            </TouchableOpacity>
            {anticipatedReturn ? (
              <TouchableOpacity onPress={() => setAnticipatedReturn(null)} style={styles.clearBtn}>
                <Ionicons name="close-circle" size={20} color={Colors.textLight} />
              </TouchableOpacity>
            ) : null}
          </View>

          {showReturnPicker && (
            <DateTimePicker
              value={anticipatedReturn ? new Date(anticipatedReturn + 'T00:00:00') : new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(_, selected) => {
                setShowReturnPicker(Platform.OS === 'ios')
                if (selected) {
                  const y = selected.getFullYear()
                  const m = String(selected.getMonth() + 1).padStart(2, '0')
                  const d = String(selected.getDate()).padStart(2, '0')
                  setAnticipatedReturn(`${y}-${m}-${d}`)
                }
              }}
            />
          )}
        </Card>

        {/* Photos */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <Text style={styles.sectionHint}>Attach photos of the damage or breakdown site.</Text>

          {photos.length > 0 && (
            <View style={styles.photoGrid}>
              {photos.map((p, i) => (
                <View key={i} style={styles.photoThumbWrap}>
                  <Image source={{ uri: p.uri }} style={styles.photoThumb} />
                  <TouchableOpacity
                    style={styles.photoRemove}
                    onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                  >
                    <Ionicons name="close-circle" size={20} color={Colors.error} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity style={styles.addPhotoBtn} onPress={addPhoto} activeOpacity={0.8}>
            <Ionicons name="camera-outline" size={20} color={Colors.primary} />
            <Text style={styles.addPhotoBtnText}>Add Photo</Text>
          </TouchableOpacity>
        </Card>

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.dark} size="small" />
          ) : (
            <>
              <Ionicons name="warning-outline" size={18} color={Colors.dark} />
              <Text style={styles.submitBtnText}>SUBMIT BREAKDOWN REPORT</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },
  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },

  section: {},
  sectionTitle: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  sectionHint: {
    ...Typography.caption,
    color: Colors.textLight,
    marginBottom: Spacing.sm,
    marginTop: -4,
  },
  fieldLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },

  fieldError: {
    ...Typography.caption,
    color: Colors.error,
    marginBottom: Spacing.xs,
  },

  machineList: { gap: Spacing.xs },
  machineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  machineRowSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  machineRowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  machineRowName: { ...Typography.bodySmall, color: Colors.textPrimary, fontWeight: '500' },
  machineRowNameSelected: { color: Colors.dark, fontWeight: '700' },
  machineRowType: { ...Typography.caption, color: Colors.textSecondary },

  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  dateBtnText: { ...Typography.body, color: Colors.textPrimary, flex: 1 },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  timeBtn: { flex: 1 },
  clearBtn: { padding: 4 },

  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.body,
    color: Colors.textPrimary,
  },

  statusRow: { flexDirection: 'row', gap: Spacing.sm },
  statusBtn: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  statusBtnActive: {
    backgroundColor: Colors.warning + '20',
    borderColor: Colors.warning,
  },
  statusBtnText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '500' },
  statusBtnTextActive: { color: Colors.warning, fontWeight: '700' },

  textArea: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.body,
    color: Colors.textPrimary,
    minHeight: 120,
  },
  inputError: { borderColor: Colors.error },

  emptyText: { ...Typography.body, color: Colors.textLight, textAlign: 'center', padding: Spacing.md },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  photoThumbWrap: { position: 'relative' },
  photoThumb: { width: 80, height: 80, borderRadius: BorderRadius.sm },
  photoRemove: { position: 'absolute', top: -8, right: -8 },

  addPhotoBtn: {
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
  addPhotoBtnText: { ...Typography.body, color: Colors.primary, fontWeight: '600' },

  submitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { ...Typography.h4, color: Colors.dark, letterSpacing: 0.5 },
})
