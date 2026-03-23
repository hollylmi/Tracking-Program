import { useState, useRef, useCallback } from 'react'
import {
  View, Text, FlatList, ScrollView, TouchableOpacity, StyleSheet,
  Modal, TextInput, ActivityIndicator, Alert, Platform,
  NativeSyntheticEvent, NativeScrollEvent, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import DateTimePicker from '@react-native-community/datetimepicker'
import ScreenHeader from '../../components/layout/ScreenHeader'
import EmptyState from '../../components/ui/EmptyState'
import AppInput from '../../components/ui/AppInput'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth'
import { RosterDay } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const CELL_W = 34
const CELL_H = 38
const NAME_W = 90
const HEADER_H = 44

// ─── Cell status config (matching web colours) ────────────────────────────────

const CELL_CFG: Record<string, { bg: string; text: string; abbrev: string }> = {
  assigned:  { bg: '#D0E8FF', text: '#1A4A8A', abbrev: '' },
  available: { bg: '#D4F5D4', text: '#1A5A1A', abbrev: '' },
  rdo:       { bg: '#FFE5C8', text: '#8A4000', abbrev: 'RDO' },
  leave:     { bg: '#FFF5C0', text: '#6B5000', abbrev: 'L' },
  annual:    { bg: '#FFF5C0', text: '#6B5000', abbrev: 'AL' },
  sick:      { bg: '#FFF5C0', text: '#6B5000', abbrev: 'SL' },
  personal:  { bg: '#FFF5C0', text: '#6B5000', abbrev: 'PL' },
  r_and_r:   { bg: '#EAD8FF', text: '#4A1A8A', abbrev: 'R&R' },
  travel:    { bg: '#C8F5EA', text: '#004A3A', abbrev: 'T' },
  sunday:    { bg: '#F0E8EC', text: '#B0909A', abbrev: '' },
  default:   { bg: '#F5F0F2', text: '#9A7A85', abbrev: '' },
}

const LEGEND_ITEMS = [
  { label: 'On site', bg: '#D0E8FF' },
  { label: 'Available', bg: '#D4F5D4' },
  { label: 'R&R', bg: '#EAD8FF' },
  { label: 'Travel', bg: '#C8F5EA' },
  { label: 'Leave', bg: '#FFF5C0' },
  { label: 'RDO', bg: '#FFE5C8' },
]

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.slice(0, 3).map(w => w[0].toUpperCase()).join('')
}

function parseLocalDate(ds: string) {
  const [y, m, d] = ds.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function getMonday(d: Date): string {
  const day = d.getDay()
  const diff = (day + 6) % 7
  const mon = new Date(d)
  mon.setDate(d.getDate() - diff)
  return mon.toISOString().split('T')[0]
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface GridEmployee { id: number; name: string; role: string }
interface GridCell {
  status: string
  label: string
  project_name: string
  override_id: number | null
  override_status: string
  project_id: number | null
}
interface GridProject { id: number; name: string }

// ─── Override Modal ───────────────────────────────────────────────────────────

const OVERRIDE_STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'project',   label: 'On Job →' },
  { value: 'r_and_r',  label: 'R&R' },
  { value: 'travel',   label: 'Travel' },
  { value: 'annual',   label: 'Annual Leave' },
  { value: 'sick',     label: 'Sick Leave' },
  { value: 'personal', label: 'Personal Leave' },
  { value: 'rdo',      label: 'RDO (manual)' },
  { value: 'other',    label: 'Other Leave' },
]

