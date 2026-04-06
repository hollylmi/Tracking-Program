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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import ScreenHeader from '../../components/layout/ScreenHeader'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { api } from '../../lib/api'
import { API_BASE_URL } from '../../constants/api'
import { cachedQuery } from '../../lib/cachedQuery'
import { compressImage } from '../../lib/compressImage'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { useToastStore } from '../../store/toast'
import { useHire } from '../../hooks/useHire'
import { useDailyChecks } from '../../hooks/useEquipment'
import { Machine, Breakdown, HiredMachine, DailyCheckMachine } from '../../types'

// ── Fleet machine card (existing) ────────────────────────────────────────────

function MachineCard({
  machine,
  breakdowns,
  onPress,
}: {
  machine: Machine
  breakdowns: Breakdown[]
  onPress: () => void
}) {
  const myBreakdowns = breakdowns.filter(b => b.machine_id === machine.id)
  const openCount = myBreakdowns.filter(b => !b.resolved).length
  const isDown = machine.active && openCount > 0

  const borderColor = !machine.active
    ? Colors.textLight
    : isDown
    ? Colors.warning
    : Colors.success

  const statusLabel = !machine.active ? 'Inactive' : isDown ? 'Broken Down' : 'Working'
  const statusColor = !machine.active ? Colors.textLight : isDown ? Colors.warning : Colors.success
  const statusBg   = !machine.active ? Colors.surface : isDown ? 'rgba(255,152,0,0.15)' : 'rgba(76,175,80,0.15)'
  const iconColor  = !machine.active ? Colors.textLight : isDown ? Colors.warning : Colors.success
  const iconName   = !machine.active
    ? 'construct-outline'
    : isDown
    ? 'warning-outline'
    : 'checkmark-circle-outline'

  const photoUri = machine.photo_url ? `${API_BASE_URL}${machine.photo_url}` : null

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <Card padding="none" style={{ overflow: 'hidden' }}>
        <View style={[styles.accentBar, { backgroundColor: borderColor }]} />
        <View style={styles.row}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.machineThumb} />
          ) : (
            <View style={[styles.machineThumbPlaceholder, { backgroundColor: iconColor + '20' }]}>
              <Ionicons name="camera-outline" size={18} color={iconColor} />
            </View>
          )}
          <View style={styles.info}>
            <Text style={styles.name}>{machine.name}</Text>
            {machine.type ? <Text style={styles.type}>{machine.type}</Text> : null}
          </View>
          <View style={styles.right}>
            <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
          </View>
        </View>
        {isDown && (
          <View style={styles.breakdownBanner}>
            <Ionicons name="warning" size={12} color={Colors.warning} />
            <Text style={styles.breakdownBannerText}>
              {openCount} open breakdown{openCount > 1 ? 's' : ''}
            </Text>
          </View>
        )}
      </Card>
    </TouchableOpacity>
  )
}

// ── Hired machine card ────────────────────────────────────────────────────────

function getHireStatus(hm: HiredMachine): { label: string; color: string; bg: string; icon: string } {
  const today = new Date().toISOString().slice(0, 10)

  // Check if returned (past return date)
  if (hm.return_date && hm.return_date < today) {
    return {
      label: 'Returned',
      color: Colors.textLight,
      bg: Colors.surface,
      icon: 'log-out-outline',
    }
  }

  // Check for active stand-down today
  const stoodDownToday = hm.stand_downs?.some(sd => sd.date === today)
  if (stoodDownToday) {
    return {
      label: 'Stood Down',
      color: Colors.warning,
      bg: 'rgba(255,152,0,0.15)',
      icon: 'pause-circle-outline',
    }
  }

  return {
    label: 'Active',
    color: Colors.success,
    bg: 'rgba(76,175,80,0.15)',
    icon: 'checkmark-circle-outline',
  }
}

