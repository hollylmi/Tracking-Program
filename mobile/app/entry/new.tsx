import 'react-native-get-random-values'
import { v4 as uuidv4 } from 'uuid'
import { useState, useRef } from 'react'
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
import ScreenHeader from '../../components/layout/ScreenHeader'
import Button from '../../components/ui/Button'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../constants/theme'
import { useReference } from '../../hooks/useReference'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { useProjectStore } from '../../store/project'
import { useToastStore } from '../../store/toast'
import { api } from '../../lib/api'
import { saveEntry, markEntrySynced } from '../../lib/db'
import { LocalEntry } from '../../types'

// ── Constants ─────────────────────────────────────────────────────────────────────────────

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

const STEP_LABELS = ['Basic Info', 'Production', 'Delays', 'Notes']

// ── Helpers ───────────────────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// ── StepIndicator ───────────────────────────────────────────────────────────────────────────

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
    backgroundColor: Colors.white,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  item: { flex: 1, alignItems: 'center', gap: 5 },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: Colors.dark, borderColor: Colors.dark },
  dotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  label: { ...Typography.caption, color: Colors.textSecondary, textAlign: 'center' },
  labelActive: { color: Colors.primaryDark, fontWeight: '600' },
})

// ── SelectField ─────────────────────────────────────────────────────────────────────────────

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
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    ...Typography.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.white,
  },
  inputError: { borderColor: Colors.error },
  select: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    backgroundColor: Colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectText: { ...Typography.body, color: Colors.textPrimary },
  placeholder: { color: Colors.textLight },
  error: { ...Typography.bodySmall, color: Colors.error, marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    maxHeight: '60%',
    paddingBottom: Spacing.xl,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetTitle: { ...Typography.h4, color: Colors.textPrimary },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface,
  },
  optionSelected: { backgroundColor: '#FFF5F7' },
  optionText: { ...Typography.body, color: Colors.textPrimary },
  optionTextSelected: { color: Colors.primary, fontWeight: '600' },
})

// ── FieldInput ──────────────────────────────────────────────────────────────────────────────

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
}

function FieldInput({
  label, value, onChangeText, placeholder,
  keyboardType = 'default', multiline, optional, minHeight, error,
}: FieldInputProps) {
  return (
    <View style={fi.group}>
      <Text style={fi.label}>{label}{!optional && ' *'}</Text>
      <TextInput
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
      />
      {error && <Text style={fi.error}>{error}</Text>}
    </View>
  )
}

const fi = StyleSheet.create({
  group: { marginBottom: Spacing.md },
  label: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    ...Typography.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.white,
  },
  inputError: { borderColor: Colors.error },
  error: { ...Typography.bodySmall, color: Colors.error, marginTop: 4 },
})

// ── YesNoToggle ─────────────────────────────────────────────────────────────────────────────

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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    paddingVertical: 2,
  },
  label: { ...Typography.body, color: Colors.textPrimary, flex: 1, marginRight: Spacing.md },
  toggle: { flexDirection: 'row', borderWidth: 1.5, borderColor: Colors.border, borderRadius: BorderRadius.md, overflow: 'hidden' },
  btn: { paddingVertical: 8, paddingHorizontal: Spacing.md, backgroundColor: Colors.surface },
  btnActive: { backgroundColor: Colors.primary },
  btnText: { ...Typography.bodySmall, color: Colors.textSecondary, fontWeight: '600' },
  btnTextActive: { color: Colors.dark },
})

// ── Main Screen ─────────────────────────────────────────────────────────────────────────────

