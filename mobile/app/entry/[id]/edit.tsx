import { useState, useRef, useEffect, forwardRef } from 'react'
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
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import Button from '../../../components/ui/Button'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../../constants/theme'
import { useReference } from '../../../hooks/useReference'
import { useHire } from '../../../hooks/useHire'
import { useToastStore } from '../../../store/toast'
import { useProjectStore } from '../../../store/project'
import { api } from '../../../lib/api'
import { formatDate as fmtDateAU } from '../../../lib/dates'
import { cachedQuery } from '../../../lib/cachedQuery'
import { LotMaterialProgress, DelayLine, OtherActivityLine } from '../../../types'

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

const STEP_LABELS = ['Details', 'Crew', 'Production', 'Delays', 'Equipment']
const STEP_HEADER_TITLES: Record<number, string> = {
  1: 'Entry Details',
  2: 'Crew',
  3: 'Production',
  4: 'Delays & Notes',
  5: 'Equipment',
}
const TOTAL_STEPS = 5

// ── InternalHeader ─────────────────────────────────────────────────────────────

function InternalHeader({ step, onBack }: { step: number; onBack: () => void }) {
  return (
    <View>
      <View style={ih.bar}>
        <TouchableOpacity style={ih.backBtn} onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <Text style={ih.title} numberOfLines={1}>{STEP_HEADER_TITLES[step]}</Text>
        <Text style={ih.counter}>Step {step} of {TOTAL_STEPS}</Text>
      </View>
      <View style={ih.accent} />
    </View>
  )
}

const ih = StyleSheet.create({
  bar: {
    backgroundColor: SLATE, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: 13,
  },
  accent: { height: 3, backgroundColor: Colors.primary },
  backBtn: { width: 32, alignItems: 'flex-start' },
  title: {
    flex: 1, textAlign: 'center', color: Colors.white,
    fontSize: 16, fontWeight: '600', letterSpacing: 0.3,
  },
  counter: {
    width: 72, textAlign: 'right', color: 'rgba(255,255,255,0.55)',
    fontSize: 12, fontWeight: '400',
  },
})