function HiredMachineCard({ machine }: { machine: HiredMachine }) {
  const status = getHireStatus(machine)

  return (
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <View style={[styles.accentBar, { backgroundColor: status.color }]} />
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: status.color + '20' }]}>
          <Ionicons name={status.icon as any} size={22} color={status.color} />
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{machine.machine_name}</Text>
          {machine.hire_company ? (
            <Text style={styles.type}>{machine.hire_company}</Text>
          ) : null}
          {machine.plant_id ? (
            <Text style={styles.type}>Plant ID: {machine.plant_id}</Text>
          ) : null}
        </View>
        <View style={styles.right}>
          <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>
      </View>
    </Card>
  )
}

// ── Tab selector ──────────────────────────────────────────────────────────────

type TabKey = 'fleet' | 'hired' | 'checks'

const TAB_LABELS: Record<TabKey, string> = { fleet: 'Fleet', hired: 'Hired', checks: 'Checks' }

function TabSelector({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <View style={tabStyles.container}>
      {(['fleet', 'hired', 'checks'] as const).map((key) => (
        <TouchableOpacity
          key={key}
          style={[tabStyles.tab, active === key && tabStyles.tabActive]}
          onPress={() => onChange(key)}
          activeOpacity={0.7}
        >
          <Text style={[tabStyles.label, active === key && tabStyles.labelActive]}>
            {TAB_LABELS[key]}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

// ── Check condition options ──────────────────────────────────────────────────

const CONDITION_OPTIONS: { value: string; label: string; color: string; bg: string }[] = [
  { value: 'good', label: 'Good', color: Colors.success, bg: 'rgba(61,139,65,0.15)' },
  { value: 'fair', label: 'Fair', color: Colors.warning, bg: 'rgba(201,106,0,0.15)' },
  { value: 'poor', label: 'Poor', color: '#E65100', bg: 'rgba(230,81,0,0.15)' },
  { value: 'broken_down', label: 'Broken Down', color: Colors.error, bg: 'rgba(198,40,40,0.15)' },
]

// ── Daily check machine card ─────────────────────────────────────────────────

function MachineCheckCard({ machine, onCheck, onViewCheck }: { machine: DailyCheckMachine; onCheck: () => void; onViewCheck?: () => void }) {
  const checked = !!machine.check
  const condOpt = CONDITION_OPTIONS.find((c) => c.value === machine.check?.condition)
  const hasAlerts = machine.alerts && machine.alerts.length > 0
  const hasTransfer = !!machine.pending_transfer

  const handlePress = () => {
    if (checked && onViewCheck) onViewCheck()
    else if (!checked) onCheck()
  }

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.8}>
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <View style={[styles.accentBar, { backgroundColor: checked ? Colors.success : hasAlerts ? Colors.warning : Colors.border }]} />
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: checked ? 'rgba(61,139,65,0.15)' : hasAlerts ? 'rgba(201,106,0,0.1)' : Colors.surface }]}>
          <Ionicons name={checked ? 'checkmark-circle' : hasAlerts ? 'alert-circle' : 'ellipse-outline'} size={22}
            color={checked ? Colors.success : hasAlerts ? Colors.warning : Colors.textLight} />
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{machine.name}</Text>
          {machine.type ? <Text style={styles.type}>{machine.type}</Text> : null}
          {machine.source === 'hired' ? <Text style={[styles.type, { color: Colors.warning }]}>Hired</Text> : null}
          {checked && machine.check?.hours_reading != null ? (
            <Text style={styles.type}>{machine.check.hours_reading} hrs</Text>
          ) : null}
        </View>
        <View style={styles.right}>
          {checked && condOpt ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
              <View style={[styles.statusPill, { backgroundColor: condOpt.bg }]}>
                <Text style={[styles.statusText, { color: condOpt.color }]}>{condOpt.label}</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={Colors.textLight} />
            </View>
          ) : (
            <TouchableOpacity style={checkStyles.checkBtn} onPress={onCheck} activeOpacity={0.8}>
              <Text style={checkStyles.checkBtnText}>Check</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {/* Alerts banner */}
      {hasAlerts && (
        <View style={checkStyles.alertBanner}>
          {machine.alerts.map((a, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name={a.type === 'inspection' ? 'search' : a.type === 'disposal' ? 'trash' : 'calendar'}
                size={12} color={a.urgency === 'danger' ? Colors.error : Colors.warning} />
              <Text style={[checkStyles.alertText, { color: a.urgency === 'danger' ? Colors.error : Colors.warning }]}>
                {a.message}
              </Text>
            </View>
          ))}
        </View>
      )}
      {/* Transfer banner */}
      {hasTransfer && (
        <View style={checkStyles.transferBanner}>
          <Ionicons name="arrow-forward-circle" size={12} color="#1565C0" />
          <Text style={checkStyles.transferText}>
            Scheduled move to {machine.pending_transfer!.to_project} — {new Date(machine.pending_transfer!.scheduled_date + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
      )}
      {checked && machine.check?.notes ? (
        <View style={checkStyles.notesBanner}>
          <Text style={checkStyles.notesText} numberOfLines={1}>{machine.check.notes}</Text>
        </View>
      ) : null}
    </Card>
    </TouchableOpacity>
  )
}

// ── Check modal ──────────────────────────────────────────────────────────────

function CheckModal({ visible, machineName, isFleetMachine, onClose, onSubmit }: {
  visible: boolean; machineName: string; isFleetMachine: boolean; onClose: () => void
  onSubmit: (condition: string, notes: string, hoursReading?: string, photoUri?: string, photoFilename?: string) => Promise<void>
}) {
  const [condition, setCondition] = useState('good')
  const [notes, setNotes] = useState('')
  const [hoursReading, setHoursReading] = useState('')
  const [photo, setPhoto] = useState<{ uri: string; filename: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
      setPhoto({ uri: compressed, filename: `dc_${Date.now()}.jpg` })
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modalStyles.root} edges={['top', 'bottom']}>
        <View style={modalStyles.header}>
          <TouchableOpacity onPress={onClose}><Text style={modalStyles.cancel}>Cancel</Text></TouchableOpacity>
          <Text style={modalStyles.title} numberOfLines={1}>{machineName}</Text>
          <TouchableOpacity onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator size="small" color={Colors.primary} /> : <Text style={modalStyles.save}>Submit</Text>}
          </TouchableOpacity>
        </View>
        <View style={modalStyles.body}>
          <Text style={modalStyles.label}>Condition</Text>
          <View style={modalStyles.conditionRow}>
            {CONDITION_OPTIONS.map((opt) => (
              <TouchableOpacity key={opt.value}
                style={[modalStyles.conditionBtn, condition === opt.value && { backgroundColor: opt.bg, borderColor: opt.color }]}
                onPress={() => setCondition(opt.value)} activeOpacity={0.8}>
                <Text style={[modalStyles.conditionBtnText, condition === opt.value && { color: opt.color, fontWeight: '700' }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {isFleetMachine && (
            <>
              <Text style={[modalStyles.label, { marginTop: Spacing.md }]}>Machine Hours</Text>
              <TextInput style={[modalStyles.input, { minHeight: 0 }]} value={hoursReading} onChangeText={setHoursReading}
                placeholder="Current hours reading" placeholderTextColor={Colors.textLight}
                keyboardType="decimal-pad" />
            </>
          )}
          <Text style={[modalStyles.label, { marginTop: Spacing.md }]}>Notes</Text>
          <TextInput style={modalStyles.input} value={notes} onChangeText={setNotes} placeholder="Optional notes"
            placeholderTextColor={Colors.textLight} multiline numberOfLines={3} textAlignVertical="top" />
          <Text style={[modalStyles.label, { marginTop: Spacing.md }]}>Photo</Text>
          {photo ? (
            <View style={modalStyles.photoRow}>
              <Image source={{ uri: photo.uri }} style={modalStyles.photoThumb} />
              <TouchableOpacity onPress={() => setPhoto(null)}><Ionicons name="close-circle" size={24} color={Colors.error} /></TouchableOpacity>
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

const tabStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  label: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  labelActive: {
    color: Colors.dark,
  },
})

// ── Check detail/edit modal (view completed check, edit, delete) ─────────────

function CheckDetailModal({ visible, machine, userRole, onClose, onSaved, onDeleted }: {
  visible: boolean; machine: DailyCheckMachine; userRole?: string
  onClose: () => void; onSaved: () => void; onDeleted: () => void
}) {
  const check = machine.check
  if (!check) return null
  const canEdit = userRole === 'admin' || userRole === 'supervisor'
  const [editing, setEditing] = useState(false)
  const [condition, setCondition] = useState(check.condition)
  const [notes, setNotes] = useState(check.notes || '')
  const [hoursReading, setHoursReading] = useState(check.hours_reading != null ? String(check.hours_reading) : '')
  const [saving, setSaving] = useState(false)
  const { show } = useToastStore()

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.equipment.editDailyCheck(check.id, {
        condition,
        notes: notes || undefined,
        hours_reading: hoursReading ? Number(hoursReading) : null,
      })
      show('Check updated', 'success')
      setEditing(false)
      onSaved()
    } catch { show('Failed to update', 'error') }
    finally { setSaving(false) }
  }

  const handleDelete = () => {
    Alert.alert('Delete Check', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await api.equipment.deleteDailyCheck(check.id)
          show('Check deleted', 'success')
          onDeleted()
        } catch { show('Failed to delete', 'error') }
      }},
    ])
  }

  const condOpt = CONDITION_OPTIONS.find((c) => c.value === (editing ? condition : check.condition))

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modalStyles.root} edges={['top', 'bottom']}>
        <View style={modalStyles.header}>
          <TouchableOpacity onPress={onClose}><Text style={modalStyles.cancel}>Close</Text></TouchableOpacity>
          <Text style={modalStyles.title} numberOfLines={1}>{machine.name}</Text>
          {canEdit && !editing ? (
            <TouchableOpacity onPress={() => setEditing(true)}><Text style={modalStyles.save}>Edit</Text></TouchableOpacity>
          ) : editing ? (
            <TouchableOpacity onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color={Colors.primary} /> : <Text style={modalStyles.save}>Save</Text>}
            </TouchableOpacity>
          ) : <View style={{ width: 40 }} />}
        </View>
        <View style={modalStyles.body}>
          {!editing ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md }}>
                {condOpt && <View style={[styles.statusPill, { backgroundColor: condOpt.bg }]}><Text style={[styles.statusText, { color: condOpt.color }]}>{condOpt.label}</Text></View>}
                {check.hours_reading != null && <Text style={{ ...Typography.body, color: Colors.textPrimary, fontWeight: '600' }}>{check.hours_reading} hrs</Text>}
              </View>
              {check.checked_by && <Text style={{ ...Typography.bodySmall, color: Colors.textSecondary, marginBottom: Spacing.xs }}>Checked by {check.checked_by}</Text>}
              {check.notes ? <Text style={{ ...Typography.body, color: Colors.textPrimary, marginBottom: Spacing.md }}>{check.notes}</Text> : null}
              {check.photo_url ? (
                <Image source={{ uri: check.photo_url }} style={{ width: '100%', height: 200, borderRadius: BorderRadius.md, marginBottom: Spacing.md }} resizeMode="cover" />
              ) : null}
              {canEdit && (
                <TouchableOpacity onPress={handleDelete} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.error, marginTop: Spacing.lg }}>
                  <Ionicons name="trash-outline" size={16} color={Colors.error} />
                  <Text style={{ ...Typography.body, color: Colors.error, fontWeight: '600' }}>Delete Check</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <>
              <Text style={modalStyles.label}>Condition</Text>
              <View style={modalStyles.conditionRow}>
                {CONDITION_OPTIONS.map((opt) => (
                  <TouchableOpacity key={opt.value}
                    style={[modalStyles.conditionBtn, condition === opt.value && { backgroundColor: opt.bg, borderColor: opt.color }]}
                    onPress={() => setCondition(opt.value)} activeOpacity={0.8}>
                    <Text style={[modalStyles.conditionBtnText, condition === opt.value && { color: opt.color, fontWeight: '700' }]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[modalStyles.label, { marginTop: Spacing.md }]}>Machine Hours</Text>
              <TextInput style={[modalStyles.input, { minHeight: 0 }]} value={hoursReading} onChangeText={setHoursReading}
                placeholder="Hours reading" placeholderTextColor={Colors.textLight} keyboardType="decimal-pad" />
              <Text style={[modalStyles.label, { marginTop: Spacing.md }]}>Notes</Text>
              <TextInput style={modalStyles.input} value={notes} onChangeText={setNotes} placeholder="Notes"
                placeholderTextColor={Colors.textLight} multiline numberOfLines={3} textAlignVertical="top" />
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function EquipmentScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const { show } = useToastStore()
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('fleet')
  const [checkingMachine, setCheckingMachine] = useState<DailyCheckMachine | null>(null)
  const [viewingCheck, setViewingCheck] = useState<DailyCheckMachine | null>(null)
  const activeProject = useProjectStore((s) => s.activeProject)
  const projectId = activeProject?.id

  // Fleet data
  const { data: machines = [], isLoading: machinesLoading, refetch: refetchMachines } =
    useQuery({
      queryKey: ['machines', projectId],
      queryFn: () =>
        cachedQuery(`machines_project_${projectId}`, () =>
          api.equipment.list(projectId).then(r => r.data.machines)
        ),
      enabled: !!projectId,
      staleTime: 5 * 60 * 1000,
    })

  const { data: breakdowns = [], isLoading: breakdownsLoading, refetch: refetchBreakdowns } =
    useQuery({
      queryKey: ['breakdowns', projectId],
      queryFn: () =>
        cachedQuery(`breakdowns_${projectId}`, () =>
          api.equipment.breakdowns(projectId).then(r => r.data.breakdowns)
        ),
      enabled: !!projectId,
      staleTime: 2 * 60 * 1000,
    })

  // Hired data
  const { data: hiredMachines = [], isLoading: hireLoading, refetch: refetchHire } =
    useHire(projectId)

  // Daily checks data
  const { data: checksData, isLoading: checksLoading, refetch: refetchChecks } =
    useDailyChecks(projectId)

  const fleetLoading = machinesLoading || breakdownsLoading
  const isLoading = activeTab === 'fleet' ? fleetLoading : activeTab === 'hired' ? hireLoading : checksLoading

  const openCount = breakdowns.filter(b => !b.resolved).length

  // Build grouped + ungrouped lists for Fleet tab
  type FleetItem = { type: 'header'; label: string } | { type: 'machine'; machine: Machine }
  const fleetItems: FleetItem[] = (() => {
    const active = machines.filter(m => m.active)
    const inactive = machines.filter(m => !m.active)

    const groups: Record<string, Machine[]> = {}
    const ungrouped: Machine[] = []
    for (const m of active) {
      if (m.group_name) {
        if (!groups[m.group_name]) groups[m.group_name] = []
        groups[m.group_name].push(m)
      } else {
        ungrouped.push(m)
      }
    }

    const items: FleetItem[] = []
    for (const [groupName, groupMachines] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) {
      items.push({ type: 'header', label: `${groupName} (${groupMachines.length})` })
      groupMachines.forEach(m => items.push({ type: 'machine', machine: m }))
    }
    if (ungrouped.length > 0 && Object.keys(groups).length > 0) {
      items.push({ type: 'header', label: `Other Equipment (${ungrouped.length})` })
    }
    ungrouped.forEach(m => items.push({ type: 'machine', machine: m }))
    if (inactive.length > 0) {
      items.push({ type: 'header', label: `Inactive (${inactive.length})` })
      inactive.forEach(m => items.push({ type: 'machine', machine: m }))
    }
    return items
  })()

  // Checks data
  const checkMachines = checksData?.machines ?? []
  const sortedChecks = [...checkMachines].sort((a, b) => (a.check ? 1 : 0) - (b.check ? 1 : 0))
  const checksTotal = checksData?.total ?? 0
  const checksChecked = checksData?.checked ?? 0
  const checksPct = checksTotal > 0 ? Math.round((checksChecked / checksTotal) * 100) : 0
  const allChecksDone = checksTotal > 0 && checksChecked >= checksTotal

  const handleRefresh = async () => {
    setRefreshing(true)
    if (activeTab === 'fleet') {
      await Promise.all([refetchMachines(), refetchBreakdowns()])
    } else if (activeTab === 'hired') {
      await refetchHire()
    } else {
      await refetchChecks()
    }
    setRefreshing(false)
  }

  const handleSubmitCheck = useCallback(
    async (condition: string, notes: string, hoursReading?: string, photoUri?: string, photoFilename?: string) => {
      if (!checkingMachine || !projectId) return
      try {
        await api.equipment.submitDailyCheck({
          machine_id: checkingMachine.machine_id ?? undefined,
          hired_machine_id: checkingMachine.hired_machine_id ?? undefined,
          project_id: projectId,
          condition,
          notes: notes || undefined,
          hours_reading: hoursReading,
          photo_uri: photoUri,
          photo_filename: photoFilename,
        })
        show('Check recorded', 'success')
        setCheckingMachine(null)
        queryClient.invalidateQueries({ queryKey: ['daily-checks'] })
        if (condition === 'broken_down') {
          router.push({
            pathname: '/breakdown/new',
            params: { machine_id: String(checkingMachine.machine_id ?? ''), machine_name: checkingMachine.name },
          })
        }
      } catch {
        show('Failed to submit check', 'error')
      }
    },
    [checkingMachine, projectId, queryClient, router, show]
  )

  const subtitle = activeTab === 'fleet'
    ? (openCount > 0 ? `${openCount} open breakdown${openCount > 1 ? 's' : ''}` : undefined)
    : activeTab === 'hired'
    ? (hiredMachines.length > 0 ? `${hiredMachines.length} hired machine${hiredMachines.length !== 1 ? 's' : ''}` : undefined)
    : (checksTotal > 0 ? `${checksChecked} / ${checksTotal} checked` : undefined)

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="Equipment" subtitle={subtitle} />
      <TabSelector active={activeTab} onChange={setActiveTab} />

      {/* Checks progress bar */}
      {activeTab === 'checks' && checksTotal > 0 && (
        <View style={checkStyles.progressWrap}>
          <View style={checkStyles.progressTrack}>
            <View style={[checkStyles.progressFill, { width: `${checksPct}%`, backgroundColor: allChecksDone ? Colors.success : Colors.primary }]} />
          </View>
          {allChecksDone && (
            <View style={checkStyles.doneBanner}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={checkStyles.doneText}>All machines checked</Text>
            </View>
          )}
        </View>
      )}

      {isLoading ? (
        <View style={styles.body}>
          {[0, 1, 2, 3].map(i => <View key={i} style={styles.skeleton} />)}
        </View>
      ) : activeTab === 'fleet' ? (
        machines.length === 0 ? (
          <EmptyState icon="🔧" title="No equipment" subtitle="No machines assigned to your projects" />
        ) : (
          <FlatList
            data={fleetItems}
            keyExtractor={(item, index) => item.type === 'header' ? `h-${index}` : `m-${item.machine.id}`}
            renderItem={({ item }) => {
              if (item.type === 'header') {
                return <Text style={styles.sectionLabel}>{item.label}</Text>
              }
              return (
                <MachineCard
                  machine={item.machine}
                  breakdowns={breakdowns}
                  onPress={() => router.push({ pathname: '/machine/[id]', params: { id: item.machine.id } })}
                />
              )
            }}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
            showsVerticalScrollIndicator={false}
          />
        )
      ) : activeTab === 'hired' ? (
        hiredMachines.length === 0 ? (
          <EmptyState icon="📋" title="No hired machines" subtitle="No hired equipment for this project" />
        ) : (
          <FlatList
            data={hiredMachines}
            keyExtractor={m => String(m.id)}
            renderItem={({ item }) => <HiredMachineCard machine={item} />}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
            showsVerticalScrollIndicator={false}
          />
        )
      ) : (
        /* Checks tab */
        checkMachines.length === 0 ? (
          <EmptyState icon="🔧" title="No machines" subtitle="No equipment assigned to this project" />
        ) : (
          <FlatList
            data={sortedChecks}
            keyExtractor={(item) => item.machine_id ? `m-${item.machine_id}` : `h-${item.hired_machine_id}`}
            renderItem={({ item }) => <MachineCheckCard machine={item} onCheck={() => setCheckingMachine(item)} onViewCheck={() => setViewingCheck(item)} />}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
            showsVerticalScrollIndicator={false}
          />
        )
      )}

      {/* Check Modal — new check */}
      {checkingMachine && (
        <CheckModal visible={!!checkingMachine} machineName={checkingMachine.name}
          isFleetMachine={checkingMachine.source === 'fleet'}
          onClose={() => setCheckingMachine(null)} onSubmit={handleSubmitCheck} />
      )}

      {/* Check Detail Modal — view/edit/delete completed check */}
      {viewingCheck && (
        <CheckDetailModal visible={!!viewingCheck} machine={viewingCheck} userRole={user?.role}
          onClose={() => setViewingCheck(null)}
          onSaved={() => { setViewingCheck(null); queryClient.invalidateQueries({ queryKey: ['daily-checks'] }) }}
          onDeleted={() => { setViewingCheck(null); queryClient.invalidateQueries({ queryKey: ['daily-checks'] }) }} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },
  body: { flex: 1, backgroundColor: Colors.background, padding: Spacing.md, gap: Spacing.sm },

  list: { padding: Spacing.md, gap: Spacing.sm, backgroundColor: Colors.background },

  sectionLabel: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
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
    paddingLeft: Spacing.md + 4,  // offset for accent bar
    paddingRight: Spacing.md,
    gap: Spacing.md,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  machineThumb: {
    width: 36,
    height: 36,
    borderRadius: 18,
    flexShrink: 0,
  },
  machineThumbPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  info: { flex: 1 },
  name: { ...Typography.h4, color: Colors.textPrimary },
  type: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

  statusPill: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusText: { ...Typography.caption, fontWeight: '700' },

  breakdownBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,152,0,0.12)',
    paddingHorizontal: Spacing.md + 4,
    paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,152,0,0.25)',
  },
  breakdownBannerText: {
    ...Typography.caption,
    color: Colors.warning,
    fontWeight: '600',
  },

  skeleton: {
    height: 72,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
})

const checkStyles = StyleSheet.create({
  checkBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
  },
  checkBtnText: { ...Typography.caption, color: Colors.dark, fontWeight: '700' },
  alertBanner: {
    paddingHorizontal: Spacing.md + 4,
    paddingVertical: 5,
    gap: 3,
    backgroundColor: 'rgba(201,106,0,0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(201,106,0,0.2)',
  },
  alertText: { ...Typography.caption, fontWeight: '600' },
  transferBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md + 4,
    paddingVertical: 5,
    backgroundColor: 'rgba(21,101,192,0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(21,101,192,0.2)',
  },
  transferText: { ...Typography.caption, color: '#1565C0', fontWeight: '600' },
  notesBanner: {
    paddingHorizontal: Spacing.md + 4,
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  notesText: { ...Typography.caption, color: Colors.textSecondary },
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
  progressFill: { height: '100%', borderRadius: 3 },
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
  doneText: { ...Typography.caption, color: Colors.success, fontWeight: '700' },
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