function OverrideModal({
  empId, empName, date: dateStr, cell, projects, onClose, onSaved,
}: {
  empId: number
  empName: string
  date: string
  cell: GridCell
  projects: GridProject[]
  onClose: () => void
  onSaved: () => void
}) {
  const initialStatus = cell.override_status || (cell.status === 'assigned' ? 'project' : cell.status === 'leave' ? 'annual' : cell.status) || 'available'
  const [status, setStatus] = useState(initialStatus)
  const [projectId, setProjectId] = useState<number | null>(cell.project_id)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const d = parseLocalDate(dateStr)
  const displayDate = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  const handleSave = async () => {
    if (status === 'project' && !projectId) {
      Alert.alert('Error', 'Select a project')
      return
    }
    setSaving(true)
    try {
      await api.scheduling.setOverride({
        employee_id: empId, date: dateStr, action: 'set',
        status, project_id: status === 'project' ? projectId : null, notes,
      })
      onSaved()
    } catch {
      Alert.alert('Error', 'Failed to save')
    } finally { setSaving(false) }
  }

  const handleClear = async () => {
    setSaving(true)
    try {
      await api.scheduling.setOverride({ employee_id: empId, date: dateStr, action: 'clear' })
      onSaved()
    } catch {
      Alert.alert('Error', 'Failed to clear')
    } finally { setSaving(false) }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={ms.overlay}>
        <View style={ms.sheet}>
          <View style={ms.header}>
            <View>
              <Text style={ms.title}>{empName}</Text>
              <Text style={ms.subtitle}>{displayDate}</Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={ms.fieldLabel}>Status</Text>
          <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {OVERRIDE_STATUS_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[ms.option, status === opt.value && ms.optionActive]}
                onPress={() => setStatus(opt.value)}
              >
                <Text style={[ms.optionText, status === opt.value && ms.optionTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {status === 'project' && (
            <>
              <Text style={[ms.fieldLabel, { marginTop: Spacing.sm }]}>Project</Text>
              <ScrollView style={{ maxHeight: 130 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                {projects.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[ms.option, projectId === p.id && ms.optionActive]}
                    onPress={() => setProjectId(p.id)}
                  >
                    <Text style={[ms.optionText, projectId === p.id && ms.optionTextActive]}>{p.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          <AppInput
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional notes"
            style={{ marginTop: Spacing.xs }}
          />

          <View style={ms.footer}>
            {cell.override_id ? (
              <TouchableOpacity style={ms.clearBtn} onPress={handleClear} disabled={saving}>
                <Text style={ms.clearBtnText}>Clear override</Text>
              </TouchableOpacity>
            ) : <View />}
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <TouchableOpacity style={ms.cancelBtn} onPress={onClose}>
                <Text style={ms.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={ms.saveBtn} onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator size="small" color={Colors.dark} />
                  : <Text style={ms.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ─── Assign Modal ─────────────────────────────────────────────────────────────

function AssignModal({
  employees, projects, onClose, onSaved,
}: {
  employees: GridEmployee[]
  projects: GridProject[]
  onClose: () => void
  onSaved: () => void
}) {
  const [empId, setEmpId] = useState<number | null>(null)
  const [projId, setProjId] = useState<number | null>(null)
  const [dateFrom, setDateFrom] = useState(new Date())
  const [dateTo, setDateTo] = useState<Date | null>(null)
  const [showFromPicker, setShowFromPicker] = useState(false)
  const [showToPicker, setShowToPicker] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!empId || !projId) { Alert.alert('Error', 'Select employee and project'); return }
    setSaving(true)
    try {
      await api.scheduling.addAssignment({
        employee_id: empId, project_id: projId,
        date_from: dateFrom.toISOString().split('T')[0],
        date_to: dateTo ? dateTo.toISOString().split('T')[0] : undefined,
        notes: notes || undefined,
      })
      onSaved()
    } catch { Alert.alert('Error', 'Failed to add assignment') }
    finally { setSaving(false) }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={ms.overlay}>
        <View style={[ms.sheet, { maxHeight: '90%' }]}>
          <View style={ms.header}>
            <Text style={ms.title}>Assign to Project</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={Colors.textSecondary} /></TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={ms.fieldLabel}>Employee</Text>
            <ScrollView style={{ maxHeight: 140 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {employees.map(emp => (
                <TouchableOpacity key={emp.id} style={[ms.option, empId === emp.id && ms.optionActive]} onPress={() => setEmpId(emp.id)}>
                  <Text style={[ms.optionText, empId === emp.id && ms.optionTextActive]}>{emp.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[ms.fieldLabel, { marginTop: Spacing.sm }]}>Project</Text>
            <ScrollView style={{ maxHeight: 140 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {projects.map(p => (
                <TouchableOpacity key={p.id} style={[ms.option, projId === p.id && ms.optionActive]} onPress={() => setProjId(p.id)}>
                  <Text style={[ms.optionText, projId === p.id && ms.optionTextActive]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[ms.fieldLabel, { marginTop: Spacing.sm }]}>From</Text>
            <TouchableOpacity style={ms.dateField} onPress={() => setShowFromPicker(true)}>
              <Ionicons name="calendar-outline" size={16} color={Colors.textSecondary} />
              <Text style={ms.dateFieldText}>{dateFrom.toLocaleDateString('en-AU')}</Text>
            </TouchableOpacity>
            {showFromPicker && (
              <DateTimePicker value={dateFrom} mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_, d) => { setShowFromPicker(false); if (d) setDateFrom(d) }} />
            )}

            <Text style={[ms.fieldLabel, { marginTop: Spacing.sm }]}>To (blank = ongoing)</Text>
            <TouchableOpacity style={ms.dateField} onPress={() => setShowToPicker(true)}>
              <Ionicons name="calendar-outline" size={16} color={Colors.textSecondary} />
              <Text style={ms.dateFieldText}>{dateTo ? dateTo.toLocaleDateString('en-AU') : 'Ongoing'}</Text>
            </TouchableOpacity>
            {dateTo && (
              <TouchableOpacity onPress={() => setDateTo(null)} style={{ marginTop: 4 }}>
                <Text style={{ color: Colors.error, ...Typography.caption }}>Clear end date</Text>
              </TouchableOpacity>
            )}
            {showToPicker && (
              <DateTimePicker value={dateTo ?? dateFrom} mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_, d) => { setShowToPicker(false); if (d) setDateTo(d) }} />
            )}

            <AppInput
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional notes"
            />
          </ScrollView>

          <View style={[ms.footer, { justifyContent: 'flex-end' }]}>
            <TouchableOpacity style={ms.cancelBtn} onPress={onClose}><Text style={ms.cancelBtnText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={ms.saveBtn} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color={Colors.dark} /> : <Text style={ms.saveBtnText}>Add Assignment</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ─── Leave Modal ──────────────────────────────────────────────────────────────

const LEAVE_TYPES = [
  { value: 'r_and_r',  label: 'R&R (Rest & Relaxation)' },
  { value: 'travel',   label: 'Travel Day' },
  { value: 'annual',   label: 'Annual Leave' },
  { value: 'sick',     label: 'Sick Leave' },
  { value: 'personal', label: 'Personal' },
  { value: 'other',    label: 'Other' },
]

function LeaveModal({
  employees, onClose, onSaved,
}: {
  employees: GridEmployee[]
  onClose: () => void
  onSaved: () => void
}) {
  const [empId, setEmpId] = useState<number | null>(null)
  const [dateFrom, setDateFrom] = useState(new Date())
  const [dateTo, setDateTo] = useState(new Date())
  const [leaveType, setLeaveType] = useState('r_and_r')
  const [showFromPicker, setShowFromPicker] = useState(false)
  const [showToPicker, setShowToPicker] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!empId) { Alert.alert('Error', 'Select an employee'); return }
    setSaving(true)
    try {
      await api.scheduling.addLeave({
        employee_id: empId,
        date_from: dateFrom.toISOString().split('T')[0],
        date_to: dateTo.toISOString().split('T')[0],
        leave_type: leaveType,
        notes: notes || undefined,
      })
      onSaved()
    } catch { Alert.alert('Error', 'Failed to record leave') }
    finally { setSaving(false) }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={ms.overlay}>
        <View style={[ms.sheet, { maxHeight: '90%' }]}>
          <View style={ms.header}>
            <Text style={ms.title}>Record Leave / R&R</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={Colors.textSecondary} /></TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={ms.fieldLabel}>Employee</Text>
            <ScrollView style={{ maxHeight: 140 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {employees.map(emp => (
                <TouchableOpacity key={emp.id} style={[ms.option, empId === emp.id && ms.optionActive]} onPress={() => setEmpId(emp.id)}>
                  <Text style={[ms.optionText, empId === emp.id && ms.optionTextActive]}>{emp.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[ms.fieldLabel, { marginTop: Spacing.sm }]}>From</Text>
            <TouchableOpacity style={ms.dateField} onPress={() => setShowFromPicker(true)}>
              <Ionicons name="calendar-outline" size={16} color={Colors.textSecondary} />
              <Text style={ms.dateFieldText}>{dateFrom.toLocaleDateString('en-AU')}</Text>
            </TouchableOpacity>
            {showFromPicker && (
              <DateTimePicker value={dateFrom} mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_, d) => { setShowFromPicker(false); if (d) setDateFrom(d) }} />
            )}

            <Text style={[ms.fieldLabel, { marginTop: Spacing.sm }]}>To</Text>
            <TouchableOpacity style={ms.dateField} onPress={() => setShowToPicker(true)}>
              <Ionicons name="calendar-outline" size={16} color={Colors.textSecondary} />
              <Text style={ms.dateFieldText}>{dateTo.toLocaleDateString('en-AU')}</Text>
            </TouchableOpacity>
            {showToPicker && (
              <DateTimePicker value={dateTo} mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_, d) => { setShowToPicker(false); if (d) setDateTo(d) }} />
            )}

            <Text style={[ms.fieldLabel, { marginTop: Spacing.sm }]}>Type</Text>
            {LEAVE_TYPES.map(lt => (
              <TouchableOpacity key={lt.value} style={[ms.option, leaveType === lt.value && ms.optionActive]} onPress={() => setLeaveType(lt.value)}>
                <Text style={[ms.optionText, leaveType === lt.value && ms.optionTextActive]}>{lt.label}</Text>
              </TouchableOpacity>
            ))}

            <AppInput
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional notes"
            />
          </ScrollView>

          <View style={[ms.footer, { justifyContent: 'flex-end' }]}>
            <TouchableOpacity style={ms.cancelBtn} onPress={onClose}><Text style={ms.cancelBtnText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={ms.saveBtn} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color={Colors.dark} /> : <Text style={ms.saveBtnText}>Record</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ─── Scheduling Grid ──────────────────────────────────────────────────────────

function SchedulingGrid({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const today = new Date().toISOString().split('T')[0]

  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [overrideTarget, setOverrideTarget] = useState<{ empId: number; empName: string; date: string; cell: GridCell } | null>(null)
  const [showAssign, setShowAssign] = useState(false)
  const [showLeave, setShowLeave] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Horizontal scroll sync
  const headerRef = useRef<ScrollView>(null)
  const rowScrollRefs = useRef<Map<number, ScrollView>>(new Map())
  const scrollXRef = useRef(0)
  const syncingRef = useRef(false)

  const syncHorizScroll = useCallback((x: number, sourceEmpId?: number) => {
    if (syncingRef.current) return
    syncingRef.current = true
    scrollXRef.current = x
    headerRef.current?.scrollTo({ x, animated: false })
    rowScrollRefs.current.forEach((ref, id) => {
      if (id !== sourceEmpId) ref.scrollTo({ x, animated: false })
    })
    requestAnimationFrame(() => { syncingRef.current = false })
  }, [])

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['roster', 'team', weekStart],
    queryFn: () => api.scheduling.grid(weekStart).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  const goBack = () => {
    const d = parseLocalDate(weekStart)
    d.setDate(d.getDate() - 28)
    setWeekStart(d.toISOString().split('T')[0])
  }
  const goForward = () => {
    const d = parseLocalDate(weekStart)
    d.setDate(d.getDate() + 28)
    setWeekStart(d.toISOString().split('T')[0])
  }
  const goToday = () => setWeekStart(getMonday(new Date()))

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['roster', 'team'] })

  if (isLoading) {
    return (
      <View style={styles.loadingBody}>
        {[0, 1, 2, 3, 4].map(i => <View key={i} style={[styles.skeleton, { opacity: 1 - i * 0.15 }]} />)}
      </View>
    )
  }

  if (isError) {
    return (
      <View style={styles.errorBody}>
        <Text style={styles.errorText}>Could not load roster.</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const employees = data?.employees ?? []
  const dates = data?.dates ?? []
  const grid = data?.grid ?? {}
  const projects = data?.projects ?? []

  // Build date label for nav bar
  const startD = parseLocalDate(weekStart)
  const endD = dates.length > 0 ? parseLocalDate(dates[dates.length - 1]) : startD
  const rangeLabel = `${startD.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })} – ${endD.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}`

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Navigation */}
      <View style={styles.navBar}>
        <TouchableOpacity style={styles.navArrow} onPress={goBack}>
          <Ionicons name="chevron-back" size={18} color={Colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={goToday} style={styles.navCenter}>
          <Text style={styles.navRangeText}>{rangeLabel}</Text>
          <Text style={styles.navTodayHint}>tap for today</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navArrow} onPress={goForward}>
          <Ionicons name="chevron-forward" size={18} color={Colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {employees.length === 0 ? (
        <EmptyState icon="👥" title="No team roster" subtitle="No employees found for your accessible projects" />
      ) : (
        <>
          {/* Grid */}
          <View style={{ flex: 1 }}>
            {/* Header row: corner + date labels */}
            <View style={{ flexDirection: 'row', height: HEADER_H, borderBottomWidth: 1, borderColor: Colors.border }}>
              {/* Corner */}
              <View style={[styles.corner, { width: NAME_W }]}>
                <Text style={styles.cornerText}>Employee</Text>
              </View>
              {/* Date headers — synced with row scrolls */}
              <View style={{ flex: 1, overflow: 'hidden' }}>
                <ScrollView
                  ref={headerRef}
                  horizontal
                  scrollEnabled={false}
                  showsHorizontalScrollIndicator={false}
                  style={{ flex: 1 }}
                >
                  <View style={{ flexDirection: 'row' }}>
                    {dates.map(ds => {
                      const d = parseLocalDate(ds)
                      const isToday = ds === today
                      const isSun = d.getDay() === 0
                      const isMon = d.getDay() === 1
                      return (
                        <View
                          key={ds}
                          style={[
                            styles.dateHeader,
                            { width: CELL_W },
                            isToday && styles.dateHeaderToday,
                            isMon && styles.dateHeaderMonday,
                          ]}
                        >
                          <Text style={[styles.dateDay, isSun && styles.dateSun, isToday && styles.dateTodayText]}>
                            {d.toLocaleDateString('en-AU', { weekday: 'narrow' })}
                          </Text>
                          <Text style={[styles.dateNum, isSun && styles.dateSun, isToday && styles.dateTodayText]}>
                            {d.getDate()}
                          </Text>
                        </View>
                      )
                    })}
                  </View>
                </ScrollView>
              </View>
            </View>

            {/* Employee rows */}
            <FlatList
              data={employees}
              keyExtractor={emp => String(emp.id)}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
              renderItem={({ item: emp, index }) => {
                const empGrid = grid[String(emp.id)] ?? {}
                const rowBg = index % 2 === 1 ? Colors.surface : Colors.background
                return (
                  <View style={{ flexDirection: 'row', height: CELL_H, backgroundColor: rowBg, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Colors.border }}>
                    {/* Sticky name cell */}
                    <View style={[styles.nameCell, { width: NAME_W, backgroundColor: rowBg }]}>
                      <Text style={styles.nameCellText} numberOfLines={1}>{emp.name}</Text>
                      {emp.role ? <Text style={styles.nameRoleText} numberOfLines={1}>{emp.role}</Text> : null}
                    </View>

                    {/* Horizontal date cells */}
                    <ScrollView
                      ref={r => { if (r) rowScrollRefs.current.set(emp.id, r) }}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      scrollEventThrottle={16}
                      onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) =>
                        syncHorizScroll(e.nativeEvent.contentOffset.x, emp.id)
                      }
                      style={{ flex: 1 }}
                    >
                      <View style={{ flexDirection: 'row' }}>
                        {dates.map(ds => {
                          const cell: GridCell = empGrid[ds] ?? {
                            status: 'available', label: '', project_name: '', override_id: null, override_status: '', project_id: null,
                          }
                          const d = parseLocalDate(ds)
                          const isSun = d.getDay() === 0
                          const isMon = d.getDay() === 1
                          const isToday = ds === today
                          const cfgKey = isSun ? 'sunday' : cell.status
                          const cfg = CELL_CFG[cfgKey] ?? CELL_CFG.default
                          const abbrev = isSun ? '' : (cell.status === 'assigned' && cell.project_name ? getInitials(cell.project_name) : cfg.abbrev)

                          return (
                            <TouchableOpacity
                              key={ds}
                              style={[
                                styles.cell,
                                { width: CELL_W, height: CELL_H, backgroundColor: cfg.bg },
                                isToday && styles.cellToday,
                                isMon && styles.cellMonday,
                                isSun && styles.cellSunday,
                              ]}
                              onPress={() => {
                                if (!isSun && isAdmin) {
                                  setOverrideTarget({ empId: emp.id, empName: emp.name, date: ds, cell })
                                }
                              }}
                              activeOpacity={isAdmin && !isSun ? 0.65 : 1}
                            >
                              <Text style={[styles.cellText, { color: cfg.text }]} numberOfLines={1}>
                                {abbrev}
                              </Text>
                              {cell.override_id ? <View style={styles.overrideDot} /> : null}
                            </TouchableOpacity>
                          )
                        })}
                      </View>
                    </ScrollView>
                  </View>
                )
              }}
            />
          </View>

          {/* Legend */}
          <View style={styles.legend}>
            {LEGEND_ITEMS.map(item => (
              <View key={item.label} style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: item.bg }]} />
                <Text style={styles.legendLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          {/* Admin action buttons */}
          {isAdmin && (
            <View style={styles.adminBar}>
              <TouchableOpacity style={styles.adminBtn} onPress={() => setShowAssign(true)}>
                <Ionicons name="person-add-outline" size={14} color={Colors.dark} />
                <Text style={styles.adminBtnText}>Assign to Project</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.adminBtn, { backgroundColor: '#fff3cd' }]} onPress={() => setShowLeave(true)}>
                <Ionicons name="calendar-outline" size={14} color='#664d03' />
                <Text style={[styles.adminBtnText, { color: '#664d03' }]}>Record Leave</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {overrideTarget && (
        <OverrideModal
          empId={overrideTarget.empId}
          empName={overrideTarget.empName}
          date={overrideTarget.date}
          cell={overrideTarget.cell}
          projects={projects}
          onClose={() => setOverrideTarget(null)}
          onSaved={() => { setOverrideTarget(null); invalidate() }}
        />
      )}
      {showAssign && (
        <AssignModal
          employees={employees}
          projects={projects}
          onClose={() => setShowAssign(false)}
          onSaved={() => { setShowAssign(false); invalidate() }}
        />
      )}
      {showLeave && (
        <LeaveModal
          employees={employees}
          onClose={() => setShowLeave(false)}
          onSaved={() => { setShowLeave(false); invalidate() }}
        />
      )}
    </View>
  )
}

// ─── Personal Roster ──────────────────────────────────────────────────────────

const PERSONAL_STATUS_CFG: Record<string, { bg: string; text: string; dot: string }> = {
  assigned:  { bg: 'rgba(76,175,80,0.18)',   text: '#90EE90', dot: Colors.success },
  site:      { bg: 'rgba(76,175,80,0.18)',   text: '#90EE90', dot: Colors.success },
  travel:    { bg: 'rgba(126,87,194,0.18)',  text: '#C8A8FF', dot: '#7E57C2' },
  leave:     { bg: 'rgba(255,152,0,0.18)',   text: '#FFD966', dot: Colors.warning },
  annual:    { bg: 'rgba(255,152,0,0.18)',   text: '#FFD966', dot: Colors.warning },
  sick:      { bg: 'rgba(255,152,0,0.18)',   text: '#FFD966', dot: Colors.warning },
  personal:  { bg: 'rgba(255,152,0,0.18)',   text: '#FFD966', dot: Colors.warning },
  r_and_r:   { bg: 'rgba(126,87,194,0.18)',  text: '#C8A8FF', dot: '#7E57C2' },
  rdo:       { bg: 'rgba(33,150,243,0.18)',  text: '#90CAFF', dot: '#2196F3' },
  swing_off: { bg: Colors.surface, text: Colors.textSecondary, dot: Colors.textLight },
  available: { bg: Colors.surface, text: Colors.textSecondary, dot: Colors.textLight },
  off:       { bg: Colors.surface, text: Colors.textSecondary, dot: Colors.textLight },
  default:   { bg: Colors.surface, text: Colors.textSecondary, dot: Colors.textLight },
}

function getPersonalStatusCfg(status: string) {
  return PERSONAL_STATUS_CFG[status?.toLowerCase()] ?? PERSONAL_STATUS_CFG.default
}

function RosterDayRow({ day }: { day: RosterDay }) {
  const d = parseLocalDate(day.date)
  const weekday = d.toLocaleDateString('en-AU', { weekday: 'short' })
  const dayNum = d.getDate()
  const cfg = getPersonalStatusCfg(day.status)
  const isToday = day.date === new Date().toISOString().split('T')[0]

  return (
    <View style={[styles.dayRow, isToday && styles.dayRowToday]}>
      <View style={[styles.dateCol, isToday && styles.dateColToday]}>
        <Text style={[styles.weekday, isToday && styles.weekdayToday]}>{weekday}</Text>
        <Text style={[styles.dayNum, isToday && styles.dayNumToday]}>{dayNum}</Text>
      </View>
      <View style={[styles.statusPill, { backgroundColor: cfg.bg }]}>
        <View style={[styles.statusDot, { backgroundColor: cfg.dot }]} />
        <Text style={[styles.statusText, { color: cfg.text }]}>{day.label || day.status}</Text>
      </View>
      {day.project_name ? (
        <Text style={styles.projectName} numberOfLines={1}>{day.project_name}</Text>
      ) : <View style={{ flex: 1 }} />}
    </View>
  )
}

function groupByMonth(days: RosterDay[]): { title: string; data: RosterDay[] }[] {
  const map = new Map<string, RosterDay[]>()
  for (const day of days) {
    const d = parseLocalDate(day.date)
    const key = d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(day)
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }))
}

function MonthSection({ title, days }: { title: string; days: RosterDay[] }) {
  const siteCount = days.filter(d => d.status === 'assigned' || d.status === 'site').length
  return (
    <View style={styles.section}>
      <View style={styles.monthHeader}>
        <Text style={styles.monthTitle}>{title}</Text>
        {siteCount > 0 && <Text style={styles.monthMeta}>{siteCount} site day{siteCount > 1 ? 's' : ''}</Text>}
      </View>
      <View style={styles.sectionCard}>
        {days.map((day, idx) => (
          <View key={day.date}>
            <RosterDayRow day={day} />
            {idx < days.length - 1 && <View style={styles.divider} />}
          </View>
        ))}
      </View>
    </View>
  )
}

function PersonalRoster() {
  const [refreshing, setRefreshing] = useState(false)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['roster', 'my'],
    queryFn: () => api.roster.my().then(r => r.data),
    staleTime: 10 * 60 * 1000,
  })

  const handleRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false) }

  if (isLoading) {
    return (
      <View style={styles.loadingBody}>
        {[0, 1, 2, 3, 4].map(i => <View key={i} style={[styles.skeleton, { opacity: 1 - i * 0.15 }]} />)}
      </View>
    )
  }
  if (isError) {
    return (
      <View style={styles.errorBody}>
        <Text style={styles.errorText}>Could not load roster.</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }
  if (data?.no_employee || !data?.employee) {
    return <EmptyState icon="👤" title="Account not linked" subtitle="Your account isn't linked to an employee record. Contact your admin." />
  }

  const groups = groupByMonth(data.schedule)
  return (
    <FlatList
      data={groups}
      keyExtractor={g => g.title}
      renderItem={({ item }) => <MonthSection title={item.title} days={item.data} />}
      contentContainerStyle={[styles.list, groups.length === 0 && styles.listEmpty]}
      ListHeaderComponent={
        <View style={styles.employeeHeader}>
          <Ionicons name="person-circle-outline" size={18} color={Colors.textSecondary} />
          <Text style={styles.employeeHeaderText}>{data.employee.name}</Text>
        </View>
      }
      ListEmptyComponent={<EmptyState icon="📅" title="No roster data" subtitle="Your roster hasn't been set up yet" />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
      showsVerticalScrollIndicator={false}
    />
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RosterScreen() {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const isSupervisor = user?.role === 'supervisor'
  const canSeeTeam = isAdmin || isSupervisor

  const [tab, setTab] = useState<'my' | 'team'>(isAdmin ? 'team' : 'my')

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="Roster" />

      {canSeeTeam && (
        <View style={styles.tabBar}>
          {isSupervisor && (
            <TouchableOpacity
              style={[styles.tab, tab === 'my' && styles.tabActive]}
              onPress={() => setTab('my')}
              activeOpacity={0.8}
            >
              <Ionicons name="person-outline" size={14} color={tab === 'my' ? Colors.dark : Colors.textSecondary} />
              <Text style={[styles.tabText, tab === 'my' && styles.tabTextActive]}>My Roster</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.tab, tab === 'team' && styles.tabActive]}
            onPress={() => setTab('team')}
            activeOpacity={0.8}
          >
            <Ionicons name="people-outline" size={14} color={tab === 'team' ? Colors.dark : Colors.textSecondary} />
            <Text style={[styles.tabText, tab === 'team' && styles.tabTextActive]}>Team</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        {tab === 'my' ? <PersonalRoster /> : <SchedulingGrid isAdmin={isAdmin} />}
      </View>
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.dark,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full, borderWidth: 1, borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { ...Typography.label, color: Colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: Colors.dark },

  // Navigation bar
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderColor: Colors.border,
  },
  navArrow: { padding: Spacing.xs + 2 },
  navCenter: { alignItems: 'center', flex: 1 },
  navRangeText: { ...Typography.bodySmall, color: Colors.textPrimary, fontWeight: '600' },
  navTodayHint: { ...Typography.caption, color: Colors.textLight },

  // Grid
  corner: {
    height: HEADER_H,
    backgroundColor: Colors.surface,
    borderRightWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  cornerText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600' },

  dateHeader: {
    width: CELL_W, height: HEADER_H,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderRightWidth: StyleSheet.hairlineWidth, borderColor: Colors.border,
  },
  dateHeaderToday: { backgroundColor: 'rgba(255,183,197,0.2)' },
  dateHeaderMonday: { borderLeftWidth: 2, borderLeftColor: Colors.border },
  dateDay: { ...Typography.caption, color: Colors.textSecondary },
  dateSun: { color: '#FF6B6B' },
  dateNum: { ...Typography.label, color: Colors.textPrimary, fontWeight: '700' },
  dateTodayText: { color: Colors.primary, fontWeight: '700' },

  nameCell: {
    justifyContent: 'center', paddingHorizontal: Spacing.xs + 2,
    borderRightWidth: 1, borderColor: Colors.border,
  },
  nameCellText: { ...Typography.caption, color: Colors.textPrimary, fontWeight: '600' },
  nameRoleText: { ...Typography.caption, color: Colors.textLight, fontSize: 9 },

  cell: {
    width: CELL_W, height: CELL_H,
    alignItems: 'center', justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.06)',
  },
  cellToday: { borderWidth: 1.5, borderColor: Colors.primary },
  cellMonday: { borderLeftWidth: 2, borderLeftColor: Colors.border },
  cellSunday: { opacity: 0.5 },
  cellText: { ...Typography.caption, fontWeight: '700', fontSize: 9 },
  overrideDot: {
    position: 'absolute', top: 3, right: 3,
    width: 4, height: 4, borderRadius: 2, backgroundColor: '#dc3545',
  },

  // Legend
  legend: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: Spacing.xs, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
    backgroundColor: Colors.surface, borderTopWidth: 1, borderColor: Colors.border,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  legendLabel: { ...Typography.caption, color: Colors.textSecondary, fontSize: 9 },

  // Admin bar
  adminBar: {
    flexDirection: 'row', gap: Spacing.sm,
    padding: Spacing.sm,
    backgroundColor: Colors.background, borderTopWidth: 1, borderColor: Colors.border,
  },
  adminBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.xs + 2, borderRadius: BorderRadius.sm,
  },
  adminBtnText: { ...Typography.label, color: Colors.dark, fontWeight: '600' },

  // Personal roster
  list: { padding: Spacing.md, gap: Spacing.md, backgroundColor: Colors.background },
  listEmpty: { flexGrow: 1, backgroundColor: Colors.background },
  employeeHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  employeeHeaderText: { ...Typography.bodySmall, color: Colors.textSecondary, fontWeight: '600' },
  section: { gap: Spacing.sm },
  sectionCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthTitle: { ...Typography.h4, color: Colors.textPrimary },
  monthMeta: { ...Typography.caption, color: Colors.textSecondary },
  dayRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm,
  },
  dayRowToday: { backgroundColor: Colors.primary + '18' },
  dateCol: { width: 36, alignItems: 'center' },
  dateColToday: {},
  weekday: { ...Typography.caption, color: Colors.textSecondary, textTransform: 'uppercase' },
  weekdayToday: { color: Colors.primary, fontWeight: '700' },
  dayNum: { ...Typography.h4, color: Colors.textPrimary, lineHeight: 20 },
  dayNumToday: { color: Colors.primary },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: BorderRadius.full, minWidth: 90,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { ...Typography.label, fontWeight: '600', textTransform: 'capitalize' },
  projectName: { ...Typography.bodySmall, color: Colors.textSecondary, flex: 1, textAlign: 'right' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginHorizontal: Spacing.md },

  // Loading/error
  loadingBody: { flex: 1, backgroundColor: Colors.background, padding: Spacing.md, gap: Spacing.sm },
  skeleton: { height: 52, backgroundColor: Colors.surface, borderRadius: BorderRadius.md },
  errorBody: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  errorText: { ...Typography.body, color: Colors.textSecondary },
  retryBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText: { ...Typography.body, color: Colors.dark, fontWeight: '600' },
})

// ─── Modal Styles ─────────────────────────────────────────────────────────────

const ms = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: BorderRadius.lg, borderTopRightRadius: BorderRadius.lg,
    padding: Spacing.md,
    paddingBottom: Spacing.xl,
    maxHeight: '80%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
  title: { ...Typography.h4, color: Colors.textPrimary },
  subtitle: { ...Typography.bodySmall, color: Colors.textSecondary, marginTop: 2 },
  fieldLabel: { ...Typography.label, color: Colors.textSecondary, fontWeight: '600', marginBottom: 4 },
  option: {
    paddingVertical: Spacing.xs + 2, paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm, marginBottom: 3,
    backgroundColor: Colors.surface,
  },
  optionActive: { backgroundColor: Colors.primary },
  optionText: { ...Typography.bodySmall, color: Colors.textPrimary },
  optionTextActive: { color: Colors.dark, fontWeight: '600' },
  notesInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm,
    padding: Spacing.sm, ...Typography.bodySmall, color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  dateField: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm,
    padding: Spacing.sm, backgroundColor: Colors.surface,
  },
  dateFieldText: { ...Typography.bodySmall, color: Colors.textPrimary },
  footer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    gap: Spacing.sm, marginTop: Spacing.md,
  },
  clearBtn: { paddingVertical: Spacing.xs + 2, paddingHorizontal: Spacing.sm, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.error },
  clearBtnText: { ...Typography.label, color: Colors.error, fontWeight: '600' },
  cancelBtn: { paddingVertical: Spacing.xs + 2, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border },
  cancelBtnText: { ...Typography.label, color: Colors.textSecondary, fontWeight: '600' },
  saveBtn: { paddingVertical: Spacing.xs + 2, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.sm, backgroundColor: Colors.primary },
  saveBtnText: { ...Typography.label, color: Colors.dark, fontWeight: '700' },
})
