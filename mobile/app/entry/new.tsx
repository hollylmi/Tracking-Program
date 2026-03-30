import 'react-native-get-random-values'
import { v4 as uuidv4 } from 'uuid'
import { useState, useRef, useEffect, forwardRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  Image,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Alert,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { SafeAreaView } from 'react-native-safe-area-context'
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import Button from '../../components/ui/Button'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../constants/theme'
import { useReference } from '../../hooks/useReference'
import { useHire } from '../../hooks/useHire'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { useProjectStore } from '../../store/project'
import { useToastStore } from '../../store/toast'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { saveEntry, markEntrySynced, savePendingPhoto } from '../../lib/db'
import { compressImage } from '../../lib/compressImage'
import { LocalEntry, LotMaterialProgress, DelayLine, OtherActivityLine } from '../../types'

// ── Constants ──────────────────────────────────────────────────────────────────

const SLATE = Colors.dark

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
const STEP_INDICATOR_LABELS = ['Details', 'Crew', 'Production', 'Delays', 'Equipment']

// Internal header titles per step
const STEP_HEADER_TITLES: Record<number, string> = {
  1: 'Entry Details',
  2: 'Crew',
  3: 'Production',
  4: 'Delays & Notes',
  5: 'Equipment',
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
    backgroundColor: Colors.background,
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
  dotDone: { backgroundColor: Colors.textSecondary, borderColor: Colors.textSecondary },
  dotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  label: { ...Typography.caption, color: Colors.textSecondary, textAlign: 'center' },
  labelActive: { color: Colors.primary, fontWeight: '600' },
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
  loading?: boolean
}

function SelectField({ label, value, options, onChange, placeholder = 'Select...', optional, error, loading }: SelectFieldProps) {
  const [open, setOpen] = useState(false)

  // While reference data is loading, show a disabled dropdown-style placeholder
  if (loading) {
    return (
      <View style={sf.group}>
        <Text style={sf.label}>{label}{!optional && ' *'}</Text>
        <View style={[sf.select, { opacity: 0.5 }]}>
          <Text style={sf.placeholder}>Loading…</Text>
          <Ionicons name="chevron-down" size={16} color={Colors.textSecondary} />
        </View>
      </View>
    )
  }

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
        style={[sf.select, open && sf.selectOpen, !!error && sf.inputError]}
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
    ...Typography.body, color: Colors.textPrimary, backgroundColor: Colors.surface,
  },
  inputError: { borderColor: Colors.error },
  select: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 12, backgroundColor: Colors.surface,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  selectOpen: {
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  selectText: { ...Typography.body, color: Colors.textPrimary },
  placeholder: { color: Colors.textLight },
  error: { ...Typography.bodySmall, color: Colors.error, marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: BorderRadius.lg, borderTopRightRadius: BorderRadius.lg,
    borderTopWidth: 1, borderColor: Colors.border,
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
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  optionSelected: { backgroundColor: 'rgba(255,183,197,0.12)' },
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
  const [focused, setFocused] = useState(false)
  return (
    <View style={fi.group}>
      <Text style={fi.label}>{label}{!optional && ' *'}</Text>
      <TextInput
        ref={ref}
        style={[
          fi.input,
          focused && fi.inputFocused,
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
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
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
    ...Typography.body, color: Colors.textPrimary, backgroundColor: Colors.surface,
  },
  inputFocused: {
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
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
  btnText: { ...Typography.bodySmall, color: Colors.textPrimary, fontWeight: '600' },
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
    backgroundColor: Colors.surface, marginBottom: Spacing.md, overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
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
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  rowSelected: { backgroundColor: 'rgba(255,183,197,0.1)' },
  check: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2,
    borderColor: Colors.border, backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  checkSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rowText: { flex: 1 },
  rowLabel: { ...Typography.body, color: Colors.textPrimary },
  rowLabelSelected: { color: Colors.primary, fontWeight: '600' },
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
    backgroundColor: Colors.surface,
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
  // isPending covers both "fetching" and "no-data-yet" states, unlike isLoading
  const refLoading = refQuery.isPending || refQuery.isFetching
  const lots = refQuery.data?.lots ?? []
  const materials = refQuery.data?.materials ?? []
  const lotMaterials = refQuery.data?.lot_materials ?? {}
  const lotProgress = refQuery.data?.lot_progress ?? {}
  const allEmployees = refQuery.data?.employees ?? []
  const allMachines = refQuery.data?.machines ?? []
  const allHiredMachinesRef = refQuery.data?.hired_machines ?? []

  // Fetch full hired machine data (with stand-down info) for the active project
  const hireQuery = useHire(activeProject?.id)
  const allHiredMachines = hireQuery.data ?? allHiredMachinesRef.map((h) => ({
    ...h, plant_id: null, delivery_date: null, return_date: null,
    cost_per_day: null, cost_per_week: null, project_id: activeProject?.id ?? 0,
    project_name: null, active: true, stand_downs: [],
  }))

  const formOpenedAt = useRef(new Date().toISOString()).current

  const [step, setStep] = useState(1)

  // Step 1 — Entry Details
  const [date, setDate] = useState(new Date())
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [location, setLocation] = useState('')
  const [weather, setWeather] = useState('')

  // Step 2 — Production (multiple lines)
  const [productionLines, setProductionLines] = useState<{ lot: string; material: string; hours: string; sqm: string; activity_type: 'deploy' | 'weld'; weld_metres: string; employee_ids: number[] }[]>(
    [{ lot: '', material: '', hours: '', sqm: '', activity_type: 'deploy', weld_metres: '', employee_ids: [] }]
  )

  // Step 3 — Crew
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([])

  // Step 4 — Equipment
  const [selectedMachineIds, setSelectedMachineIds] = useState<number[]>([])

  // Pre-select machines that were checked today (from daily startup checks)
  const { data: dailyChecksData } = useQuery({
    queryKey: ['daily-checks-for-entry', activeProject?.id],
    queryFn: () => api.equipment.projectDailyChecks(activeProject!.id).then((r) => r.data),
    enabled: !!activeProject?.id,
    staleTime: 2 * 60 * 1000,
  })

  useEffect(() => {
    if (dailyChecksData?.machines && selectedMachineIds.length === 0) {
      const checkedFleetIds = dailyChecksData.machines
        .filter((m) => m.check && m.machine_id)
        .map((m) => m.machine_id!)
      if (checkedFleetIds.length > 0) {
        setSelectedMachineIds(checkedFleetIds)
      }
    }
  }, [dailyChecksData])

  // Step 5 — Delays & Notes
  const [variationLines, setVariationLines] = useState<{ number: string; description: string; hours: string; employee_ids: number[] }[]>([])
  const [delayLines, setDelayLines] = useState<{ reason: string; hours: string; description: string }[]>([])
  const [selectedStanddownIds, setSelectedStanddownIds] = useState<number[]>([])
  const [notes, setNotes] = useState('')
  const [otherActivityLines, setOtherActivityLines] = useState<{ description: string; hours: string; employee_ids: number[] }[]>([])

  // Photos
  const [photos, setPhotos] = useState<{ uri: string; filename: string }[]>([])

  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── Keyboard refs ────────────────────────────────────────────────────────────
  // Step 1 — location is the only freetext input; lot/material/weather are selects
  const locationRef = useRef<TextInput>(null)
  // Step 5
  const notesRef = useRef<TextInput>(null)

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function toggleId(ids: number[], id: number): number[] {
    return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
  }

  function updateLine(index: number, field: 'lot' | 'material' | 'hours' | 'sqm' | 'activity_type' | 'weld_metres', value: string) {
    setProductionLines(prev => prev.map((line, i) => i === index ? { ...line, [field]: value } : line))
  }

  function toggleLineEmployee(lineIndex: number, empId: number) {
    setProductionLines(prev => prev.map((line, i) => {
      if (i !== lineIndex) return line
      const ids = line.employee_ids.includes(empId)
        ? line.employee_ids.filter(x => x !== empId)
        : [...line.employee_ids, empId]
      return { ...line, employee_ids: ids }
    }))
  }

  function addLine() {
    setProductionLines(prev => [...prev, { lot: '', material: '', hours: '', sqm: '', activity_type: 'deploy', weld_metres: '', employee_ids: [] }])
  }

  function removeLine(index: number) {
    setProductionLines(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index))
  }

  // Delay line helpers
  function addDelayLine() {
    setDelayLines(prev => [...prev, { reason: '', hours: '', description: '' }])
  }

  function updateDelayLine(index: number, field: 'reason' | 'hours' | 'description', value: string) {
    setDelayLines(prev => prev.map((line, i) => i === index ? { ...line, [field]: value } : line))
  }

  function removeDelayLine(index: number) {
    setDelayLines(prev => prev.filter((_, i) => i !== index))
  }

  // Variation line helpers
  function addVariationLine() {
    setVariationLines(prev => [...prev, { number: '', description: '', hours: '', employee_ids: [] }])
  }

  function updateVariationLine(index: number, field: 'number' | 'description' | 'hours', value: string) {
    setVariationLines(prev => prev.map((line, i) => i === index ? { ...line, [field]: value } : line))
  }

  function toggleVariationEmployee(lineIndex: number, empId: number) {
    setVariationLines(prev => prev.map((line, i) => {
      if (i !== lineIndex) return line
      const ids = line.employee_ids.includes(empId)
        ? line.employee_ids.filter(x => x !== empId)
        : [...line.employee_ids, empId]
      return { ...line, employee_ids: ids }
    }))
  }

  function removeVariationLine(index: number) {
    setVariationLines(prev => prev.filter((_, i) => i !== index))
  }

  // Other activity line helpers
  function addOtherActivityLine() {
    setOtherActivityLines(prev => [...prev, { description: '', hours: '', employee_ids: [] }])
  }

  function updateOtherActivityLine(index: number, field: 'description' | 'hours', value: string) {
    setOtherActivityLines(prev => prev.map((line, i) => i === index ? { ...line, [field]: value } : line))
  }

  function toggleOtherActivityEmployee(lineIndex: number, empId: number) {
    setOtherActivityLines(prev => prev.map((line, i) => {
      if (i !== lineIndex) return line
      const ids = line.employee_ids.includes(empId)
        ? line.employee_ids.filter(x => x !== empId)
        : [...line.employee_ids, empId]
      return { ...line, employee_ids: ids }
    }))
  }

  function removeOtherActivityLine(index: number) {
    setOtherActivityLines(prev => prev.filter((_, i) => i !== index))
  }

  const hasDelays = delayLines.length > 0

  const totalSqm = productionLines.reduce((sum, l) => sum + (parseFloat(l.sqm) || 0), 0)
  const totalHours = productionLines.reduce((sum, l) => sum + (parseFloat(l.hours) || 0), 0)

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
      setPhotos((prev) => [...prev, { uri: compressed, filename: `photo_${Date.now()}.jpg` }])
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
        result.assets.map(async (a) => ({
          uri: await compressImage(a.uri),
          filename: `photo_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`,
        }))
      )
      setPhotos((prev) => [...prev, ...picked])
    }
  }

  function addPhoto() {
    Alert.alert('Add Photo', 'Choose a source', [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Library', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  function validateStep(): boolean {
    const errs: Record<string, string> = {}
    if (step === 1 && !date) errs.date = 'Date is required'
    if (step === 4) {
      delayLines.forEach((dl, i) => {
        if (!dl.hours) errs[`delayHours_${i}`] = 'Hours required'
        if (!dl.reason) errs[`delayReason_${i}`] = 'Reason required'
      })
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

    const validLines = productionLines.filter(l => l.lot || l.material || l.sqm || l.hours)
    const firstLine = validLines[0]

    const totalDelayHours = delayLines.reduce((sum, dl) => sum + (parseFloat(dl.hours) || 0), 0)

    const apiProductionLines = validLines.map(l => ({
      lot_number: l.lot || null,
      material: l.material || null,
      install_hours: parseFloat(l.hours) || 0,
      install_sqm: l.activity_type === 'weld' ? 0 : (parseFloat(l.sqm) || 0),
      activity_type: l.activity_type,
      weld_metres: l.activity_type === 'weld' ? (parseFloat(l.weld_metres) || 0) : undefined,
      employee_ids_json: l.employee_ids.length > 0 ? JSON.stringify(l.employee_ids) : undefined,
    }))

    const apiDelayLines: DelayLine[] = delayLines.map(dl => ({
      reason: dl.reason,
      hours: parseFloat(dl.hours) || 0,
      description: dl.description || undefined,
    }))

    const apiVariationLines = variationLines
      .filter(vl => vl.number || vl.description || vl.hours)
      .map(vl => ({
        variation_number: vl.number || undefined,
        description: vl.description || undefined,
        hours: parseFloat(vl.hours) || 0,
        employee_ids_json: vl.employee_ids.length > 0 ? JSON.stringify(vl.employee_ids) : undefined,
      }))

    const apiOtherActivityLines: OtherActivityLine[] = otherActivityLines
      .filter(ol => ol.description || ol.hours)
      .map(ol => ({
        description: ol.description,
        hours: parseFloat(ol.hours) || 0,
        employee_ids_json: ol.employee_ids.length > 0 ? JSON.stringify(ol.employee_ids) : undefined,
      }))

    const entryData: LocalEntry = {
      local_id: localId,
      project_id: activeProject.id,
      entry_date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      lot_number: firstLine?.lot || undefined,
      location: location || undefined,
      material: firstLine?.material || undefined,
      num_people: selectedEmployeeIds.length > 0 ? selectedEmployeeIds.length : undefined,
      install_hours: totalHours || undefined,
      install_sqm: totalSqm || undefined,
      weather: weather || undefined,
      delay_hours: totalDelayHours || undefined,
      delay_reason: delayLines[0]?.reason || undefined,
      delay_description: delayLines[0]?.description || undefined,
      machines_stood_down: selectedStanddownIds.length > 0 ? true : undefined,
      notes: notes || undefined,
      form_opened_at: formOpenedAt,
      employee_ids: selectedEmployeeIds.length > 0 ? selectedEmployeeIds : undefined,
      machine_ids: selectedMachineIds.length > 0 ? selectedMachineIds : undefined,
      standdown_machine_ids: selectedStanddownIds.length > 0 ? selectedStanddownIds : undefined,
      production_lines_json: JSON.stringify(apiProductionLines),
      delay_lines_json: apiDelayLines.length > 0 ? JSON.stringify(apiDelayLines) : undefined,
      other_activity_lines_json: apiOtherActivityLines.length > 0 ? JSON.stringify(apiOtherActivityLines) : undefined,
      synced: 0,
    }

    saveEntry(entryData)

    // Persist photos to SQLite so they survive app restarts
    for (const photo of photos) {
      savePendingPhoto(localId, photo.uri, photo.filename)
    }

    if (isOnline) {
      try {
        const response = await api.entries.create({
          ...entryData,
          employee_ids: selectedEmployeeIds,
          machine_ids: selectedMachineIds,
          standdown_machine_ids: selectedStanddownIds,
          production_lines: apiProductionLines,
          variation_lines: apiVariationLines.length > 0 ? apiVariationLines : undefined,
          delay_lines: apiDelayLines.length > 0 ? apiDelayLines : undefined,
          other_activity_lines: apiOtherActivityLines.length > 0 ? apiOtherActivityLines : undefined,
        } as any)
        const serverId = response.data.id
        markEntrySynced(localId, serverId)

        // Upload any photos taken
        let photosFailed = 0
        for (const photo of photos) {
          try {
            await api.photos.upload(serverId, photo.uri, photo.filename)
          } catch {
            photosFailed++
          }
        }

        // Clean up pending photos on successful upload
        if (photosFailed === 0) {
          const { deletePendingPhotos } = await import('../../lib/db')
          deletePendingPhotos(localId)
        }

        if (photosFailed > 0) {
          showToast(`Entry saved — ${photosFailed} photo(s) failed to upload`, 'warning')
        } else {
          showToast('Entry saved and synced', 'success')
        }
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

  const machineItems: ChecklistItem[] = [...allMachines]
    .sort((a, b) => (a.group_name || 'zzz').localeCompare(b.group_name || 'zzz') || a.name.localeCompare(b.name))
    .map((m) => ({
      id: m.id,
      label: m.name,
      sublabel: [m.group_name, m.type].filter(Boolean).join(' — ') || undefined,
    }))

  const hiredMachineItems: ChecklistItem[] = allHiredMachines.map((h) => ({
    id: h.id,
    label: h.machine_name,
    sublabel: h.hire_company || undefined,
  }))

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <InternalHeader step={step} onBack={handleHeaderBack} />
      <StepIndicator current={step} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
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

          {/* ── Step 3: Production ── */}
          {step === 3 && (
            <View>
              {/* Production lines header */}
              <View style={styles.prodHeader}>
                <Text style={styles.prodHeaderTitle}>Production Lines</Text>
                <Text style={styles.prodHeaderTotal}>{totalHours}h  |  {totalSqm.toLocaleString('en-AU', { maximumFractionDigits: 1 })} m²</Text>
              </View>

              {productionLines.map((line, index) => (
                <View key={index} style={styles.prodLine}>
                  <View style={styles.prodLineHeader}>
                    <Text style={styles.prodLineNum}>Line {index + 1}</Text>
                    {productionLines.length > 1 && (
                      <TouchableOpacity onPress={() => removeLine(index)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={20} color={Colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Deploy / Weld toggle */}
                  <View style={styles.activityToggle}>
                    <Text style={sf.label}>Activity Type</Text>
                    <View style={yn.toggle}>
                      <TouchableOpacity
                        style={[yn.btn, line.activity_type === 'deploy' && yn.btnActive]}
                        onPress={() => updateLine(index, 'activity_type', 'deploy')}
                        activeOpacity={0.8}
                      >
                        <Text style={[yn.btnText, line.activity_type === 'deploy' && yn.btnTextActive]}>Deploy</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[yn.btn, line.activity_type === 'weld' && yn.btnActive]}
                        onPress={() => updateLine(index, 'activity_type', 'weld')}
                        activeOpacity={0.8}
                      >
                        <Text style={[yn.btnText, line.activity_type === 'weld' && yn.btnTextActive]}>Weld</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {(activeProject?.track_by_lot !== false) && (
                  <SelectField
                    label="Lot"
                    value={line.lot}
                    options={lots}
                    onChange={(v) => updateLine(index, 'lot', v)}
                    placeholder="Select lot..."
                    optional
                    loading={refLoading}
                  />
                  )}
                  <SelectField
                    label="Material"
                    value={line.material}
                    options={line.lot && lotMaterials[line.lot] ? lotMaterials[line.lot] : materials}
                    onChange={(v) => updateLine(index, 'material', v)}
                    placeholder="Select material..."
                    optional
                    loading={refLoading}
                  />
                  {line.lot && lotMaterials[line.lot] && (
                    <Text style={styles.filterHint}>Showing materials for Lot {line.lot}</Text>
                  )}
                  {line.lot && line.material && lotProgress[line.lot]?.[line.material] && (
                    <LotProgressCard data={lotProgress[line.lot][line.material]} />
                  )}
                  <FieldInput
                    label="Hours"
                    value={line.hours}
                    onChangeText={(v) => updateLine(index, 'hours', v)}
                    placeholder="0.0"
                    keyboardType="decimal-pad"
                    optional
                    returnKeyType="next"
                  />
                  {line.activity_type === 'weld' ? (
                    <FieldInput
                      label="Weld (m)"
                      value={line.weld_metres}
                      onChangeText={(v) => updateLine(index, 'weld_metres', v)}
                      placeholder="0.0"
                      keyboardType="decimal-pad"
                      optional
                      returnKeyType="done"
                    />
                  ) : (
                    <FieldInput
                      label="Area Installed (m\u00B2)"
                      value={line.sqm}
                      onChangeText={(v) => updateLine(index, 'sqm', v)}
                      placeholder="0.0"
                      keyboardType="decimal-pad"
                      optional
                      returnKeyType="done"
                    />
                  )}

                  {/* Crew selector per production line */}
                  <View style={styles.lineCrewSection}>
                    <Text style={sf.label}>Line Crew</Text>
                    {selectedEmployeeIds.length === 0 ? (
                      <Text style={styles.lineCrewHint}>Select crew in Step 2 first</Text>
                    ) : (
                      <View style={styles.lineCrewChips}>
                        {allEmployees
                          .filter(e => selectedEmployeeIds.includes(e.id))
                          .map(emp => {
                            const selected = line.employee_ids.includes(emp.id)
                            return (
                              <TouchableOpacity
                                key={emp.id}
                                style={[styles.crewChip, selected && styles.crewChipSelected]}
                                onPress={() => toggleLineEmployee(index, emp.id)}
                                activeOpacity={0.7}
                              >
                                <Text style={[styles.crewChipText, selected && styles.crewChipTextSelected]}>
                                  {emp.name}
                                </Text>
                              </TouchableOpacity>
                            )
                          })}
                      </View>
                    )}
                  </View>
                </View>
              ))}

              <TouchableOpacity style={styles.addLineBtn} onPress={addLine} activeOpacity={0.7}>
                <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
                <Text style={styles.addLineBtnText}>Add Production Line</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Step 2: Crew ── */}
          {step === 2 && (
            <ChecklistSection
              title="Crew Members"
              items={employeeItems}
              selectedIds={selectedEmployeeIds}
              onToggle={(id) => setSelectedEmployeeIds((prev) => toggleId(prev, id))}
              emptyMessage="No active employees found."
            />
          )}

          {/* ── Step 5: Equipment ── */}
          {step === 5 && (
            <ChecklistSection
              title="Machines Used"
              items={machineItems}
              selectedIds={selectedMachineIds}
              onToggle={(id) => setSelectedMachineIds((prev) => toggleId(prev, id))}
              emptyMessage="No active machines found."
            />
          )}

          {/* ── Step 4: Variations, Delays & Notes ── */}
          {step === 4 && (
            <View>
              {/* ── Variation Lines ── */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Variations (Client Work)</Text>
                {variationLines.length > 0 && (
                  <Text style={styles.sectionSubtitle}>
                    {variationLines.reduce((s, vl) => s + (parseFloat(vl.hours) || 0), 0)}h total
                  </Text>
                )}
              </View>

              {variationLines.map((vl, index) => (
                <View key={index} style={styles.prodLine}>
                  <View style={styles.prodLineHeader}>
                    <Text style={styles.prodLineNum}>Variation {index + 1}</Text>
                    <TouchableOpacity onPress={() => removeVariationLine(index)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={20} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <FieldInput
                        label="Number"
                        value={vl.number}
                        onChangeText={(v) => updateVariationLine(index, 'number', v)}
                        placeholder="V001"
                        optional
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <FieldInput
                        label="Hours"
                        value={vl.hours}
                        onChangeText={(v) => updateVariationLine(index, 'hours', v)}
                        placeholder="0.0"
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                  <FieldInput
                    label="Description"
                    value={vl.description}
                    onChangeText={(v) => updateVariationLine(index, 'description', v)}
                    placeholder="Description of variation work..."
                    multiline
                  />
                  {/* Crew selector */}
                  <View style={styles.lineCrewSection}>
                    <Text style={sf.label}>Crew</Text>
                    {selectedEmployeeIds.length === 0 ? (
                      <Text style={styles.lineCrewHint}>Select crew in Step 2 first</Text>
                    ) : (
                      <View style={styles.lineCrewChips}>
                        {allEmployees
                          .filter(e => selectedEmployeeIds.includes(e.id))
                          .map(emp => {
                            const selected = vl.employee_ids.includes(emp.id)
                            return (
                              <TouchableOpacity
                                key={emp.id}
                                style={[styles.crewChip, selected && styles.crewChipSelected]}
                                onPress={() => toggleVariationEmployee(index, emp.id)}
                                activeOpacity={0.7}
                              >
                                <Text style={[styles.crewChipText, selected && styles.crewChipTextSelected]}>
                                  {emp.name}
                                </Text>
                              </TouchableOpacity>
                            )
                          })}
                      </View>
                    )}
                  </View>
                </View>
              ))}

              <TouchableOpacity style={styles.addLineBtn} onPress={addVariationLine} activeOpacity={0.7}>
                <Ionicons name="add-circle-outline" size={20} color={Colors.warning} />
                <Text style={[styles.addLineBtnText, { color: Colors.warning }]}>Add Variation</Text>
              </TouchableOpacity>

              {/* ── Delay Lines ── */}
              <View style={[styles.sectionHeader, { marginTop: Spacing.md }]}>
                <Text style={styles.sectionTitle}>Delays</Text>
                {delayLines.length > 0 && (
                  <Text style={styles.sectionSubtitle}>
                    {delayLines.reduce((s, dl) => s + (parseFloat(dl.hours) || 0), 0)}h total
                  </Text>
                )}
              </View>

              {delayLines.map((dl, index) => (
                <View key={index} style={styles.prodLine}>
                  <View style={styles.prodLineHeader}>
                    <Text style={styles.prodLineNum}>Delay {index + 1}</Text>
                    <TouchableOpacity onPress={() => removeDelayLine(index)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={20} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                  <SelectField
                    label="Reason"
                    value={dl.reason}
                    options={DELAY_REASONS}
                    onChange={(v) => updateDelayLine(index, 'reason', v)}
                    placeholder="Select reason..."
                    error={errors[`delayReason_${index}`]}
                  />
                  <FieldInput
                    label="Hours"
                    value={dl.hours}
                    onChangeText={(v) => updateDelayLine(index, 'hours', v)}
                    placeholder="0.0"
                    keyboardType="decimal-pad"
                    error={errors[`delayHours_${index}`]}
                  />
                  <FieldInput
                    label="Description"
                    value={dl.description}
                    onChangeText={(v) => updateDelayLine(index, 'description', v)}
                    placeholder="Additional details..."
                    multiline
                    optional
                  />
                </View>
              ))}

              <TouchableOpacity style={styles.addLineBtn} onPress={addDelayLine} activeOpacity={0.7}>
                <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
                <Text style={styles.addLineBtnText}>Add Delay</Text>
              </TouchableOpacity>

              {hiredMachineItems.length > 0 && (
                <View>
                  {hasDelays && selectedStanddownIds.length === 0 && (
                    <View style={styles.hireHelper}>
                      <Ionicons name="information-circle-outline" size={16} color={Colors.warning} />
                      <Text style={styles.hireHelperText}>
                        Don't forget to mark which machines below
                      </Text>
                    </View>
                  )}
                  <Text style={styles.standdownLabel}>
                    Mark any hired machines that were stood down today
                  </Text>
                  <ChecklistSection
                    title="Hired Equipment Stand-Downs"
                    items={hiredMachineItems}
                    selectedIds={selectedStanddownIds}
                    onToggle={(id) => setSelectedStanddownIds((prev) => toggleId(prev, id))}
                    emptyMessage="No hired machines for this project."
                  />
                </View>
              )}

              {/* ── Other Activities ── */}
              <View style={[styles.sectionHeader, { marginTop: Spacing.md }]}>
                <Text style={styles.sectionTitle}>Other Activities</Text>
              </View>

              {otherActivityLines.map((ol, index) => (
                <View key={index} style={styles.prodLine}>
                  <View style={styles.prodLineHeader}>
                    <Text style={styles.prodLineNum}>Activity {index + 1}</Text>
                    <TouchableOpacity onPress={() => removeOtherActivityLine(index)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={20} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                  <FieldInput
                    label="Description"
                    value={ol.description}
                    onChangeText={(v) => updateOtherActivityLine(index, 'description', v)}
                    placeholder="What was done..."
                    multiline
                  />
                  <FieldInput
                    label="Hours"
                    value={ol.hours}
                    onChangeText={(v) => updateOtherActivityLine(index, 'hours', v)}
                    placeholder="0.0"
                    keyboardType="decimal-pad"
                    optional
                  />
                  {/* Crew selector for other activity line */}
                  <View style={styles.lineCrewSection}>
                    <Text style={sf.label}>Crew</Text>
                    {selectedEmployeeIds.length === 0 ? (
                      <Text style={styles.lineCrewHint}>Select crew in Step 2 first</Text>
                    ) : (
                      <View style={styles.lineCrewChips}>
                        {allEmployees
                          .filter(e => selectedEmployeeIds.includes(e.id))
                          .map(emp => {
                            const selected = ol.employee_ids.includes(emp.id)
                            return (
                              <TouchableOpacity
                                key={emp.id}
                                style={[styles.crewChip, selected && styles.crewChipSelected]}
                                onPress={() => toggleOtherActivityEmployee(index, emp.id)}
                                activeOpacity={0.7}
                              >
                                <Text style={[styles.crewChipText, selected && styles.crewChipTextSelected]}>
                                  {emp.name}
                                </Text>
                              </TouchableOpacity>
                            )
                          })}
                      </View>
                    )}
                  </View>
                </View>
              ))}

              <TouchableOpacity style={styles.addLineBtn} onPress={addOtherActivityLine} activeOpacity={0.7}>
                <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
                <Text style={styles.addLineBtnText}>Add Other Activity</Text>
              </TouchableOpacity>

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

              {/* ── Photos ── */}
              <View style={ph.group}>
                <Text style={ph.label}>PHOTOS</Text>
                {photos.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ph.row}>
                    {photos.map((p, i) => (
                      <View key={i} style={ph.thumb}>
                        <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        <TouchableOpacity style={ph.remove} onPress={() => removePhoto(i)}>
                          <Ionicons name="close-circle" size={22} color={Colors.white} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                )}
                <TouchableOpacity style={ph.btn} onPress={addPhoto} activeOpacity={0.7}>
                  <Ionicons name="camera-outline" size={20} color={Colors.primary} />
                  <Text style={ph.btnText}>Add Photo</Text>
                </TouchableOpacity>
              </View>
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

const ph = StyleSheet.create({
  group: { marginBottom: Spacing.md },
  label: {
    ...Typography.label, color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  row: { marginBottom: Spacing.sm },
  thumb: {
    width: 90, height: 90, borderRadius: BorderRadius.md,
    overflow: 'hidden', backgroundColor: Colors.surface, marginRight: Spacing.sm,
  },
  remove: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 11,
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    borderWidth: 1.5, borderColor: Colors.primary,
    borderRadius: BorderRadius.md, paddingVertical: 14,
    justifyContent: 'center', backgroundColor: 'rgba(255,183,197,0.08)',
  },
  btnText: { ...Typography.body, color: Colors.primary, fontWeight: '600' },
})

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SLATE },
  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  prodHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  prodHeaderTitle: {
    ...Typography.h4,
    color: Colors.textPrimary,
  },
  prodHeaderTotal: {
    ...Typography.bodySmall,
    color: Colors.primary,
    fontWeight: '600',
  },
  prodLine: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  prodLineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  prodLineNum: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addLineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,183,197,0.08)',
    marginBottom: Spacing.md,
  },
  addLineBtnText: {
    ...Typography.body,
    color: Colors.primary,
    fontWeight: '600',
  },
  filterHint: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontStyle: 'italic',
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
    paddingHorizontal: 2,
  },
  hireHelper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,152,0,0.1)',
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    marginBottom: Spacing.sm,
  },
  hireHelperText: {
    ...Typography.bodySmall,
    color: Colors.warning,
    fontWeight: '500',
    flex: 1,
  },
  standdownLabel: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  datePicker: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: Spacing.md, overflow: 'hidden',
  },
  datePickerDone: { alignItems: 'flex-end', paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  datePickerDoneText: { ...Typography.body, color: Colors.primary, fontWeight: '600' },
  nav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.md, backgroundColor: Colors.background,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  navBtn: { minWidth: 130 },
  activityToggle: {
    marginBottom: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.h4,
    color: Colors.textPrimary,
  },
  sectionSubtitle: {
    ...Typography.bodySmall,
    color: Colors.primary,
    fontWeight: '600',
  },
  lineCrewSection: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  lineCrewHint: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  lineCrewChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  crewChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  crewChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  crewChipText: {
    ...Typography.bodySmall,
    color: Colors.textPrimary,
  },
  crewChipTextSelected: {
    color: Colors.dark,
    fontWeight: '600',
  },
})
