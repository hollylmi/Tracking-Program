import 'react-native-get-random-values'
import { v4 as uuidv4 } from 'uuid'
import { useState, useRef, forwardRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import Button from '../../components/ui/Button'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../constants/theme'
import { useReference } from '../../hooks/useReference'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { useProjectStore } from '../../store/project'
import { useToastStore } from '../../store/toast'
import { api } from '../../lib/api'
import { saveEntry, markEntrySynced } from '../../lib/db'
import { LocalEntry, LotMaterialProgress } from '../../types'

// ── Constants ──────────────────────────────────────────────────────────────────

const SLATE = '#475569'

const WEATHER_OPTIONS = [
  'Clear', 'Cloudy', 'Overcast', 'Light Rain',
  'Heavy Rain', 'Wet - No Work', 'Wind', 'Extreme Heat',
]

const DELAY_REASONS = [
  'Wet Weather',
  'Client Delay',
  'Client Hold due to Subgrade Approval',
  'Mechanical Breakdown',
  'Access Issue',
  'Safety Stop',
  'Other',
]

// Step indicator labels (short, for dots)
const STEP_INDICATOR_LABELS = ['Details', 'Production', 'Crew', 'Equipment', 'Delays']

// Internal header titles per step
const STEP_HEADER_TITLES: Record<number, string> = {
  1: 'Entry Details',
  2: 'Production',
  3: 'Crew',
  4: 'Equipment',
  5: 'Delays & Notes',
}

const TOTAL_STEPS = 5

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// ── InternalHeader ─────────────────────────────────────────────────────────────

interface InternalHeaderProps {
  step: number
  onBack: () => void
}

function InternalHeader({ step, onBack }: InternalHeaderProps) {
  return (
    <View style={ih.bar}>
      <TouchableOpacity style={ih.backBtn} onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="chevron-back" size={24} color={Colors.white} />
      </TouchableOpacity>
      <Text style={ih.title} numberOfLines={1}>{STEP_HEADER_TITLES[step]}</Text>
      <Text style={ih.counter}>Step {step} of {TOTAL_STEPS}</Text>
    </View>
  )
}

const ih = StyleSheet.create({
  bar: {
    backgroundColor: SLATE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 13,
  },
  backBtn: {
    width: 32,
    alignItems: 'flex-start',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  counter: {
    width: 72,
    textAlign: 'right',
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '400',
  },
})

// ── StepIndicator ──────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <View style={si.container}>
      <View style={si.row}>
        {STEP_INDICATOR_LABELS.map((label, i) => {
          const step = i + 1
          const done = step < current
          const active = step === current
          return (
            <View key={step} style={si.item}>
              <View style={[si.dot, done && si.dotDone, active && si.dotActive]}>
                {done && <Ionicons name="checkmark" size={11} color={Colors.white} />}
              </View>
              <Text style={[si.label, active && si.labelActive]}>{label}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

const si = StyleSheet.create({
  container: {
    backgroundColor: Colors.white,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  item: { flex: 1, alignItems: 'center', gap: 5 },
  dot: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: Colors.border,
    backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  dotDone: { backgroundColor: Colors.dark, borderColor: Colors.dark },
  dotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  label: { ...Typography.caption, color: Colors.textSecondary, textAlign: 'center' },
  labelActive: { color: Colors.primaryDark, fontWeight: '600' },
})

// ── SelectField ────────────────────────────────────────────────────────────────

interface SelectFieldProps {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
  placeholder?: string
  optional?: boolean
  error?: string
}

function SelectField({ label, value, options, onChange, placeholder = 'Select...', optional, error }: SelectFieldProps) {
  const [open, setOpen] = useState(false)

  if (options.length === 0) {
    return (
      <View style={sf.group}>
        <Text style={sf.label}>{label}{!optional && ' *'}</Text>
        <TextInput
          style={[sf.input, !!error && sf.inputError]}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={Colors.textLight}
        />
        {error && <Text style={sf.error}>{error}</Text>}
      </View>
    )
  }

  return (
    <View style={sf.group}>
      <Text style={sf.label}>{label}{!optional && ' *'}</Text>
      <TouchableOpacity
        style={[sf.select, !!error && sf.inputError]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[sf.selectText, !value && sf.placeholder]}>{value || placeholder}</Text>
        <Ionicons name="chevron-down" size={16} color={Colors.textSecondary} />
      </TouchableOpacity>
      {error && <Text style={sf.error}>{error}</Text>}

      <Modal visible={open} transparent animationType="slide">
        <TouchableOpacity style={sf.backdrop} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={sf.sheet}>
            <View style={sf.sheetHeader}>
              <Text style={sf.sheetTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Ionicons name="close" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={optional ? ['', ...options] : options}
              keyExtractor={(item, idx) => `${item}-${idx}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[sf.option, item === value && sf.optionSelected]}
                  onPress={() => { onChange(item); setOpen(false) }}
                >
                  <Text style={[sf.optionText, item === value && sf.optionTextSelected]}>
                    {item || '— None —'}
                  </Text>
                  {item === value && <Ionicons name="checkmark" size={16} color={Colors.primary} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

const sf = StyleSheet.create({
  group: { marginBottom: Spacing.md },
  label: {
    ...Typography.label, color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    ...Typography.body, color: Colors.textPrimary, backgroundColor: Colors.white,
  },
  inputError: { borderColor: Colors.error },
  select: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 12, backgroundColor: Colors.white,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  selectText: { ...Typography.body, color: Colors.textPrimary },
  placeholder: { color: Colors.textLight },
  error: { ...Typography.bodySmall, color: Colors.error, marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: BorderRadius.lg, borderTopRightRadius: BorderRadius.lg,
    maxHeight: '60%', paddingBottom: Spacing.xl,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  sheetTitle: { ...Typography.h4, color: Colors.textPrimary },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.surface,
  },
  optionSelected: { backgroundColor: '#FFF5F7' },
  optionText: { ...Typography.body, color: Colors.textPrimary },
  optionTextSelected: { color: Colors.primary, fontWeight: '600' },
})

// ── FieldInput ─────────────────────────────────────────────────────────────────

interface FieldInputProps {
  label: string
  value: string
  onChangeText: (v: string) => void
  placeholder?: string
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad'
  multiline?: boolean
  optional?: boolean
  minHeight?: number
  error?: string
  returnKeyType?: 'next' | 'done' | 'default'
  onSubmitEditing?: () => void
}

const FieldInput = forwardRef<TextInput, FieldInputProps>(function FieldInput(
  {
    label, value, onChangeText, placeholder,
    keyboardType = 'default', multiline, optional, minHeight, error,
    returnKeyType = 'default', onSubmitEditing,
  },
  ref,
) {
  return (
    <View style={fi.group}>
      <Text style={fi.label}>{label}{!optional && ' *'}</Text>
      <TextInput
        ref={ref}
        style={[
          fi.input,
          multiline && { minHeight: minHeight ?? 80, textAlignVertical: 'top', paddingTop: 12 },
          !!error && fi.inputError,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textLight}
        keyboardType={keyboardType}
        multiline={multiline}
        returnKeyType={multiline ? 'default' : returnKeyType}
        onSubmitEditing={multiline ? undefined : onSubmitEditing}
        blurOnSubmit={multiline ? false : returnKeyType === 'done'}
      />
      {error && <Text style={fi.error}>{error}</Text>}
    </View>
  )
})

const fi = StyleSheet.create({
  group: { marginBottom: Spacing.md },
  label: {
    ...Typography.label, color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    ...Typography.body, color: Colors.textPrimary, backgroundColor: Colors.white,
  },
  inputError: { borderColor: Colors.error },
  error: { ...Typography.bodySmall, color: Colors.error, marginTop: 4 },
})

// ── YesNoToggle ────────────────────────────────────────────────────────────────

function YesNoToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={yn.container}>
      <Text style={yn.label}>{label}</Text>
      <View style={yn.toggle}>
        <TouchableOpacity style={[yn.btn, value && yn.btnActive]} onPress={() => onChange(true)} activeOpacity={0.8}>
          <Text style={[yn.btnText, value && yn.btnTextActive]}>Yes</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[yn.btn, !value && yn.btnActive]} onPress={() => onChange(false)} activeOpacity={0.8}>
          <Text style={[yn.btnText, !value && yn.btnTextActive]}>No</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const yn = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: Spacing.md, paddingVertical: 2,
  },
  label: { ...Typography.body, color: Colors.textPrimary, flex: 1, marginRight: Spacing.md },
  toggle: {
    flexDirection: 'row', borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: BorderRadius.md, overflow: 'hidden',
  },
  btn: { paddingVertical: 8, paddingHorizontal: Spacing.md, backgroundColor: Colors.surface },
  btnActive: { backgroundColor: Colors.primary },
  btnText: { ...Typography.bodySmall, color: Colors.textSecondary, fontWeight: '600' },
  btnTextActive: { color: Colors.dark },
})

// ── ChecklistSection ───────────────────────────────────────────────────────────

interface ChecklistItem {
  id: number
  label: string
  sublabel?: string
}

interface ChecklistSectionProps {
  title: string
  items: ChecklistItem[]
  selectedIds: number[]
  onToggle: (id: number) => void
  emptyMessage: string
}

function ChecklistSection({ title, items, selectedIds, onToggle, emptyMessage }: ChecklistSectionProps) {
  const selectedCount = selectedIds.length

  return (
    <View style={cl.container}>
      <View style={cl.header}>
        <Text style={cl.title}>{title}</Text>
        {selectedCount > 0 && (
          <View style={cl.badge}>
            <Text style={cl.badgeText}>{selectedCount}</Text>
          </View>
        )}
      </View>

      {items.length === 0 ? (
        <Text style={cl.empty}>{emptyMessage}</Text>
      ) : (
        items.map((item) => {
          const selected = selectedIds.includes(item.id)
          return (
            <TouchableOpacity
              key={item.id}
              style={[cl.row, selected && cl.rowSelected]}
              onPress={() => onToggle(item.id)}
              activeOpacity={0.7}
            >
              <View style={[cl.check, selected && cl.checkSelected]}>
                {selected && <Ionicons name="checkmark" size={13} color={Colors.white} />}
              </View>
              <View style={cl.rowText}>
                <Text style={[cl.rowLabel, selected && cl.rowLabelSelected]}>{item.label}</Text>
                {item.sublabel ? <Text style={cl.rowSublabel}>{item.sublabel}</Text> : null}
              </View>
            </TouchableOpacity>
          )
        })
      )}
    </View>
  )
}

const cl = StyleSheet.create({
  container: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    backgroundColor: Colors.white, marginBottom: Spacing.md, overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  title: { ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  badge: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.full,
    minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { ...Typography.label, color: Colors.dark, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.surface,
  },
  rowSelected: { backgroundColor: '#FFF5F7' },
  check: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2,
    borderColor: Colors.border, backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  checkSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rowText: { flex: 1 },
  rowLabel: { ...Typography.body, color: Colors.textPrimary },
  rowLabelSelected: { color: Colors.primaryDark, fontWeight: '600' },
  rowSublabel: { ...Typography.bodySmall, color: Colors.textSecondary, marginTop: 1 },
  empty: { ...Typography.bodySmall, color: Colors.textSecondary, padding: Spacing.md },
})

// ── LotProgressCard ────────────────────────────────────────────────────────────

function LotProgressCard({ data }: { data: LotMaterialProgress }) {
  const pct = Math.min(100, Math.max(0, data.pct_complete))
  const fmt = (n: number) => n.toLocaleString('en-AU', { maximumFractionDigits: 1 })
  return (
    <View style={lp.card}>
      <View style={lp.barBg}>
        <View style={[lp.barFill, { width: `${pct}%` as any }]} />
      </View>
      <View style={lp.stats}>
        <View style={lp.stat}>
          <Text style={lp.statVal}>{fmt(data.planned_sqm)} m²</Text>
          <Text style={lp.statLabel}>Planned</Text>
        </View>
        <View style={[lp.stat, lp.statCenter]}>
          <Text style={[lp.statVal, lp.statInstalled]}>{fmt(data.actual_sqm)} m²</Text>
          <Text style={lp.statLabel}>Installed</Text>
        </View>
        <View style={[lp.stat, lp.statRight]}>
          <Text style={lp.statVal}>{fmt(data.remaining_sqm)} m²</Text>
          <Text style={lp.statLabel}>Remaining</Text>
        </View>
      </View>
      <Text style={lp.pctLabel}>{pct}% complete</Text>
    </View>
  )
}

const lp = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  barBg: {
    height: 8,
    backgroundColor: Colors.surface,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  barFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 4,
  },
  stats: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  stat: {
    flex: 1,
    alignItems: 'flex-start',
  },
  statCenter: {
    alignItems: 'center',
  },
  statRight: {
    alignItems: 'flex-end',
  },
  statVal: {
    ...Typography.bodySmall,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  statInstalled: {
    color: Colors.primaryDark,
  },
  statLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  pctLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    textAlign: 'right',
  },
})

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function NewEntryScreen() {
  const router = useRouter()
  const isOnline = useNetworkStatus()
  const activeProject = useProjectStore((s) => s.activeProject)
  const showToast = useToastStore((s) => s.show)

  const refQuery = useReference()
  const lots = refQuery.data?.lots ?? []
  const materials = refQuery.data?.materials ?? []
  const lotMaterials = refQuery.data?.lot_materials ?? {}
  const lotProgress = refQuery.data?.lot_progress ?? {}
  const allEmployees = refQuery.data?.employees ?? []
  const allMachines = refQuery.data?.machines ?? []
  const allHiredMachines = refQuery.data?.hired_machines ?? []

  const formOpenedAt = useRef(new Date().toISOString()).current

  const [step, setStep] = useState(1)

  // Step 1 — Entry Details
  const [date, setDate] = useState(new Date())
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [lotNumber, setLotNumber] = useState('')
  const [material, setMaterial] = useState('')
  const [location, setLocation] = useState('')
  const [weather, setWeather] = useState('')

  // Step 2 — Production
  const [installHours, setInstallHours] = useState('')
  const [installSqm, setInstallSqm] = useState('')

  // Step 3 — Crew
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([])

  // Step 4 — Equipment
  const [selectedMachineIds, setSelectedMachineIds] = useState<number[]>([])

  // Step 5 — Delays & Notes
  const [hasDelays, setHasDelays] = useState(false)
  const [delayHours, setDelayHours] = useState('')
  const [delayReason, setDelayReason] = useState('')
  const [delayBillable, setDelayBillable] = useState(true)
  const [delayDescription, setDelayDescription] = useState('')
  const [selectedStanddownIds, setSelectedStanddownIds] = useState<number[]>([])
  const [notes, setNotes] = useState('')
  const [otherWork, setOtherWork] = useState('')

  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── Keyboard refs ────────────────────────────────────────────────────────────
  // Step 1 — location is the only freetext input; lot/material/weather are selects
  const locationRef = useRef<TextInput>(null)
  // Step 2
  const installHoursRef = useRef<TextInput>(null)
  const installSqmRef = useRef<TextInput>(null)
  // Step 5
  const delayHoursRef = useRef<TextInput>(null)
  const delayDescRef = useRef<TextInput>(null)
  const notesRef = useRef<TextInput>(null)
  const otherWorkRef = useRef<TextInput>(null)

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function toggleId(ids: number[], id: number): number[] {
    return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
  }

  function validateStep(): boolean {
    const errs: Record<string, string> = {}
    if (step === 1 && !date) errs.date = 'Date is required'
    if (step === 5 && hasDelays) {
      if (!delayHours) errs.delayHours = 'Delay hours required'
      if (!delayReason) errs.delayReason = 'Delay reason required'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function handleNext() {
    if (!validateStep()) return
    setErrors({})
    setStep((s) => s + 1)
  }

  function handleBack() {
    setErrors({})
    setStep((s) => s - 1)
  }

  // Step 1 header back exits the screen; all other steps go to previous step
  function handleHeaderBack() {
    if (step === 1) {
      router.back()
    } else {
      handleBack()
    }
  }

  function onDateChange(_event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS !== 'ios') setShowDatePicker(false)
    if (selected) setDate(selected)
  }

  async function handleSave() {
    if (!activeProject) return
    setSaving(true)

    const localId = uuidv4()

    const entryData: LocalEntry = {
      local_id: localId,
      project_id: activeProject.id,
      entry_date: date.toISOString().split('T')[0],
      lot_number: lotNumber || undefined,
      location: location || undefined,
      material: material || undefined,
      num_people: selectedEmployeeIds.length > 0 ? selectedEmployeeIds.length : undefined,
      install_hours: installHours ? parseFloat(installHours) : undefined,
      install_sqm: installSqm ? parseFloat(installSqm) : undefined,
      weather: weather || undefined,
      delay_hours: hasDelays && delayHours ? parseFloat(delayHours) : undefined,
      delay_reason: hasDelays ? delayReason || undefined : undefined,
      delay_billable: hasDelays ? delayBillable : undefined,
      delay_description: hasDelays ? delayDescription || undefined : undefined,
      machines_stood_down: hasDelays ? selectedStanddownIds.length > 0 : undefined,
      notes: notes || undefined,
      other_work_description: otherWork || undefined,
      form_opened_at: formOpenedAt,
      synced: 0,
    }

    saveEntry(entryData)

    if (isOnline) {
      try {
        const response = await api.entries.create({
          ...entryData,
          employee_ids: selectedEmployeeIds,
          machine_ids: selectedMachineIds,
          standdown_machine_ids: hasDelays ? selectedStanddownIds : [],
        } as LocalEntry & { employee_ids: number[]; machine_ids: number[]; standdown_machine_ids: number[] })
        markEntrySynced(localId, response.data.id)
        showToast('Entry saved and synced', 'success')
      } catch {
        showToast('Saved locally — sync failed, will retry', 'warning')
      }
    } else {
      showToast('Entry saved locally — will sync when back online', 'warning')
    }

    router.replace('/(tabs)/entries')
  }

  // ── Derived checklist items ──────────────────────────────────────────────────

  const employeeItems: ChecklistItem[] = allEmployees.map((e) => ({
    id: e.id, label: e.name, sublabel: e.role || undefined,
  }))

  const machineItems: ChecklistItem[] = allMachines.map((m) => ({
    id: m.id, label: m.name, sublabel: m.type || undefined,
  }))

  const hiredMachineItems: ChecklistItem[] = allHiredMachines.map((h) => ({
    id: h.id, label: h.machine_name, sublabel: h.hire_company || undefined,
  }))

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <InternalHeader step={step} onBack={handleHeaderBack} />
      <StepIndicator current={step} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Step 1: Entry Details ── */}
          {step === 1 && (
            <View>
              <View style={sf.group}>
                <Text style={sf.label}>Date *</Text>
                <TouchableOpacity
                  style={[sf.select, !!errors.date && sf.inputError]}
                  onPress={() => setShowDatePicker(true)}
                  activeOpacity={0.7}
                >
                  <Text style={sf.selectText}>{formatDate(date)}</Text>
                  <Ionicons name="calendar-outline" size={16} color={Colors.textSecondary} />
                </TouchableOpacity>
                {errors.date && <Text style={sf.error}>{errors.date}</Text>}
              </View>

              {showDatePicker && (
                <View style={styles.datePicker}>
                  <DateTimePicker
                    value={date}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    onChange={onDateChange}
                    maximumDate={new Date()}
                    themeVariant="light"
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity
                      style={styles.datePickerDone}
                      onPress={() => setShowDatePicker(false)}
                    >
                      <Text style={styles.datePickerDoneText}>Done</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Location is the only freetext input on this step */}
              <FieldInput
                ref={locationRef}
                label="Location"
                value={location}
                onChangeText={setLocation}
                placeholder="e.g. Cell 3 North"
                optional
                returnKeyType="done"
              />
              <SelectField
                label="Weather"
                value={weather}
                options={WEATHER_OPTIONS}
                onChange={setWeather}
                placeholder="Select weather..."
                optional
              />
            </View>
          )}

          {/* ── Step 2: Production ── */}
          {step === 2 && (
            <View>
              <SelectField
                label="Lot Number"
                value={lotNumber}
                options={lots}
                onChange={(v) => {
                  setLotNumber(v)
                  if (v && lotMaterials[v] && material && !lotMaterials[v].includes(material)) {
                    setMaterial('')
                  }
                }}
                placeholder="Select lot..."
                optional
              />
              <SelectField
                label="Material"
                value={material}
                options={lotNumber && lotMaterials[lotNumber] ? lotMaterials[lotNumber] : materials}
                onChange={setMaterial}
                placeholder="Select material..."
                optional
              />
              {lotNumber && lotMaterials[lotNumber] && (
                <Text style={styles.filterHint}>
                  Showing materials for Lot {lotNumber}
                </Text>
              )}
              {lotNumber && material && lotProgress[lotNumber]?.[material] && (
                <LotProgressCard data={lotProgress[lotNumber][material]} />
              )}
              <FieldInput
                ref={installHoursRef}
                label="Install Hours"
                value={installHours}
                onChangeText={setInstallHours}
                placeholder="0.0"
                keyboardType="decimal-pad"
                optional
                returnKeyType="next"
                onSubmitEditing={() => installSqmRef.current?.focus()}
              />
              <FieldInput
                ref={installSqmRef}
                label="Area Installed (m²)"
                value={installSqm}
                onChangeText={setInstallSqm}
                placeholder="0.0"
                keyboardType="decimal-pad"
                optional
                returnKeyType="done"
              />
            </View>
          )}

          {/* ── Step 3: Crew ── */}
          {step === 3 && (
            <ChecklistSection
              title="Crew Members"
              items={employeeItems}
              selectedIds={selectedEmployeeIds}
              onToggle={(id) => setSelectedEmployeeIds((prev) => toggleId(prev, id))}
              emptyMessage="No active employees found."
            />
          )}

          {/* ── Step 4: Equipment ── */}
          {step === 4 && (
            <ChecklistSection
              title="Machines Used"
              items={machineItems}
              selectedIds={selectedMachineIds}
              onToggle={(id) => setSelectedMachineIds((prev) => toggleId(prev, id))}
              emptyMessage="No active machines found."
            />
          )}

          {/* ── Step 5: Delays & Notes ── */}
          {step === 5 && (
            <View>
              <YesNoToggle
                label="Any delays today?"
                value={hasDelays}
                onChange={(v) => {
                  setHasDelays(v)
                  if (!v) {
                    setDelayHours('')
                    setDelayReason('')
                    setDelayDescription('')
                    setSelectedStanddownIds([])
                  }
                }}
              />

              {hasDelays && (
                <View>
                  <FieldInput
                    ref={delayHoursRef}
                    label="Delay Hours"
                    value={delayHours}
                    onChangeText={setDelayHours}
                    placeholder="0.0"
                    keyboardType="decimal-pad"
                    returnKeyType="next"
                    onSubmitEditing={() => delayDescRef.current?.focus()}
                    error={errors.delayHours}
                  />
                  <SelectField
                    label="Delay Reason"
                    value={delayReason}
                    options={DELAY_REASONS}
                    onChange={setDelayReason}
                    placeholder="Select reason..."
                    error={errors.delayReason}
                  />
                  <YesNoToggle label="Charged to client?" value={delayBillable} onChange={setDelayBillable} />
                  <FieldInput
                    ref={delayDescRef}
                    label="Delay Description"
                    value={delayDescription}
                    onChangeText={setDelayDescription}
                    placeholder="Additional details..."
                    multiline
                    optional
                  />
                  {allHiredMachines.length > 0 && (
                    <ChecklistSection
                      title="Stand Down Hired Machines"
                      items={hiredMachineItems}
                      selectedIds={selectedStanddownIds}
                      onToggle={(id) => setSelectedStanddownIds((prev) => toggleId(prev, id))}
                      emptyMessage="No active hired machines."
                    />
                  )}
                </View>
              )}

              <FieldInput
                ref={notesRef}
                label="Notes"
                value={notes}
                onChangeText={setNotes}
                placeholder="Any additional notes..."
                multiline
                minHeight={100}
                optional
              />
              <FieldInput
                ref={otherWorkRef}
                label="Other Work Description"
                value={otherWork}
                onChangeText={setOtherWork}
                placeholder="Other work completed..."
                multiline
                minHeight={100}
                optional
              />
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Nav footer */}
      <View style={styles.nav}>
        {step > 1 ? (
          <Button
            title="← BACK"
            variant="outline"
            onPress={handleBack}
            fullWidth={false}
            style={styles.navBtn}
          />
        ) : (
          <View style={styles.navBtn} />
        )}

        {step < TOTAL_STEPS ? (
          <Button
            title="NEXT →"
            onPress={handleNext}
            fullWidth={false}
            style={styles.navBtn}
          />
        ) : (
          <Button
            title={isOnline ? 'SAVE ENTRY' : 'SAVE OFFLINE'}
            onPress={handleSave}
            loading={saving}
            fullWidth={false}
            style={styles.navBtn}
          />
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SLATE },
  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  filterHint: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontStyle: 'italic',
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
    paddingHorizontal: 2,
  },
  datePicker: {
    backgroundColor: Colors.white, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: Spacing.md, overflow: 'hidden',
  },
  datePickerDone: { alignItems: 'flex-end', paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  datePickerDoneText: { ...Typography.body, color: Colors.primary, fontWeight: '600' },
  nav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.md, backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.border, ...Shadows.sm,
  },
  navBtn: { minWidth: 130 },
})