// ── StepIndicator ──────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <View style={si.container}>
      <View style={si.row}>
        {STEP_LABELS.map((label, i) => {
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
    backgroundColor: Colors.white, paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  item: { flex: 1, alignItems: 'center', gap: 5 },
  dot: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: Colors.border, backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  dotDone: { backgroundColor: Colors.dark, borderColor: Colors.dark },
  dotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  label: { ...Typography.caption, color: Colors.textSecondary, textAlign: 'center' },
  labelActive: { color: Colors.primaryDark, fontWeight: '600' },
})

// ── SelectField ────────────────────────────────────────────────────────────────

function SelectField({ label, value, options, onChange, placeholder = 'Select...', optional, error }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
  placeholder?: string; optional?: boolean; error?: string;
}) {
  const [open, setOpen] = useState(false)

  if (options.length === 0) {
    return (
      <View style={sf.group}>
        <Text style={sf.label}>{label}{!optional && ' *'}</Text>
        <TextInput style={[sf.input, !!error && sf.inputError]} value={value}
          onChangeText={onChange} placeholder={placeholder} placeholderTextColor={Colors.textLight} />
        {error && <Text style={sf.error}>{error}</Text>}
      </View>
    )
  }

  return (
    <View style={sf.group}>
      <Text style={sf.label}>{label}{!optional && ' *'}</Text>
      <TouchableOpacity style={[sf.select, !!error && sf.inputError]} onPress={() => setOpen(true)} activeOpacity={0.7}>
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
  label: { ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
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
    backgroundColor: Colors.white, borderTopLeftRadius: BorderRadius.lg, borderTopRightRadius: BorderRadius.lg,
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

const FieldInput = forwardRef<TextInput, {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  multiline?: boolean; optional?: boolean; minHeight?: number; error?: string;
  returnKeyType?: 'next' | 'done' | 'default'; onSubmitEditing?: () => void; readOnly?: boolean;
}>(function FieldInput(
  { label, value, onChangeText, placeholder, keyboardType = 'default', multiline,
    optional, minHeight, error, returnKeyType = 'default', onSubmitEditing, readOnly }, ref,
) {
  return (
    <View style={fi.group}>
      <Text style={fi.label}>{label}{!optional && ' *'}</Text>
      <TextInput ref={ref}
        style={[fi.input, multiline && { minHeight: minHeight ?? 80, textAlignVertical: 'top', paddingTop: 12 },
          !!error && fi.inputError, readOnly && fi.readOnly]}
        value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor={Colors.textLight} keyboardType={keyboardType} multiline={multiline}
        returnKeyType={multiline ? 'default' : returnKeyType}
        onSubmitEditing={multiline ? undefined : onSubmitEditing}
        blurOnSubmit={multiline ? false : returnKeyType === 'done'} editable={!readOnly} />
      {error && <Text style={fi.error}>{error}</Text>}
    </View>
  )
})

const fi = StyleSheet.create({
  group: { marginBottom: Spacing.md },
  label: { ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    ...Typography.body, color: Colors.textPrimary, backgroundColor: Colors.white,
  },
  readOnly: { backgroundColor: Colors.surface, color: Colors.textSecondary },
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
  container: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md, paddingVertical: 2 },
  label: { ...Typography.body, color: Colors.textPrimary, flex: 1, marginRight: Spacing.md },
  toggle: { flexDirection: 'row', borderWidth: 1.5, borderColor: Colors.border, borderRadius: BorderRadius.md, overflow: 'hidden' },
  btn: { paddingVertical: 8, paddingHorizontal: Spacing.md, backgroundColor: Colors.surface },
  btnActive: { backgroundColor: Colors.primary },
  btnText: { ...Typography.bodySmall, color: Colors.textSecondary, fontWeight: '600' },
  btnTextActive: { color: Colors.dark },
})

// ── ChecklistSection ───────────────────────────────────────────────────────────

interface ChecklistItem { id: number; label: string; sublabel?: string }

function ChecklistSection({ title, items, selectedIds, onToggle, emptyMessage }: {
  title: string; items: ChecklistItem[]; selectedIds: number[];
  onToggle: (id: number) => void; emptyMessage: string;
}) {
  return (
    <View style={cl.container}>
      <View style={cl.header}>
        <Text style={cl.title}>{title}</Text>
        {selectedIds.length > 0 && (
          <View style={cl.badge}><Text style={cl.badgeText}>{selectedIds.length}</Text></View>
        )}
      </View>
      {items.length === 0 ? (
        <Text style={cl.empty}>{emptyMessage}</Text>
      ) : (
        items.map((item) => {
          const selected = selectedIds.includes(item.id)
          return (
            <TouchableOpacity key={item.id} style={[cl.row, selected && cl.rowSelected]}
              onPress={() => onToggle(item.id)} activeOpacity={0.7}>
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
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.background,
  },
  title: { ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  badge: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.full,
    minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
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
      <View style={lp.barBg}><View style={[lp.barFill, { width: `${pct}%` as any }]} /></View>
      <View style={lp.stats}>
        <View style={lp.stat}><Text style={lp.statVal}>{fmt(data.planned_sqm)} m²</Text><Text style={lp.statLabel}>Planned</Text></View>
        <View style={[lp.stat, lp.statCenter]}><Text style={[lp.statVal, lp.statInstalled]}>{fmt(data.actual_sqm)} m²</Text><Text style={lp.statLabel}>Installed</Text></View>
        <View style={[lp.stat, lp.statRight]}><Text style={lp.statVal}>{fmt(data.remaining_sqm)} m²</Text><Text style={lp.statLabel}>Remaining</Text></View>
      </View>
      <Text style={lp.pctLabel}>{pct}% complete</Text>
    </View>
  )
}

const lp = StyleSheet.create({
  card: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  barBg: { height: 8, backgroundColor: Colors.surface, borderRadius: 4, overflow: 'hidden', marginBottom: Spacing.sm },
  barFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 4 },
  stats: { flexDirection: 'row', marginBottom: 4 },
  stat: { flex: 1, alignItems: 'flex-start' },
  statCenter: { alignItems: 'center' },
  statRight: { alignItems: 'flex-end' },
  statVal: { ...Typography.bodySmall, color: Colors.textPrimary, fontWeight: '600' },
  statInstalled: { color: Colors.primaryDark },
  statLabel: { ...Typography.caption, color: Colors.textSecondary },
  pctLabel: { ...Typography.caption, color: Colors.textSecondary, textAlign: 'right' },
})

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function EntryEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const showToast = useToastStore((s) => s.show)
  const activeProject = useProjectStore((s) => s.activeProject)

  const refQuery = useReference()
  const lots = refQuery.data?.lots ?? []
  const materials = refQuery.data?.materials ?? []
  const lotMaterials = refQuery.data?.lot_materials ?? {}
  const lotProgress = refQuery.data?.lot_progress ?? {}
  const allEmployees = refQuery.data?.employees ?? []
  const allMachines = refQuery.data?.machines ?? []

  const hireQuery = useHire(activeProject?.id)
  const allHiredMachines = hireQuery.data ?? []

  const queryClient = useQueryClient()

  const entryQuery = useQuery({
    queryKey: ['entry', id],
    queryFn: () =>
      cachedQuery(`entry_${id}`, () =>
        api.entries.detail(Number(id)).then((r) => r.data)
      ),
    enabled: !!id,
  })

  const entry = entryQuery.data

  // ── Form state ───────────────────────────────────────────────────────────────
  const [step, setStep] = useState(1)
  const [ready, setReady] = useState(false)

  // Step 1
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

  // Step 4 — Variations, Delays & Notes
  const [variationLines, setVariationLines] = useState<{ number: string; description: string; hours: string; employee_ids: number[]; machine_ids: number[] }[]>([])
  const [delayLines, setDelayLines] = useState<{ reason: string; hours: string; description: string }[]>([])
  const [selectedStanddownIds, setSelectedStanddownIds] = useState<number[]>([])
  const [notes, setNotes] = useState('')
  const [otherActivityLines, setOtherActivityLines] = useState<{ description: string; hours: string; employee_ids: number[] }[]>([])

  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── Keyboard refs ─────────────────────────────────────────────────────────────
  const locationRef = useRef<TextInput>(null)
  const notesRef = useRef<TextInput>(null)

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function toggleId(ids: number[], tid: number): number[] {
    return ids.includes(tid) ? ids.filter((x) => x !== tid) : [...ids, tid]
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
    setVariationLines(prev => [...prev, { number: '', description: '', hours: '', employee_ids: [], machine_ids: [] }])
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
  function toggleVariationMachine(lineIndex: number, machineId: number) {
    setVariationLines(prev => prev.map((line, i) => {
      if (i !== lineIndex) return line
      const ids = line.machine_ids.includes(machineId)
        ? line.machine_ids.filter(x => x !== machineId)
        : [...line.machine_ids, machineId]
      return { ...line, machine_ids: ids }
    }))
  }

  // Select All / Clear helpers
  function selectAllLineEmployees(lineIndex: number) {
    setProductionLines(prev => prev.map((line, i) =>
      i === lineIndex ? { ...line, employee_ids: [...selectedEmployeeIds] } : line
    ))
  }
  function clearLineEmployees(lineIndex: number) {
    setProductionLines(prev => prev.map((line, i) =>
      i === lineIndex ? { ...line, employee_ids: [] } : line
    ))
  }
  function selectAllVariationEmployees(lineIndex: number) {
    setVariationLines(prev => prev.map((line, i) =>
      i === lineIndex ? { ...line, employee_ids: [...selectedEmployeeIds] } : line
    ))
  }
  function clearVariationEmployees(lineIndex: number) {
    setVariationLines(prev => prev.map((line, i) =>
      i === lineIndex ? { ...line, employee_ids: [] } : line
    ))
  }
  function selectAllVariationMachines(lineIndex: number) {
    setVariationLines(prev => prev.map((line, i) =>
      i === lineIndex ? { ...line, machine_ids: [...selectedMachineIds] } : line
    ))
  }
  function clearVariationMachines(lineIndex: number) {
    setVariationLines(prev => prev.map((line, i) =>
      i === lineIndex ? { ...line, machine_ids: [] } : line
    ))
  }
  function selectAllOtherActivityEmployees(lineIndex: number) {
    setOtherActivityLines(prev => prev.map((line, i) =>
      i === lineIndex ? { ...line, employee_ids: [...selectedEmployeeIds] } : line
    ))
  }
  function clearOtherActivityEmployees(lineIndex: number) {
    setOtherActivityLines(prev => prev.map((line, i) =>
      i === lineIndex ? { ...line, employee_ids: [] } : line
    ))
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

  // Person-hours calculations
  const crewCount = selectedEmployeeIds.length
  const hoursPerDay = activeProject?.hours_per_day ?? 8
  const productionPersonHours = productionLines.reduce((sum, l) => sum + (parseFloat(l.hours) || 0) * l.employee_ids.length, 0)
  const variationPersonHours = variationLines.reduce((sum, vl) => sum + (parseFloat(vl.hours) || 0) * vl.employee_ids.length, 0)
  const otherPersonHours = otherActivityLines.reduce((sum, ol) => sum + (parseFloat(ol.hours) || 0) * ol.employee_ids.length, 0)
  const availablePersonHours = crewCount * hoursPerDay
  const totalAccountedPersonHours = productionPersonHours + variationPersonHours + otherPersonHours
  const unaccountedPersonHours = availablePersonHours - totalAccountedPersonHours

  // ── Populate from loaded entry ────────────────────────────────────────────────
  useEffect(() => {
    if (!entry || ready) return
    setLocation(entry.location ?? '')
    setWeather(entry.weather ?? '')
    // Load production lines from entry
    if (entry.production_lines && entry.production_lines.length > 0) {
      setProductionLines(entry.production_lines.map((pl: any) => ({
        lot: pl.lot_number ?? '', material: pl.material ?? '',
        hours: pl.install_hours != null ? String(pl.install_hours) : '',
        sqm: pl.install_sqm != null ? String(pl.install_sqm) : '',
        activity_type: pl.activity_type ?? 'deploy',
        weld_metres: pl.weld_metres != null ? String(pl.weld_metres) : '',
        employee_ids: pl.employee_ids_json ? JSON.parse(pl.employee_ids_json) : [],
      })))
    } else if (entry.lot_number || entry.material || entry.install_sqm) {
      setProductionLines([{
        lot: entry.lot_number ?? '', material: entry.material ?? '',
        hours: entry.install_hours != null ? String(entry.install_hours) : '',
        sqm: entry.install_sqm != null ? String(entry.install_sqm) : '',
        activity_type: 'deploy', weld_metres: '', employee_ids: [],
      }])
    }
    setSelectedEmployeeIds((entry.employees ?? []).map((e: any) => e.id))
    setSelectedMachineIds((entry.machines ?? []).map((m: any) => m.id))
    setSelectedStanddownIds((entry.standdown_machines ?? []).map((h: any) => h.id))
    // Load variation lines
    if ((entry as any).variation_lines && (entry as any).variation_lines.length > 0) {
      setVariationLines((entry as any).variation_lines.map((vl: any) => ({
        number: vl.variation_number ?? '', description: vl.description ?? '',
        hours: vl.hours != null ? String(vl.hours) : '',
        employee_ids: vl.employee_ids_json ? JSON.parse(vl.employee_ids_json) : [],
        machine_ids: vl.machine_ids_json ? JSON.parse(vl.machine_ids_json) : [],
      })))
    }
    // Load delay lines
    if ((entry as any).delay_lines && (entry as any).delay_lines.length > 0) {
      setDelayLines((entry as any).delay_lines.map((dl: any) => ({
        reason: dl.reason ?? '', hours: dl.hours != null ? String(dl.hours) : '', description: dl.description ?? '',
      })))
    } else if ((entry.delay_hours ?? 0) > 0) {
      setDelayLines([{
        reason: entry.delay_reason ?? '', hours: String(entry.delay_hours ?? ''), description: entry.delay_description ?? '',
      }])
    }
    // Load other activity lines
    if ((entry as any).other_activity_lines && (entry as any).other_activity_lines.length > 0) {
      setOtherActivityLines((entry as any).other_activity_lines.map((ol: any) => ({
        description: ol.description ?? '', hours: ol.hours != null ? String(ol.hours) : '',
        employee_ids: ol.employee_ids_json ? JSON.parse(ol.employee_ids_json) : [],
      })))
    }
    setNotes(entry.notes ?? '')
    setReady(true)
  }, [entry])

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

  // ── Validation & navigation ───────────────────────────────────────────────────
  function validateStep(): boolean {
    const errs: Record<string, string> = {}
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

  function handleHeaderBack() {
    if (step === 1) router.back()
    else handleBack()
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!id) return
    setSaving(true)
    try {
      const validLines = productionLines.filter(l => l.lot || l.material || l.sqm || l.hours)
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
          machine_ids_json: vl.machine_ids.length > 0 ? JSON.stringify(vl.machine_ids) : undefined,
        }))

      const apiOtherActivityLines: OtherActivityLine[] = otherActivityLines
        .filter(ol => ol.description || ol.hours)
        .map(ol => ({
          description: ol.description,
          hours: parseFloat(ol.hours) || 0,
          employee_ids_json: ol.employee_ids.length > 0 ? JSON.stringify(ol.employee_ids) : undefined,
        }))

      await api.entries.update(Number(id), {
        location: location || undefined,
        weather: weather || undefined,
        delay_hours: totalDelayHours || 0,
        delay_reason: delayLines[0]?.reason || undefined,
        delay_description: delayLines[0]?.description || undefined,
        notes: notes || undefined,
        employee_ids: selectedEmployeeIds,
        machine_ids: selectedMachineIds,
        standdown_machine_ids: selectedStanddownIds.length > 0 ? selectedStanddownIds : [],
        production_lines: apiProductionLines,
        variation_lines: apiVariationLines.length > 0 ? apiVariationLines : undefined,
        delay_lines: apiDelayLines.length > 0 ? apiDelayLines : undefined,
        other_activity_lines: apiOtherActivityLines.length > 0 ? apiOtherActivityLines : undefined,
      } as any)
      queryClient.invalidateQueries({ queryKey: ['entry', id] })
      queryClient.invalidateQueries({ queryKey: ['entries'] })
      showToast('Entry updated', 'success')
      router.back()
    } catch {
      showToast('Failed to save changes', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (entryQuery.isLoading || !ready) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading entry...</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (entryQuery.isError || !entry) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.errorText}>Could not load entry.</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <InternalHeader step={step} onBack={handleHeaderBack} />
      <StepIndicator current={step} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          {/* ── Step 1: Entry Details ── */}
          {step === 1 && (
            <View>
              <FieldInput label="Project" value={entry.project_name || activeProject?.name || ''} onChangeText={() => {}} readOnly optional />
              <FieldInput label="Date" value={fmtDateAU(entry.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} onChangeText={() => {}} readOnly optional />
              <FieldInput ref={locationRef} label="Location" value={location}
                onChangeText={setLocation} placeholder="e.g. Cell 3 North" optional returnKeyType="done" />
              <SelectField label="Weather" value={weather} options={WEATHER_OPTIONS}
                onChange={setWeather} placeholder="Select weather..." optional />
            </View>
          )}

          {/* ── Step 3: Production ── */}
          {step === 3 && (
            <View>
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
                  <SelectField label="Lot" value={line.lot} options={lots}
                    onChange={(v) => updateLine(index, 'lot', v)} placeholder="Select lot..." optional />
                  )}
                  <SelectField label="Material" value={line.material}
                    options={line.lot && lotMaterials[line.lot] ? lotMaterials[line.lot] : materials}
                    onChange={(v) => updateLine(index, 'material', v)} placeholder="Select material..." optional />
                  {line.lot && lotMaterials[line.lot] && (
                    <Text style={styles.filterHint}>Showing materials for Lot {line.lot}</Text>
                  )}
                  {line.lot && line.material && lotProgress[line.lot]?.[line.material] && (
                    <LotProgressCard data={lotProgress[line.lot][line.material]} />
                  )}
                  <FieldInput label="Hours" value={line.hours}
                    onChangeText={(v) => updateLine(index, 'hours', v)} placeholder="0.0"
                    keyboardType="decimal-pad" optional returnKeyType="next" />
                  {line.activity_type === 'weld' ? (
                    <FieldInput label="Weld (m)" value={line.weld_metres}
                      onChangeText={(v) => updateLine(index, 'weld_metres', v)} placeholder="0.0"
                      keyboardType="decimal-pad" optional returnKeyType="done" />
                  ) : (
                    <FieldInput label="Area Installed (m\u00B2)" value={line.sqm}
                      onChangeText={(v) => updateLine(index, 'sqm', v)} placeholder="0.0"
                      keyboardType="decimal-pad" optional returnKeyType="done" />
                  )}

                  {/* Crew selector per production line */}
                  <View style={styles.lineCrewSection}>
                    <Text style={sf.label}>Line Crew</Text>
                    {selectedEmployeeIds.length === 0 ? (
                      <Text style={styles.lineCrewHint}>Select crew in Step 2 first</Text>
                    ) : (
                      <View>
                        <View style={styles.selectAllRowInline}>
                          <TouchableOpacity style={styles.selectAllBtnSmall} onPress={() => selectAllLineEmployees(index)} activeOpacity={0.7}>
                            <Text style={styles.selectAllBtnSmallText}>Select All</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.clearBtnSmall} onPress={() => clearLineEmployees(index)} activeOpacity={0.7}>
                            <Text style={styles.clearBtnSmallText}>Clear</Text>
                          </TouchableOpacity>
                        </View>
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
            <View>
              <View style={styles.selectAllRow}>
                <TouchableOpacity style={styles.selectAllBtn} onPress={() => setSelectedEmployeeIds(allEmployees.map(e => e.id))} activeOpacity={0.7}>
                  <Text style={styles.selectAllBtnText}>Select All</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.clearBtn} onPress={() => setSelectedEmployeeIds([])} activeOpacity={0.7}>
                  <Text style={styles.clearBtnText}>Clear</Text>
                </TouchableOpacity>
              </View>
              <ChecklistSection
                title="Crew Members"
                items={employeeItems}
                selectedIds={selectedEmployeeIds}
                onToggle={(tid) => setSelectedEmployeeIds((prev) => toggleId(prev, tid))}
                emptyMessage="No active employees found."
              />
            </View>
          )}

          {/* ── Step 5: Equipment ── */}
          {step === 5 && (
            <View>
              <View style={styles.selectAllRow}>
                <TouchableOpacity style={styles.selectAllBtn} onPress={() => setSelectedMachineIds(allMachines.map(m => m.id))} activeOpacity={0.7}>
                  <Text style={styles.selectAllBtnText}>Select All</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.clearBtn} onPress={() => setSelectedMachineIds([])} activeOpacity={0.7}>
                  <Text style={styles.clearBtnText}>Clear</Text>
                </TouchableOpacity>
              </View>
              <ChecklistSection
                title="Machines Used"
                items={machineItems}
                selectedIds={selectedMachineIds}
                onToggle={(tid) => setSelectedMachineIds((prev) => toggleId(prev, tid))}
                emptyMessage="No active machines found."
              />
            </View>
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
                      <View>
                        <View style={styles.selectAllRowInline}>
                          <TouchableOpacity style={styles.selectAllBtnSmall} onPress={() => selectAllVariationEmployees(index)} activeOpacity={0.7}>
                            <Text style={styles.selectAllBtnSmallText}>Select All</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.clearBtnSmall} onPress={() => clearVariationEmployees(index)} activeOpacity={0.7}>
                            <Text style={styles.clearBtnSmallText}>Clear</Text>
                          </TouchableOpacity>
                        </View>
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
                      </View>
                    )}
                  </View>
                  {/* Equipment selector per variation */}
                  <View style={styles.lineCrewSection}>
                    <Text style={sf.label}>Equipment</Text>
                    {selectedMachineIds.length === 0 ? (
                      <Text style={styles.lineCrewHint}>Select equipment in Step 5 first</Text>
                    ) : (
                      <View>
                        <View style={styles.selectAllRowInline}>
                          <TouchableOpacity style={styles.selectAllBtnSmall} onPress={() => selectAllVariationMachines(index)} activeOpacity={0.7}>
                            <Text style={styles.selectAllBtnSmallText}>Select All</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.clearBtnSmall} onPress={() => clearVariationMachines(index)} activeOpacity={0.7}>
                            <Text style={styles.clearBtnSmallText}>Clear</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.lineCrewChips}>
                          {allMachines
                            .filter(m => selectedMachineIds.includes(m.id))
                            .map(machine => {
                              const selected = vl.machine_ids.includes(machine.id)
                              return (
                                <TouchableOpacity
                                  key={machine.id}
                                  style={[styles.crewChip, selected && styles.crewChipSelected]}
                                  onPress={() => toggleVariationMachine(index, machine.id)}
                                  activeOpacity={0.7}
                                >
                                  <Text style={[styles.crewChipText, selected && styles.crewChipTextSelected]}>
                                    {machine.name}
                                  </Text>
                                </TouchableOpacity>
                              )
                            })}
                        </View>
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
                  <SelectField label="Reason" value={dl.reason} options={DELAY_REASONS}
                    onChange={(v) => updateDelayLine(index, 'reason', v)} placeholder="Select reason..."
                    error={errors[`delayReason_${index}`]} />
                  <FieldInput label="Hours" value={dl.hours}
                    onChangeText={(v) => updateDelayLine(index, 'hours', v)} placeholder="0.0"
                    keyboardType="decimal-pad" error={errors[`delayHours_${index}`]} />
                  <FieldInput label="Description" value={dl.description}
                    onChangeText={(v) => updateDelayLine(index, 'description', v)}
                    placeholder="Additional details..." multiline optional />
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
                    onToggle={(tid) => setSelectedStanddownIds((prev) => toggleId(prev, tid))}
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
                  <FieldInput label="Description" value={ol.description}
                    onChangeText={(v) => updateOtherActivityLine(index, 'description', v)}
                    placeholder="What was done..." multiline />
                  <FieldInput label="Hours" value={ol.hours}
                    onChangeText={(v) => updateOtherActivityLine(index, 'hours', v)}
                    placeholder="0.0" keyboardType="decimal-pad" optional />
                  {/* Crew selector for other activity line */}
                  <View style={styles.lineCrewSection}>
                    <Text style={sf.label}>Crew</Text>
                    {selectedEmployeeIds.length === 0 ? (
                      <Text style={styles.lineCrewHint}>Select crew in Step 2 first</Text>
                    ) : (
                      <View>
                        <View style={styles.selectAllRowInline}>
                          <TouchableOpacity style={styles.selectAllBtnSmall} onPress={() => selectAllOtherActivityEmployees(index)} activeOpacity={0.7}>
                            <Text style={styles.selectAllBtnSmallText}>Select All</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.clearBtnSmall} onPress={() => clearOtherActivityEmployees(index)} activeOpacity={0.7}>
                            <Text style={styles.clearBtnSmallText}>Clear</Text>
                          </TouchableOpacity>
                        </View>
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
                      </View>
                    )}
                  </View>
                </View>
              ))}

              <TouchableOpacity style={styles.addLineBtn} onPress={addOtherActivityLine} activeOpacity={0.7}>
                <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
                <Text style={styles.addLineBtnText}>Add Other Activity</Text>
              </TouchableOpacity>

              {/* ── Person-Hours Summary ── */}
              {crewCount > 0 && (
                <View style={phs.container}>
                  <Text style={phs.title}>Person-Hours Summary</Text>
                  <View style={phs.row}>
                    <Text style={phs.label}>Production</Text>
                    <Text style={phs.value}>{productionPersonHours.toFixed(1)} ph</Text>
                  </View>
                  <View style={phs.row}>
                    <Text style={phs.label}>Variations</Text>
                    <Text style={phs.value}>{variationPersonHours.toFixed(1)} ph</Text>
                  </View>
                  <View style={phs.row}>
                    <Text style={phs.label}>Other Activities</Text>
                    <Text style={phs.value}>{otherPersonHours.toFixed(1)} ph</Text>
                  </View>
                  <View style={phs.divider} />
                  <View style={phs.row}>
                    <Text style={phs.label}>Available ({crewCount} crew x {hoursPerDay}h)</Text>
                    <Text style={phs.value}>{availablePersonHours.toFixed(1)} ph</Text>
                  </View>
                  <View style={phs.row}>
                    <Text style={[phs.label, unaccountedPersonHours > 0 && phs.warningText]}>Unaccounted</Text>
                    <Text style={[phs.value, unaccountedPersonHours > 0 && phs.warningText]}>
                      {unaccountedPersonHours.toFixed(1)} ph
                    </Text>
                  </View>
                  {/* Progress bar */}
                  {availablePersonHours > 0 && (
                    <View style={phs.barBg}>
                      <View style={[phs.barSegment, { width: `${Math.min(100, (productionPersonHours / availablePersonHours) * 100)}%` as any, backgroundColor: Colors.primary }]} />
                      <View style={[phs.barSegment, { width: `${Math.min(100 - (productionPersonHours / availablePersonHours) * 100, (variationPersonHours / availablePersonHours) * 100)}%` as any, backgroundColor: Colors.warning }]} />
                      <View style={[phs.barSegment, { width: `${Math.min(100 - ((productionPersonHours + variationPersonHours) / availablePersonHours) * 100, (otherPersonHours / availablePersonHours) * 100)}%` as any, backgroundColor: Colors.textSecondary }]} />
                    </View>
                  )}
                  <View style={phs.legendRow}>
                    <View style={phs.legendItem}><View style={[phs.legendDot, { backgroundColor: Colors.primary }]} /><Text style={phs.legendText}>Production</Text></View>
                    <View style={phs.legendItem}><View style={[phs.legendDot, { backgroundColor: Colors.warning }]} /><Text style={phs.legendText}>Variation</Text></View>
                    <View style={phs.legendItem}><View style={[phs.legendDot, { backgroundColor: Colors.textSecondary }]} /><Text style={phs.legendText}>Other</Text></View>
                  </View>
                </View>
              )}

              <FieldInput ref={notesRef} label="Notes" value={notes}
                onChangeText={setNotes} placeholder="Any additional notes..." multiline minHeight={100} optional />
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Nav footer */}
      <View style={styles.nav}>
        {step > 1 ? (
          <Button title="← BACK" variant="outline" onPress={handleBack} fullWidth={false} style={styles.navBtn} />
        ) : (
          <View style={styles.navBtn} />
        )}
        {step < TOTAL_STEPS ? (
          <Button title="NEXT →" onPress={handleNext} fullWidth={false} style={styles.navBtn} />
        ) : (
          <Button title="SAVE CHANGES" onPress={handleSave} loading={saving} fullWidth={false} style={styles.navBtn} />
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SLATE },
  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, gap: 12 },
  loadingText: { ...Typography.body, color: Colors.textSecondary },
  errorText: { ...Typography.body, color: Colors.error },
  backLink: { ...Typography.body, color: Colors.primary, fontWeight: '600' },
  prodHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: Spacing.sm, marginTop: Spacing.sm,
  },
  prodHeaderTitle: { ...Typography.h4, color: Colors.textPrimary },
  prodHeaderTotal: { ...Typography.bodySmall, color: Colors.primary, fontWeight: '600' },
  prodLine: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface, padding: Spacing.md, marginBottom: Spacing.sm,
  },
  prodLineHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  prodLineNum: { ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  addLineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingVertical: 12, backgroundColor: 'rgba(255,183,197,0.08)', marginBottom: Spacing.md,
  },
  addLineBtnText: { ...Typography.body, color: Colors.primary, fontWeight: '600' },
  filterHint: {
    ...Typography.caption, color: Colors.textSecondary, fontStyle: 'italic',
    marginTop: -Spacing.sm, marginBottom: Spacing.md, paddingHorizontal: 2,
  },
  hireHelper: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,152,0,0.1)', borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2, marginBottom: Spacing.sm,
  },
  hireHelperText: { ...Typography.bodySmall, color: Colors.warning, fontWeight: '500', flex: 1 },
  standdownLabel: { ...Typography.bodySmall, color: Colors.textSecondary, marginBottom: Spacing.sm },
  nav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.md, backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.border, ...Shadows.sm,
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
  selectAllRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  selectAllBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: 'rgba(255,183,197,0.08)',
    alignItems: 'center',
  },
  selectAllBtnText: {
    ...Typography.bodySmall,
    color: Colors.primary,
    fontWeight: '600',
  },
  clearBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  clearBtnText: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  selectAllRowInline: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  selectAllBtnSmall: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: 'rgba(255,183,197,0.08)',
  },
  selectAllBtnSmallText: {
    ...Typography.caption,
    color: Colors.primary,
    fontWeight: '600',
  },
  clearBtnSmall: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  clearBtnSmallText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
})

const phs = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    marginTop: Spacing.sm,
  },
  title: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  label: {
    ...Typography.bodySmall,
    color: Colors.textPrimary,
  },
  value: {
    ...Typography.bodySmall,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  warningText: {
    color: Colors.warning,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 6,
  },
  barBg: {
    height: 10,
    backgroundColor: Colors.border,
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: Spacing.sm,
    flexDirection: 'row',
  },
  barSegment: {
    height: '100%',
  },
  legendRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
})