export default function NewEntryScreen() {
  const router = useRouter()
  const isOnline = useNetworkStatus()
  const activeProject = useProjectStore((s) => s.activeProject)
  const showToast = useToastStore((s) => s.show)

  const refQuery = useReference()
  const lots = refQuery.data?.lots ?? []
  const materials = refQuery.data?.materials ?? []

  const formOpenedAt = useRef(new Date().toISOString()).current

  const [step, setStep] = useState(1)

  // Step 1
  const [date, setDate] = useState(new Date())
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [lotNumber, setLotNumber] = useState('')
  const [material, setMaterial] = useState('')
  const [location, setLocation] = useState('')

  // Step 2
  const [installHours, setInstallHours] = useState('')
  const [installSqm, setInstallSqm] = useState('')
  const [numPeople, setNumPeople] = useState('')
  const [weather, setWeather] = useState('')

  // Step 3
  const [hasDelays, setHasDelays] = useState(false)
  const [delayHours, setDelayHours] = useState('')
  const [delayReason, setDelayReason] = useState('')
  const [delayBillable, setDelayBillable] = useState(true)
  const [delayDescription, setDelayDescription] = useState('')
  const [machinesStoodDown, setMachinesStoodDown] = useState(false)

  // Step 4
  const [notes, setNotes] = useState('')
  const [otherWork, setOtherWork] = useState('')

  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  function validateStep(): boolean {
    const errs: Record<string, string> = {}
    if (step === 1 && !date) {
      errs.date = 'Date is required'
    }
    if (step === 3 && hasDelays) {
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
      num_people: numPeople ? parseInt(numPeople, 10) : undefined,
      install_hours: installHours ? parseFloat(installHours) : undefined,
      install_sqm: installSqm ? parseFloat(installSqm) : undefined,
      weather: weather || undefined,
      delay_hours: hasDelays && delayHours ? parseFloat(delayHours) : undefined,
      delay_reason: hasDelays ? delayReason || undefined : undefined,
      delay_billable: hasDelays ? delayBillable : undefined,
      delay_description: hasDelays ? delayDescription || undefined : undefined,
      machines_stood_down: hasDelays ? machinesStoodDown : undefined,
      notes: notes || undefined,
      other_work_description: otherWork || undefined,
      form_opened_at: formOpenedAt,
      synced: 0,
    }

    saveEntry(entryData)

    if (isOnline) {
      try {
        const response = await api.entries.create(entryData)
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

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="New Entry" showBack />
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

          {/* Step 1: Basic Info */}
          {step === 1 && (
            <View>
              <Text style={styles.stepTitle}>Basic Info</Text>

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

              <SelectField
                label="Lot Number"
                value={lotNumber}
                options={lots}
                onChange={setLotNumber}
                placeholder="Select lot..."
                optional
              />
              <SelectField
                label="Material"
                value={material}
                options={materials}
                onChange={setMaterial}
                placeholder="Select material..."
                optional
              />
              <FieldInput
                label="Location"
                value={location}
                onChangeText={setLocation}
                placeholder="e.g. Cell 3 North"
                optional
              />
            </View>
          )}

          {/* Step 2: Production */}
          {step === 2 && (
            <View>
              <Text style={styles.stepTitle}>Production</Text>
              <FieldInput
                label="Install Hours"
                value={installHours}
                onChangeText={setInstallHours}
                placeholder="0.0"
                keyboardType="decimal-pad"
                optional
              />
              <FieldInput
                label="Area Installed (m²)"
                value={installSqm}
                onChangeText={setInstallSqm}
                placeholder="0.0"
                keyboardType="decimal-pad"
                optional
              />
              <FieldInput
                label="Number of Crew"
                value={numPeople}
                onChangeText={setNumPeople}
                placeholder="0"
                keyboardType="number-pad"
                optional
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

          {/* Step 3: Delays */}
          {step === 3 && (
            <View>
              <Text style={styles.stepTitle}>Delays</Text>

              <YesNoToggle label="Any delays today?" value={hasDelays} onChange={setHasDelays} />

              {!hasDelays ? (
                <View style={styles.noDelays}>
                  <Ionicons name="checkmark-circle-outline" size={40} color={Colors.success} />
                  <Text style={styles.noDelaysText}>No delays recorded</Text>
                </View>
              ) : (
                <View>
                  <FieldInput
                    label="Delay Hours"
                    value={delayHours}
                    onChangeText={setDelayHours}
                    placeholder="0.0"
                    keyboardType="decimal-pad"
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
                    label="Delay Description"
                    value={delayDescription}
                    onChangeText={setDelayDescription}
                    placeholder="Additional details..."
                    multiline
                    optional
                  />
                  <YesNoToggle label="Hired machines stood down?" value={machinesStoodDown} onChange={setMachinesStoodDown} />
                </View>
              )}
            </View>
          )}

          {/* Step 4: Notes */}
          {step === 4 && (
            <View>
              <Text style={styles.stepTitle}>Notes</Text>
              <FieldInput
                label="Notes"
                value={notes}
                onChangeText={setNotes}
                placeholder="Any additional notes..."
                multiline
                minHeight={100}
                optional
              />
              <FieldInput
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

        {step < 4 ? (
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
  root: { flex: 1, backgroundColor: Colors.dark },
  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  stepTitle: { ...Typography.h2, color: Colors.textPrimary, marginBottom: Spacing.lg },
  datePicker: {
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  datePickerDone: { alignItems: 'flex-end', paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  datePickerDoneText: { ...Typography.body, color: Colors.primary, fontWeight: '600' },
  noDelays: { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm },
  noDelaysText: { ...Typography.body, color: Colors.textSecondary },
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...Shadows.sm,
  },
  navBtn: { minWidth: 130 },
})
