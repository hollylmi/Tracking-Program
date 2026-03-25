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
import { cachedQuery } from '../../../lib/cachedQuery'
import { LotMaterialProgress } from '../../../types'

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

const STEP_LABELS = ['Details', 'Production', 'Crew', 'Equipment', 'Delays']
const STEP_HEADER_TITLES: Record<number, string> = {
  1: 'Entry Details',
  2: 'Production',
  3: 'Crew',
  4: 'Equipment',
  5: 'Delays & Notes',
}
const TOTAL_STEPS = 5

// ── InternalHeader ─────────────────────────────────────────────────────────────

function InternalHeader({ step, onBack }: { step: number; onBack: () => void }) {
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
    backgroundColor: SLATE, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: 13,
  },
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

  // Step 2
  const [lotNumber, setLotNumber] = useState('')
  const [material, setMaterial] = useState('')
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

  // ── Keyboard refs ─────────────────────────────────────────────────────────────
  const locationRef = useRef<TextInput>(null)
  const installHoursRef = useRef<TextInput>(null)
  const installSqmRef = useRef<TextInput>(null)
  const delayHoursRef = useRef<TextInput>(null)
  const delayDescRef = useRef<TextInput>(null)
  const notesRef = useRef<TextInput>(null)
  const otherWorkRef = useRef<TextInput>(null)

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function toggleId(ids: number[], tid: number): number[] {
    return ids.includes(tid) ? ids.filter((x) => x !== tid) : [...ids, tid]
  }

  // ── Populate from loaded entry ────────────────────────────────────────────────
  useEffect(() => {
    if (!entry || ready) return
    setLocation(entry.location ?? '')
    setWeather(entry.weather ?? '')
    setLotNumber(entry.lot_number ?? '')
    setMaterial(entry.material ?? '')
    setInstallHours(entry.install_hours != null ? String(entry.install_hours) : '')
    setInstallSqm(entry.install_sqm != null ? String(entry.install_sqm) : '')
    setSelectedEmployeeIds((entry.employees ?? []).map((e: any) => e.id))
    setSelectedMachineIds((entry.machines ?? []).map((m: any) => m.id))
    setSelectedStanddownIds((entry.standdown_machines ?? []).map((h: any) => h.id))
    const dh = entry.delay_hours ?? 0
    setHasDelays(dh > 0)
    setDelayHours(dh > 0 ? String(dh) : '')
    setDelayReason(entry.delay_reason ?? '')
    setDelayBillable(entry.delay_billable !== false)
    setDelayDescription(entry.delay_description ?? '')
    setNotes(entry.notes ?? '')
    setOtherWork(entry.other_work_description ?? '')
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

  function handleHeaderBack() {
    if (step === 1) router.back()
    else handleBack()
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!id) return
    setSaving(true)
    try {
      await api.entries.update(Number(id), {
        location: location || undefined,
        weather: weather || undefined,
        lot_number: lotNumber || undefined,
        material: material || undefined,
        install_hours: installHours ? parseFloat(installHours) : undefined,
        install_sqm: installSqm ? parseFloat(installSqm) : undefined,
        delay_hours: hasDelays && delayHours ? parseFloat(delayHours) : 0,
        delay_reason: hasDelays ? delayReason || undefined : undefined,
        delay_billable: hasDelays ? delayBillable : undefined,
        delay_description: hasDelays ? delayDescription || undefined : undefined,
        notes: notes || undefined,
        other_work_description: otherWork || undefined,
        employee_ids: selectedEmployeeIds,
        machine_ids: selectedMachineIds,
        standdown_machine_ids: selectedStanddownIds.length > 0 ? selectedStanddownIds : [],
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
              <FieldInput label="Date" value={entry.date} onChangeText={() => {}} readOnly optional />
              <FieldInput ref={locationRef} label="Location" value={location}
                onChangeText={setLocation} placeholder="e.g. Cell 3 North" optional returnKeyType="done" />
              <SelectField label="Weather" value={weather} options={WEATHER_OPTIONS}
                onChange={setWeather} placeholder="Select weather..." optional />
            </View>
          )}

          {/* ── Step 2: Production ── */}
          {step === 2 && (
            <View>
              <SelectField label="Lot Number" value={lotNumber} options={lots}
                onChange={(v) => {
                  setLotNumber(v)
                  if (v && lotMaterials[v] && material && !lotMaterials[v].includes(material)) setMaterial('')
                }}
                placeholder="Select lot..." optional />
              <SelectField label="Material" value={material}
                options={lotNumber && lotMaterials[lotNumber] ? lotMaterials[lotNumber] : materials}
                onChange={setMaterial} placeholder="Select material..." optional />
              {lotNumber && lotMaterials[lotNumber] && (
                <Text style={styles.filterHint}>Showing materials for Lot {lotNumber}</Text>
              )}
              {lotNumber && material && lotProgress[lotNumber]?.[material] && (
                <LotProgressCard data={lotProgress[lotNumber][material]} />
              )}
              <FieldInput ref={installHoursRef} label="Install Hours" value={installHours}
                onChangeText={setInstallHours} placeholder="0.0" keyboardType="decimal-pad"
                optional returnKeyType="next" onSubmitEditing={() => installSqmRef.current?.focus()} />
              <FieldInput ref={installSqmRef} label="Area Installed (m²)" value={installSqm}
                onChangeText={setInstallSqm} placeholder="0.0" keyboardType="decimal-pad"
                optional returnKeyType="done" />
            </View>
          )}

          {/* ── Step 3: Crew ── */}
          {step === 3 && (
            <ChecklistSection
              title="Crew Members"
              items={employeeItems}
              selectedIds={selectedEmployeeIds}
              onToggle={(tid) => setSelectedEmployeeIds((prev) => toggleId(prev, tid))}
              emptyMessage="No active employees found."
            />
          )}

          {/* ── Step 4: Equipment ── */}
          {step === 4 && (
            <ChecklistSection
              title="Machines Used"
              items={machineItems}
              selectedIds={selectedMachineIds}
              onToggle={(tid) => setSelectedMachineIds((prev) => toggleId(prev, tid))}
              emptyMessage="No active machines found."
            />
          )}

          {/* ── Step 5: Delays & Notes ── */}
          {step === 5 && (
            <View>
              <YesNoToggle label="Any delays today?" value={hasDelays}
                onChange={(v) => {
                  setHasDelays(v)
                  if (!v) { setDelayHours(''); setDelayReason(''); setDelayDescription('') }
                }} />
              {hasDelays && (
                <View>
                  <FieldInput ref={delayHoursRef} label="Delay Hours" value={delayHours}
                    onChangeText={setDelayHours} placeholder="0.0" keyboardType="decimal-pad"
                    returnKeyType="next" onSubmitEditing={() => delayDescRef.current?.focus()}
                    error={errors.delayHours} />
                  <SelectField label="Delay Reason" value={delayReason} options={DELAY_REASONS}
                    onChange={setDelayReason} placeholder="Select reason..." error={errors.delayReason} />
                  <YesNoToggle label="Charged to client?" value={delayBillable} onChange={setDelayBillable} />
                  <FieldInput ref={delayDescRef} label="Delay Description" value={delayDescription}
                    onChangeText={setDelayDescription} placeholder="Additional details..." multiline optional />
                </View>
              )}

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

              <FieldInput ref={notesRef} label="Notes" value={notes}
                onChangeText={setNotes} placeholder="Any additional notes..." multiline minHeight={100} optional />
              <FieldInput ref={otherWorkRef} label="Other Work Description" value={otherWork}
                onChangeText={setOtherWork} placeholder="Other work completed..." multiline minHeight={100} optional />
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
})
