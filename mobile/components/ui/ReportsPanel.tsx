import { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Ionicons } from '@expo/vector-icons'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import Card from './Card'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { useHire } from '../../hooks/useHire'
import { useToastStore } from '../../store/toast'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function displayDate(d: Date): string {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Snap a date to the Monday of its week */
function toMonday(d: Date): Date {
  const copy = new Date(d)
  const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + diff)
  return copy
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}

async function downloadAndShare(
  fetcher: () => Promise<any>,
  filename: string,
  showToast: (msg: string, type?: 'success' | 'warning' | 'error') => void,
): Promise<void> {
  try {
    const response = await fetcher()
    const data: ArrayBuffer = response.data

    const filePath = `${FileSystem.cacheDirectory}${filename}`
    const base64 = arrayBufferToBase64(data)
    await FileSystem.writeAsStringAsync(filePath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    })

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(filePath, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
      })
    } else {
      showToast('Sharing not available on this device', 'warning')
    }
  } catch (err: any) {
    const msg = err?.response?.status === 404
      ? 'No data found for the selected period'
      : 'Failed to generate report'
    showToast(msg, 'error')
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// ── Date picker field ────────────────────────────────────────────────────────

function DateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: Date
  onChange: (d: Date) => void
}) {
  const [open, setOpen] = useState(false)

  const handleChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS !== 'ios') setOpen(false)
    if (selected) onChange(selected)
  }

  return (
    <View style={s.dateField}>
      <Text style={s.dateLabel}>{label}</Text>
      <TouchableOpacity style={s.dateBtn} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={s.dateBtnText}>{displayDate(value)}</Text>
        <Ionicons name="calendar-outline" size={14} color={Colors.textSecondary} />
      </TouchableOpacity>
      {open && (
        <View>
          <DateTimePicker
            value={value}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={handleChange}
            maximumDate={new Date()}
            themeVariant="light"
          />
          {Platform.OS === 'ios' && (
            <TouchableOpacity style={s.dateDone} onPress={() => setOpen(false)}>
              <Text style={s.dateDoneText}>Done</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  )
}

// ── Generate button ──────────────────────────────────────────────────────────

function GenerateButton({
  loading,
  onPress,
}: {
  loading: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={s.genBtn}
      onPress={onPress}
      activeOpacity={0.75}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={Colors.dark} />
      ) : (
        <>
          <Ionicons name="download-outline" size={16} color={Colors.dark} />
          <Text style={s.genBtnText}>Generate PDF</Text>
        </>
      )}
    </TouchableOpacity>
  )
}

// ── Report Cards ─────────────────────────────────────────────────────────────

function ProgressReport({ projectId }: { projectId: number }) {
  const [loading, setLoading] = useState(false)
  const showToast = useToastStore((s) => s.show)

  const generate = async () => {
    setLoading(true)
    await downloadAndShare(
      () => api.reports.progress(projectId),
      `progress_${projectId}.pdf`,
      showToast,
    )
    setLoading(false)
  }

  return (
    <Card style={s.reportCard}>
      <View style={s.reportHeader}>
        <Ionicons name="bar-chart-outline" size={18} color={Colors.primary} />
        <Text style={s.reportTitle}>Progress Report</Text>
      </View>
      <Text style={s.reportDesc}>Overall project progress summary</Text>
      <GenerateButton loading={loading} onPress={generate} />
    </Card>
  )
}

function WeeklyReport({ projectId }: { projectId: number }) {
  const [loading, setLoading] = useState(false)
  const [weekStart, setWeekStart] = useState(() => toMonday(new Date()))
  const showToast = useToastStore((s) => s.show)

  const handleDateChange = (d: Date) => setWeekStart(toMonday(d))

  const generate = async () => {
    setLoading(true)
    const weekEnd = addDays(weekStart, 6)
    await downloadAndShare(
      () => api.reports.weekly(projectId, fmtDate(weekStart), fmtDate(weekEnd)),
      `weekly_${projectId}_${fmtDate(weekStart)}.pdf`,
      showToast,
    )
    setLoading(false)
  }

  return (
    <Card style={s.reportCard}>
      <View style={s.reportHeader}>
        <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
        <Text style={s.reportTitle}>Weekly Report</Text>
      </View>
      <Text style={s.reportDesc}>Week starting Monday</Text>
      <DateField label="Week of" value={weekStart} onChange={handleDateChange} />
      <GenerateButton loading={loading} onPress={generate} />
    </Card>
  )
}

function DelayReport({ projectId }: { projectId: number }) {
  const [loading, setLoading] = useState(false)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d
  })
  const [endDate, setEndDate] = useState(() => new Date())
  const showToast = useToastStore((s) => s.show)

  const generate = async () => {
    setLoading(true)
    await downloadAndShare(
      () => api.reports.delays(projectId, fmtDate(startDate), fmtDate(endDate)),
      `delays_${projectId}_${fmtDate(startDate)}_${fmtDate(endDate)}.pdf`,
      showToast,
    )
    setLoading(false)
  }

  return (
    <Card style={s.reportCard}>
      <View style={s.reportHeader}>
        <Ionicons name="warning-outline" size={18} color={Colors.primary} />
        <Text style={s.reportTitle}>Delay Report</Text>
      </View>
      <Text style={s.reportDesc}>Delays within a date range</Text>
      <View style={s.dateRow}>
        <View style={{ flex: 1 }}>
          <DateField label="From" value={startDate} onChange={setStartDate} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="To" value={endDate} onChange={setEndDate} />
        </View>
      </View>
      <GenerateButton loading={loading} onPress={generate} />
    </Card>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function ReportsPanel() {
  const user = useAuthStore((s) => s.user)
  const activeProject = useProjectStore((s) => s.activeProject)

  // Only admin and supervisor can see reports
  if (!user || user.role === 'site') return null
  if (!activeProject) return null

  return (
    <View style={s.container}>
      <View style={s.divider} />
      <Text style={s.sectionLabel}>REPORTS</Text>
      <ProgressReport projectId={activeProject.id} />
      <WeeklyReport projectId={activeProject.id} />
      <DelayReport projectId={activeProject.id} />
    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    marginTop: Spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  sectionLabel: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  reportCard: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 4,
  },
  reportTitle: {
    ...Typography.h4,
    color: Colors.textPrimary,
  },
  reportDesc: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  dateRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  dateField: {
    marginBottom: Spacing.sm,
  },
  dateLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
  },
  dateBtnText: {
    ...Typography.bodySmall,
    color: Colors.textPrimary,
  },
  dateDone: {
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  dateDoneText: {
    ...Typography.body,
    color: Colors.primary,
    fontWeight: '600',
  },
  genBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: 10,
    marginTop: Spacing.xs,
  },
  genBtnText: {
    ...Typography.bodySmall,
    color: Colors.dark,
    fontWeight: '600',
  },
})
