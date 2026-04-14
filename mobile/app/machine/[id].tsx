import { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Alert,
  RefreshControl,
  Platform,
  Image,
  Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as ImagePicker from 'expo-image-picker'
import Card from '../../components/ui/Card'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { API_BASE_URL } from '../../constants/api'
import { api } from '../../lib/api'
import { cachedQuery } from '../../lib/cachedQuery'
import { compressImage } from '../../lib/compressImage'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { useToastStore } from '../../store/toast'
import { BreakdownDetail, MachineDetail, DailyCheckRecord } from '../../types'

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Resolved',
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:     { bg: '#FFF3E0', text: Colors.warning },
  in_progress: { bg: '#E3F2FD', text: '#1565C0' },
  completed:   { bg: '#E8F5E9', text: Colors.success },
}

function formatDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Edit Machine Modal ───────────────────────────────────────────────────────

function EditMachineModal({
  machine,
  visible,
  onClose,
  onSaved,
}: {
  machine: MachineDetail
  visible: boolean
  onClose: () => void
  onSaved: (updated: MachineDetail) => void
}) {
  const { show } = useToastStore()
  const [name, setName] = useState(machine.name)
  const [plantId, setPlantId] = useState(machine.plant_id ?? '')
  const [type, setType] = useState(machine.type ?? '')
  const [description, setDescription] = useState(machine.description ?? '')
  const [delayRate, setDelayRate] = useState(machine.delay_rate != null ? String(machine.delay_rate) : '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) {
      show('Name is required', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await api.equipment.update(machine.id, {
        name: name.trim(),
        plant_id: plantId.trim() || null,
        type: type.trim() || null,
        description: description.trim() || null,
        delay_rate: delayRate ? Number(delayRate) : null,
      } as any)
      onSaved({ ...machine, ...res.data })
      show('Machine updated', 'success')
      onClose()
    } catch {
      show('Failed to save changes', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modal.root} edges={['top', 'bottom']}>
        <View style={modal.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={modal.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={modal.title}>Edit Machine</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            {saving
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <Text style={modal.save}>Save</Text>
            }
          </TouchableOpacity>
        </View>

        <ScrollView style={modal.body} contentContainerStyle={modal.bodyContent} keyboardShouldPersistTaps="handled">
          {[
            { label: 'Name *', value: name, onChange: setName, placeholder: 'Machine name' },
            { label: 'Plant ID', value: plantId, onChange: setPlantId, placeholder: 'Fleet / inventory ID' },
            { label: 'Type', value: type, onChange: setType, placeholder: 'e.g. Excavator' },
            { label: 'Delay Rate ($/hr)', value: delayRate, onChange: setDelayRate, placeholder: '0.00', keyboardType: 'decimal-pad' as any },
          ].map(f => (
            <View key={f.label} style={modal.field}>
              <Text style={modal.label}>{f.label}</Text>
              <TextInput
                style={modal.input}
                value={f.value}
                onChangeText={f.onChange}
                placeholder={f.placeholder}
                placeholderTextColor={Colors.textLight}
                keyboardType={f.keyboardType}
              />
            </View>
          ))}
          <View style={modal.field}>
            <Text style={modal.label}>Description</Text>
            <TextInput
              style={[modal.input, modal.textarea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Additional notes about this machine"
              placeholderTextColor={Colors.textLight}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

// ─── Edit Breakdown Modal ─────────────────────────────────────────────────────

function EditBreakdownModal({
  breakdown,
  visible,
  onClose,
  onSaved,
}: {
  breakdown: BreakdownDetail
  visible: boolean
  onClose: () => void
  onSaved: (updated: BreakdownDetail) => void
}) {
  const { show } = useToastStore()
  const [status, setStatus] = useState<BreakdownDetail['repair_status']>(breakdown.repair_status)
  const [repairingBy, setRepairingBy] = useState(breakdown.repairing_by ?? '')
  const [anticipatedReturn, setAnticipatedReturn] = useState(breakdown.anticipated_return ?? '')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await api.equipment.updateBreakdown(breakdown.id, {
        repair_status: status,
        repairing_by: repairingBy.trim() || null,
        anticipated_return: anticipatedReturn || null,
      } as any)
      onSaved(res.data)
      show('Breakdown updated', 'success')
      onClose()
    } catch {
      show('Failed to save changes', 'error')
    } finally {
      setSaving(false)
    }
  }

  const statuses: BreakdownDetail['repair_status'][] = ['pending', 'in_progress', 'completed']

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modal.root} edges={['top', 'bottom']}>
        <View style={modal.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={modal.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={modal.title}>Update Breakdown</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            {saving
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <Text style={modal.save}>Save</Text>
            }
          </TouchableOpacity>
        </View>

        <ScrollView style={modal.body} contentContainerStyle={modal.bodyContent} keyboardShouldPersistTaps="handled">
          {/* Reported date (read-only) */}
          <View style={modal.field}>
            <Text style={modal.label}>Reported Date</Text>
            <Text style={modal.readOnly}>{formatDate(breakdown.date)}</Text>
          </View>

          {/* Description (read-only) */}
          <View style={modal.field}>
            <Text style={modal.label}>Description</Text>
            <Text style={modal.readOnly}>{breakdown.description}</Text>
          </View>

          {/* Status selector */}
          <View style={modal.field}>
            <Text style={modal.label}>Status</Text>
            <View style={modal.statusRow}>
              {statuses.map(s => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setStatus(s)}
                  style={[modal.statusBtn, status === s && modal.statusBtnActive]}
                  activeOpacity={0.8}
                >
                  <Text style={[modal.statusBtnText, status === s && modal.statusBtnTextActive]}>
                    {STATUS_LABELS[s]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Repairing by */}
          <View style={modal.field}>
            <Text style={modal.label}>Repairing By</Text>
            <TextInput
              style={modal.input}
              value={repairingBy}
              onChangeText={setRepairingBy}
              placeholder="Workshop or technician name"
              placeholderTextColor={Colors.textLight}
            />
          </View>

          {/* Anticipated return */}
          <View style={modal.field}>
            <Text style={modal.label}>Anticipated Return</Text>
            <TouchableOpacity
              style={modal.dateBtn}
              onPress={() => setShowDatePicker(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="calendar-outline" size={16} color={Colors.textSecondary} />
              <Text style={[modal.input, { flex: 1, borderWidth: 0, backgroundColor: 'transparent', padding: 0 }]}>
                {anticipatedReturn ? formatDate(anticipatedReturn) : 'Not set'}
              </Text>
              {anticipatedReturn ? (
                <TouchableOpacity onPress={() => setAnticipatedReturn('')}>
                  <Ionicons name="close-circle" size={16} color={Colors.textLight} />
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={anticipatedReturn ? new Date(anticipatedReturn + 'T00:00:00') : new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_, d) => {
                  setShowDatePicker(Platform.OS === 'ios')
                  if (d) setAnticipatedReturn(toDateStr(d))
                }}
              />
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

// ─── Breakdown Detail Modal ───────────────────────────────────────────────────

function BreakdownDetailModal({
  breakdown,
  machineName,
  visible,
  canEdit,
  onClose,
  onEdit,
  onDelete,
}: {
  breakdown: BreakdownDetail
  machineName: string
  visible: boolean
  canEdit: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const cfg = STATUS_COLORS[breakdown.repair_status] ?? STATUS_COLORS.pending

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modal.root} edges={['top', 'bottom']}>
        <View style={modal.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={modal.cancel}>Close</Text>
          </TouchableOpacity>
          <Text style={modal.title}>Breakdown Report</Text>
          <View style={{ width: 50 }} />
        </View>

        <ScrollView style={modal.body} contentContainerStyle={modal.bodyContent} showsVerticalScrollIndicator={false}>
          {/* Status pill */}
          <View style={[modal.statusBanner, { backgroundColor: cfg.bg }]}>
            <View style={[modal.statusDot, { backgroundColor: cfg.text }]} />
            <Text style={[modal.statusBannerText, { color: cfg.text }]}>
              {STATUS_LABELS[breakdown.repair_status]}
            </Text>
          </View>

          {/* Detail rows */}
          <View style={modal.detailCard}>
            <View style={modal.detailRow}>
              <Text style={modal.detailLabel}>Machine</Text>
              <Text style={modal.detailValue}>{machineName}</Text>
            </View>
            <View style={modal.detailDivider} />
            <View style={modal.detailRow}>
              <Text style={modal.detailLabel}>Date</Text>
              <Text style={modal.detailValue}>
                {formatDate(breakdown.date)}
                {breakdown.incident_time ? ` at ${breakdown.incident_time}` : ''}
              </Text>
            </View>
            {breakdown.description ? (
              <>
                <View style={modal.detailDivider} />
                <View style={[modal.detailRow, { alignItems: 'flex-start' }]}>
                  <Text style={modal.detailLabel}>Description</Text>
                  <Text style={[modal.detailValue, { flex: 1 }]}>{breakdown.description}</Text>
                </View>
              </>
            ) : null}
            {breakdown.repairing_by ? (
              <>
                <View style={modal.detailDivider} />
                <View style={modal.detailRow}>
                  <Text style={modal.detailLabel}>Repairing By</Text>
                  <Text style={modal.detailValue}>{breakdown.repairing_by}</Text>
                </View>
              </>
            ) : null}
            {breakdown.anticipated_return && breakdown.repair_status !== 'completed' ? (
              <>
                <View style={modal.detailDivider} />
                <View style={modal.detailRow}>
                  <Text style={modal.detailLabel}>Est. Return</Text>
                  <Text style={modal.detailValue}>{formatDate(breakdown.anticipated_return)}</Text>
                </View>
              </>
            ) : null}
            {breakdown.resolved_date ? (
              <>
                <View style={modal.detailDivider} />
                <View style={modal.detailRow}>
                  <Text style={modal.detailLabel}>Resolved</Text>
                  <Text style={[modal.detailValue, { color: Colors.success }]}>
                    {formatDate(breakdown.resolved_date)}
                  </Text>
                </View>
              </>
            ) : null}
          </View>

          {/* Photos */}
          {(breakdown.photos ?? []).length > 0 && (
            <View style={modal.section}>
              <Text style={modal.sectionTitle}>Photos ({(breakdown.photos ?? []).length})</Text>
              <View style={modal.photoGrid}>
                {(breakdown.photos ?? []).map(p => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => Linking.openURL(p.url)}
                    activeOpacity={0.85}
                  >
                    <Image
                      source={{ uri: p.url }}
                      style={modal.photo}
                      resizeMode="cover"
                    />
                    <View style={modal.photoOverlay}>
                      <Ionicons name="expand-outline" size={16} color="#fff" />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Actions for admin/supervisor */}
          {canEdit && (
            <View style={modal.actions}>
              <TouchableOpacity style={modal.editBtn} onPress={onEdit} activeOpacity={0.85}>
                <Ionicons name="pencil-outline" size={16} color={Colors.dark} />
                <Text style={modal.editBtnText}>Edit Breakdown</Text>
              </TouchableOpacity>
              <TouchableOpacity style={modal.deleteBtn} onPress={onDelete} activeOpacity={0.85}>
                <Ionicons name="trash-outline" size={16} color={Colors.error} />
                <Text style={modal.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

// ─── Breakdown Card ───────────────────────────────────────────────────────────

function BreakdownCard({
  bd,
  onPress,
}: {
  bd: BreakdownDetail
  onPress: () => void
}) {
  const cfg = STATUS_COLORS[bd.repair_status] ?? STATUS_COLORS.pending
  const photoCount = (bd.photos ?? []).length

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.bdCard}>
      <View style={styles.bdTop}>
        <Text style={styles.bdDate}>{formatDate(bd.date)}</Text>
        <View style={styles.bdTopRight}>
          {photoCount > 0 && (
            <View style={styles.photoBadge}>
              <Ionicons name="camera-outline" size={12} color={Colors.textLight} />
              <Text style={styles.photoBadgeText}>{photoCount}</Text>
            </View>
          )}
          <View style={[styles.statusPill, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.statusText, { color: cfg.text }]}>
              {STATUS_LABELS[bd.repair_status] ?? bd.repair_status}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={Colors.textLight} />
        </View>
      </View>

      <Text style={styles.bdDesc} numberOfLines={2}>{bd.description}</Text>

      {(bd.repairing_by || bd.anticipated_return || bd.resolved_date) && (
        <View style={styles.bdMeta}>
          {bd.repairing_by && (
            <View style={styles.bdMetaRow}>
              <Ionicons name="construct-outline" size={12} color={Colors.textLight} />
              <Text style={styles.bdMetaText}>{bd.repairing_by}</Text>
            </View>
          )}
          {bd.anticipated_return && bd.repair_status !== 'completed' && (
            <View style={styles.bdMetaRow}>
              <Ionicons name="calendar-outline" size={12} color={Colors.textLight} />
              <Text style={styles.bdMetaText}>Expected back {formatDate(bd.anticipated_return)}</Text>
            </View>
          )}
          {bd.resolved_date && (
            <View style={styles.bdMetaRow}>
              <Ionicons name="checkmark-circle-outline" size={12} color={Colors.success} />
              <Text style={[styles.bdMetaText, { color: Colors.success }]}>
                Resolved {formatDate(bd.resolved_date)}
              </Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  )
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

// ─── Quick Actions Panel (scan-page style) ──────────────────────────────────

const CONDITION_OPTS = [
  { v: 'good', l: 'Good', c: '#28a745' },
  { v: 'fair', l: 'Fair', c: '#fd7e14' },
  { v: 'poor', l: 'Poor', c: '#E65100' },
  { v: 'broken_down', l: 'Broken Down', c: '#dc3545' },
]

function QuickActions({ machineId, display, breakdowns: bds }: {
  machineId: number
  display: MachineDetail
  breakdowns: BreakdownDetail[]
}) {
  const { show } = useToastStore()
  const queryClient = useQueryClient()
  const activeProject = useProjectStore((s) => s.activeProject)
  const [panel, setPanel] = useState<'check' | 'breakdown' | 'history' | 'details' | null>(null)
  const [cond, setCond] = useState('good')
  const [hrs, setHrs] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [bdDesc, setBdDesc] = useState('')
  const [bdBy, setBdBy] = useState('')
  const [bdSub, setBdSub] = useState(false)

  const toggle = (p: typeof panel) => setPanel(panel === p ? null : p)

  const submitCheck = async () => {
    if (!activeProject?.id) { show('Select a project first', 'error'); return }
    setSubmitting(true)
    try {
      await api.equipment.submitDailyCheck({
        machine_id: machineId, project_id: activeProject.id,
        condition: cond, notes: notes || undefined, hours_reading: hrs || undefined,
      })
      show('Check recorded', 'success')
      setCond('good'); setHrs(''); setNotes(''); setPanel(null)
      queryClient.invalidateQueries({ queryKey: ['machine'] })
      queryClient.invalidateQueries({ queryKey: ['daily-checks'] })
    } catch { show('Failed to submit', 'error') }
    finally { setSubmitting(false) }
  }

  const submitBreakdown = async () => {
    if (!bdDesc.trim()) { show('Description required', 'error'); return }
    setBdSub(true)
    try {
      await api.equipment.createBreakdown({
        machine_id: machineId, breakdown_date: toDateStr(new Date()),
        description: bdDesc.trim(), repairing_by: bdBy.trim() || undefined,
      })
      show('Breakdown reported', 'success')
      setBdDesc(''); setBdBy(''); setPanel(null)
      queryClient.invalidateQueries({ queryKey: ['machine'] })
    } catch { show('Failed to report', 'error') }
    finally { setBdSub(false) }
  }

  const openBds = bds.filter(b => b.repair_status !== 'completed')

  return (
    <View style={{ marginBottom: Spacing.md }}>
      {/* Action buttons */}
      <View style={qa.grid}>
        <TouchableOpacity style={[qa.btn, { borderColor: '#28a745', backgroundColor: panel === 'check' ? 'rgba(40,167,69,0.12)' : '#fff' }]} onPress={() => toggle('check')} activeOpacity={0.7}>
          <Ionicons name="checkmark-circle-outline" size={20} color="#28a745" />
          <Text style={[qa.btnLabel, { color: '#28a745' }]}>Check</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[qa.btn, { borderColor: '#dc3545', backgroundColor: panel === 'breakdown' ? 'rgba(220,53,69,0.12)' : '#fff' }]} onPress={() => toggle('breakdown')} activeOpacity={0.7}>
          <Ionicons name="warning-outline" size={20} color="#dc3545" />
          <Text style={[qa.btnLabel, { color: '#dc3545' }]}>Breakdown</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[qa.btn, { borderColor: '#1565C0', backgroundColor: panel === 'history' ? 'rgba(21,101,192,0.12)' : '#fff' }]} onPress={() => toggle('history')} activeOpacity={0.7}>
          <Ionicons name="time-outline" size={20} color="#1565C0" />
          <Text style={[qa.btnLabel, { color: '#1565C0' }]}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[qa.btn, { borderColor: Colors.textSecondary, backgroundColor: panel === 'details' ? 'rgba(108,117,125,0.12)' : '#fff' }]} onPress={() => toggle('details')} activeOpacity={0.7}>
          <Ionicons name="information-circle-outline" size={20} color={Colors.textSecondary} />
          <Text style={[qa.btnLabel, { color: Colors.textSecondary }]}>Details</Text>
        </TouchableOpacity>
      </View>

      {/* Pre-Start Check */}
      {panel === 'check' && (
        <Card style={{ borderLeftWidth: 3, borderLeftColor: '#28a745' }}>
          <Text style={{ ...Typography.bodySmall, fontWeight: '700', color: '#28a745', marginBottom: 8 }}>Pre-Start Check</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {CONDITION_OPTS.map(o => (
              <TouchableOpacity key={o.v} onPress={() => setCond(o.v)}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 2,
                  borderColor: cond === o.v ? o.c : Colors.border,
                  backgroundColor: cond === o.v ? o.c + '20' : '#fff' }}>
                <Text style={{ fontSize: 12, fontWeight: cond === o.v ? '700' : '500', color: cond === o.v ? o.c : Colors.textSecondary }}>{o.l}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={qa.input} value={hrs} onChangeText={setHrs} placeholder="Hours reading" keyboardType="decimal-pad" placeholderTextColor={Colors.textLight} />
          <TextInput style={[qa.input, { marginTop: 8 }]} value={notes} onChangeText={setNotes} placeholder="Notes..." placeholderTextColor={Colors.textLight} />
          <TouchableOpacity style={[qa.submit, { backgroundColor: '#28a745' }]} onPress={submitCheck} disabled={submitting} activeOpacity={0.85}>
            {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={qa.submitText}>Submit Check</Text>}
          </TouchableOpacity>
        </Card>
      )}

      {/* Report Breakdown */}
      {panel === 'breakdown' && (
        <Card style={{ borderLeftWidth: 3, borderLeftColor: '#dc3545' }}>
          <Text style={{ ...Typography.bodySmall, fontWeight: '700', color: '#dc3545', marginBottom: 8 }}>Report Breakdown</Text>
          <TextInput style={[qa.input, { height: 72, textAlignVertical: 'top' }]} value={bdDesc} onChangeText={setBdDesc} placeholder="Describe the breakdown..." multiline placeholderTextColor={Colors.textLight} />
          <TextInput style={[qa.input, { marginTop: 8 }]} value={bdBy} onChangeText={setBdBy} placeholder="Being repaired by..." placeholderTextColor={Colors.textLight} />
          <TouchableOpacity style={[qa.submit, { backgroundColor: '#dc3545' }]} onPress={submitBreakdown} disabled={bdSub || !bdDesc.trim()} activeOpacity={0.85}>
            {bdSub ? <ActivityIndicator size="small" color="#fff" /> : <Text style={qa.submitText}>Report Breakdown</Text>}
          </TouchableOpacity>
        </Card>
      )}

      {/* Check History */}
      {panel === 'history' && (
        <Card style={{ borderLeftWidth: 3, borderLeftColor: '#1565C0' }}>
          <Text style={{ ...Typography.bodySmall, fontWeight: '700', color: '#1565C0', marginBottom: 8 }}>Check History</Text>
          {(display.daily_checks ?? []).length > 0 ? (display.daily_checks ?? []).map((dc: DailyCheckRecord, i: number) => (
            <View key={dc.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4,
              borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: Colors.border }}>
              <View style={{ width: 8, height: 8, borderRadius: 4,
                backgroundColor: dc.condition === 'good' ? '#28a745' : dc.condition === 'fair' ? '#fd7e14' : '#dc3545' }} />
              <Text style={{ fontSize: 12, flex: 1 }}>{dc.condition?.replace('_', ' ')}</Text>
              <Text style={{ fontSize: 11, color: Colors.textLight }}>{dc.hours_reading ?? '—'}h</Text>
              <Text style={{ fontSize: 11, color: Colors.textLight }}>{dc.checked_by ?? ''}</Text>
              <Text style={{ fontSize: 11, color: Colors.textLight }}>{formatDate(dc.check_date)}</Text>
            </View>
          )) : <Text style={{ fontSize: 12, color: Colors.textLight, textAlign: 'center', paddingVertical: 8 }}>No checks recorded</Text>}
          {openBds.length > 0 && (
            <>
              <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 8 }} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#dc3545', marginBottom: 4 }}>Active Breakdowns</Text>
              {openBds.map(bd => (
                <Text key={bd.id} style={{ fontSize: 11, paddingVertical: 2 }}>{formatDate(bd.date)} — {bd.description?.slice(0, 80)}</Text>
              ))}
            </>
          )}
        </Card>
      )}

      {/* Details & Docs */}
      {panel === 'details' && (
        <Card style={{ borderLeftWidth: 3, borderLeftColor: Colors.textSecondary }}>
          <Text style={{ ...Typography.bodySmall, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 }}>Machine Details</Text>
          {[
            ['Name', display.name],
            ['Plant ID', display.plant_id],
            ['Type', display.type],
            ['Serial Number', display.serial_number],
            ['Manufacturer', display.manufacturer],
            ['Model', display.model_number],
            ['Delay Rate', display.delay_rate != null ? `$${display.delay_rate}/hr` : null],
            ['Status', display.active ? 'Active' : 'Inactive'],
            ['Acquired', display.acquired_date ? formatDate(display.acquired_date) : null],
            ['Dispose By', display.dispose_by_date ? formatDate(display.dispose_by_date) : null],
            ['Next Inspection', display.next_inspection_date ? formatDate(display.next_inspection_date) : null],
            ['Inspection Interval', (display as any).inspection_interval_days ? `${(display as any).inspection_interval_days} days` : null],
          ].filter(([, v]) => v).map(([label, val], i) => (
            <View key={i} style={{ flexDirection: 'row', paddingVertical: 3, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: Colors.border }}>
              <Text style={{ fontSize: 12, color: Colors.textLight, width: 110 }}>{label}</Text>
              <Text style={{ fontSize: 12, color: Colors.textPrimary, flex: 1 }}>{val}</Text>
            </View>
          ))}

          {(display.storage_instructions || display.service_instructions || display.spare_parts_notes || display.disposal_procedure) && (
            <>
              <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 8 }} />
              <Text style={{ ...Typography.caption, fontWeight: '700', marginBottom: 4 }}>Instructions & Notes</Text>
              {display.storage_instructions && (
                <View style={{ marginBottom: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary }}>Storage</Text>
                  <Text style={{ fontSize: 12, color: Colors.textPrimary }}>{display.storage_instructions}</Text>
                </View>
              )}
              {display.service_instructions && (
                <View style={{ marginBottom: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary }}>Service</Text>
                  <Text style={{ fontSize: 12, color: Colors.textPrimary }}>{display.service_instructions}</Text>
                </View>
              )}
              {display.spare_parts_notes && (
                <View style={{ marginBottom: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary }}>Spare Parts</Text>
                  <Text style={{ fontSize: 12, color: Colors.textPrimary }}>{display.spare_parts_notes}</Text>
                </View>
              )}
              {display.disposal_procedure && (
                <View style={{ marginBottom: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary }}>Disposal Procedure</Text>
                  <Text style={{ fontSize: 12, color: Colors.textPrimary }}>{display.disposal_procedure}</Text>
                </View>
              )}
            </>
          )}

          {display.description && (
            <>
              <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 8 }} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary }}>Notes</Text>
              <Text style={{ fontSize: 12, color: Colors.textPrimary }}>{display.description}</Text>
            </>
          )}

          {(display.next_inspection_date || display.dispose_by_date) && (
            <>
              <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 8 }} />
              <Text style={{ ...Typography.caption, fontWeight: '700', marginBottom: 4 }}>Lifecycle Alerts</Text>
              {display.next_inspection_date && (() => {
                const days = Math.ceil((new Date(display.next_inspection_date + 'T00:00:00').getTime() - Date.now()) / 86400000)
                const urgent = days <= 3
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 }}>
                    <Ionicons name="search" size={14} color={urgent ? Colors.error : Colors.warning} />
                    <Text style={{ fontSize: 12, color: urgent ? Colors.error : Colors.warning, fontWeight: '600' }}>
                      {days <= 0 ? 'Inspection overdue' : `Inspection in ${days} day${days !== 1 ? 's' : ''}`} ({formatDate(display.next_inspection_date)})
                    </Text>
                  </View>
                )
              })()}
              {display.dispose_by_date && (() => {
                const days = Math.ceil((new Date(display.dispose_by_date + 'T00:00:00').getTime() - Date.now()) / 86400000)
                const urgent = days <= 7
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 }}>
                    <Ionicons name="trash" size={14} color={urgent ? Colors.error : Colors.warning} />
                    <Text style={{ fontSize: 12, color: urgent ? Colors.error : Colors.warning, fontWeight: '600' }}>
                      {days <= 0 ? 'Disposal overdue' : `Disposal in ${days} day${days !== 1 ? 's' : ''}`} ({formatDate(display.dispose_by_date)})
                    </Text>
                  </View>
                )
              })()}
            </>
          )}
        </Card>
      )}
    </View>
  )
}

const qa = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 6, marginBottom: Spacing.sm },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, gap: 2 },
  btnLabel: { fontSize: 9, fontWeight: '700', textAlign: 'center', lineHeight: 11 },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: Colors.textPrimary, backgroundColor: '#fff' },
  submit: { marginTop: 12, paddingVertical: 10, borderRadius: BorderRadius.md, alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})

export default function MachineDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const { show } = useToastStore()
  const queryClient = useQueryClient()

  const canEdit = user?.role === 'admin' || user?.role === 'supervisor'

  const [refreshing, setRefreshing] = useState(false)
  const [editMachineVisible, setEditMachineVisible] = useState(false)
  const [viewBreakdown, setViewBreakdown] = useState<BreakdownDetail | null>(null)
  const [editBreakdown, setEditBreakdown] = useState<BreakdownDetail | null>(null)
  const [machineOverride, setMachineOverride] = useState<Partial<MachineDetail> | null>(null)
  const [bdOverrides, setBdOverrides] = useState<Record<number, BreakdownDetail>>({})
  const [deletingBdId, setDeletingBdId] = useState<number | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  const { data: machine, isLoading, isError, refetch } = useQuery({
    queryKey: ['machine', id],
    queryFn: () =>
      cachedQuery(`machine_${id}`, () =>
        api.equipment.detail(Number(id)).then(r => r.data)
      ),
    staleTime: 2 * 60 * 1000,
  })

  const display = machine ? { ...machine, ...machineOverride } : null

  const displayBreakdowns = (display?.breakdowns ?? []).map(bd =>
    bdOverrides[bd.id] ? { ...bd, ...bdOverrides[bd.id] } : bd
  )

  const openCount = displayBreakdowns.filter(b => b.repair_status !== 'completed').length

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setBdOverrides({})
    setMachineOverride(null)
    setRefreshing(false)
  }

  const handleChangePhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Photo library access is needed to select a photo.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    })
    if (result.canceled || result.assets.length === 0) return
    setUploadingPhoto(true)
    try {
      const compressed = await compressImage(result.assets[0].uri)
      const filename = `machine_${id}_${Date.now()}.jpg`
      const res = await api.equipment.uploadMachinePhoto(Number(id), compressed, filename)
      if (res.photo_url) {
        setMachineOverride(prev => ({ ...prev, photo_url: res.photo_url }))
      }
      show('Photo updated', 'success')
      queryClient.invalidateQueries({ queryKey: ['machine', id] })
      queryClient.invalidateQueries({ queryKey: ['machines'] })
    } catch {
      show('Failed to upload photo', 'error')
    } finally {
      setUploadingPhoto(false)
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Equipment</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.loadingBody}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      </SafeAreaView>
    )
  }

  if (isError || !display) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Equipment</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.errorBody}>
          <Text style={styles.errorText}>Could not load machine details.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{display.name}</Text>
        {canEdit ? (
          <TouchableOpacity onPress={() => setEditMachineVisible(true)} style={styles.editBtn}>
            <Ionicons name="pencil-outline" size={20} color={Colors.primary} />
          </TouchableOpacity>
        ) : <View style={{ width: 32 }} />}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
        }
      >
        {/* Machine photo */}
        {display.photo_url ? (
          <View style={styles.machinePhotoWrap}>
            <Image
              source={{ uri: `${API_BASE_URL}${display.photo_url}` }}
              style={styles.machinePhoto}
              resizeMode="cover"
            />
            {canEdit && (
              <TouchableOpacity
                style={styles.changePhotoBtn}
                onPress={handleChangePhoto}
                disabled={uploadingPhoto}
                activeOpacity={0.85}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <>
                    <Ionicons name="camera-outline" size={16} color={Colors.white} />
                    <Text style={styles.changePhotoBtnText}>Change Photo</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        ) : canEdit ? (
          <TouchableOpacity
            style={styles.addPhotoBtn}
            onPress={handleChangePhoto}
            disabled={uploadingPhoto}
            activeOpacity={0.85}
          >
            {uploadingPhoto ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <>
                <Ionicons name="camera-outline" size={24} color={Colors.primary} />
                <Text style={styles.addPhotoBtnText}>Add Photo</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}

        {/* Quick action buttons */}
        <QuickActions machineId={Number(id)} display={display} breakdowns={displayBreakdowns} />

        {/* Machine info card */}
        <Card style={styles.infoCard}>
          <View style={styles.infoTopRow}>
            <View style={styles.infoTitles}>
              <Text style={styles.machineName}>{display.name}</Text>
              {display.type && <Text style={styles.machineType}>{display.type}</Text>}
            </View>
            <View style={[
              styles.activeBadge,
              { backgroundColor: display.active ? '#E8F5E9' : Colors.surface }
            ]}>
              <Text style={[
                styles.activeBadgeText,
                { color: display.active ? Colors.success : Colors.textLight }
              ]}>
                {display.active ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>

          <View style={styles.infoGrid}>
            {display.plant_id && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Plant ID</Text>
                <Text style={styles.infoValue}>{display.plant_id}</Text>
              </View>
            )}
            {display.serial_number && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Serial No.</Text>
                <Text style={styles.infoValue}>{display.serial_number}</Text>
              </View>
            )}
            {display.manufacturer && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Manufacturer</Text>
                <Text style={styles.infoValue}>{display.manufacturer}</Text>
              </View>
            )}
            {display.model_number && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Model</Text>
                <Text style={styles.infoValue}>{display.model_number}</Text>
              </View>
            )}
            {display.acquired_date && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Acquired</Text>
                <Text style={styles.infoValue}>{formatDate(display.acquired_date)}</Text>
              </View>
            )}
            {display.delay_rate != null && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Delay Rate</Text>
                <Text style={styles.infoValue}>${display.delay_rate}/hr</Text>
              </View>
            )}
            {display.description && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Notes</Text>
                <Text style={[styles.infoValue, { flex: 1 }]}>{display.description}</Text>
              </View>
            )}
          </View>

          {/* Storage, service, spare parts info */}
          {(display.storage_instructions || display.service_instructions || display.spare_parts_notes || display.disposal_procedure) && (
            <View style={[styles.infoGrid, { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border }]}>
              {display.storage_instructions && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Storage</Text>
                  <Text style={[styles.infoValue, { flex: 1 }]}>{display.storage_instructions}</Text>
                </View>
              )}
              {display.service_instructions && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Service</Text>
                  <Text style={[styles.infoValue, { flex: 1 }]}>{display.service_instructions}</Text>
                </View>
              )}
              {display.spare_parts_notes && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Spare Parts</Text>
                  <Text style={[styles.infoValue, { flex: 1 }]}>{display.spare_parts_notes}</Text>
                </View>
              )}
              {display.disposal_procedure && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Disposal</Text>
                  <Text style={[styles.infoValue, { flex: 1 }]}>{display.disposal_procedure}</Text>
                </View>
              )}
            </View>
          )}
        </Card>

        {/* Lifecycle section */}
        {(display.dispose_by_date || display.next_inspection_date) && (
          <Card style={styles.infoCard}>
            <Text style={[styles.sectionTitle, { marginBottom: Spacing.sm }]}>Lifecycle</Text>
            <View style={styles.infoGrid}>
              {display.dispose_by_date && (() => {
                const daysLeft = Math.ceil((new Date(display.dispose_by_date + 'T00:00:00').getTime() - Date.now()) / 86400000)
                return (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Dispose By</Text>
                    <Text style={[styles.infoValue, daysLeft <= 14 ? { color: Colors.error, fontWeight: '700' } : {}]}>
                      {formatDate(display.dispose_by_date)} ({daysLeft}d)
                    </Text>
                  </View>
                )
              })()}
              {display.next_inspection_date && (() => {
                const daysLeft = Math.ceil((new Date(display.next_inspection_date + 'T00:00:00').getTime() - Date.now()) / 86400000)
                return (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Inspection</Text>
                    <Text style={[styles.infoValue, daysLeft <= 7 ? { color: Colors.warning, fontWeight: '700' } : {}]}>
                      {formatDate(display.next_inspection_date)} ({daysLeft}d)
                    </Text>
                  </View>
                )
              })()}
              {display.inspection_interval_days && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Interval</Text>
                  <Text style={styles.infoValue}>Every {display.inspection_interval_days} days</Text>
                </View>
              )}
            </View>
          </Card>
        )}

        {/* Daily checks timeline */}
        {(display.daily_checks ?? []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Daily Checks</Text>
            <Card padding="none">
              {(display.daily_checks ?? []).map((dc: DailyCheckRecord, idx: number) => {
                const condColors: Record<string, string> = {
                  good: Colors.success,
                  fair: Colors.warning,
                  poor: '#E65100',
                  broken_down: Colors.error,
                }
                return (
                  <View key={dc.id}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.md }}>
                      <View style={{
                        width: 10, height: 10, borderRadius: 5,
                        backgroundColor: condColors[dc.condition] ?? Colors.textLight,
                      }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...Typography.bodySmall, color: Colors.textPrimary }}>
                          {formatDate(dc.check_date)} — {dc.condition.replace('_', ' ')}
                        </Text>
                        {dc.checked_by && (
                          <Text style={{ ...Typography.caption, color: Colors.textSecondary }}>
                            by {dc.checked_by}
                          </Text>
                        )}
                        {dc.notes && (
                          <Text style={{ ...Typography.caption, color: Colors.textLight }} numberOfLines={1}>
                            {dc.notes}
                          </Text>
                        )}
                      </View>
                    </View>
                    {idx < (display.daily_checks ?? []).length - 1 && <View style={styles.divider} />}
                  </View>
                )
              })}
            </Card>
          </View>
        )}

        {/* Pending transfer */}
        {display.pending_transfer && (
          <Card style={[styles.infoCard, { borderLeftWidth: 4, borderLeftColor: Colors.warning }]}>
            <Text style={[styles.sectionTitle, { marginBottom: Spacing.sm }]}>Pending Transfer</Text>
            <View style={styles.infoGrid}>
              {display.pending_transfer.from_project && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>From</Text>
                  <Text style={styles.infoValue}>{display.pending_transfer.from_project}</Text>
                </View>
              )}
              {display.pending_transfer.to_project && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>To</Text>
                  <Text style={styles.infoValue}>{display.pending_transfer.to_project}</Text>
                </View>
              )}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Scheduled</Text>
                <Text style={styles.infoValue}>{formatDate(display.pending_transfer.scheduled_date)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Status</Text>
                <Text style={[styles.infoValue, { color: Colors.warning, fontWeight: '600' }]}>
                  {display.pending_transfer.status.replace('_', ' ')}
                </Text>
              </View>
            </View>
          </Card>
        )}

        {/* Breakdown status summary */}
        {openCount > 0 && (
          <View style={styles.openAlert}>
            <Ionicons name="warning" size={16} color={Colors.warning} />
            <Text style={styles.openAlertText}>
              {openCount} open breakdown{openCount > 1 ? 's' : ''}
            </Text>
          </View>
        )}

        {/* Breakdowns section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Breakdown History</Text>
            <TouchableOpacity
              style={styles.reportBtn}
              onPress={() => router.push({
                pathname: '/breakdown/new',
                params: { machine_id: display.id, machine_name: display.name },
              })}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={14} color={Colors.dark} />
              <Text style={styles.reportBtnText}>Report</Text>
            </TouchableOpacity>
          </View>

          {displayBreakdowns.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>No breakdown history for this machine.</Text>
            </Card>
          ) : (
            <Card padding="none">
              {displayBreakdowns.map((bd, idx) => (
                <View key={bd.id}>
                  <BreakdownCard
                    bd={bd}
                    onPress={() => setViewBreakdown(bd)}
                  />
                  {idx < displayBreakdowns.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
            </Card>
          )}
        </View>
      </ScrollView>

      {/* Edit machine modal */}
      {canEdit && machine && (
        <EditMachineModal
          machine={{ ...machine, ...machineOverride }}
          visible={editMachineVisible}
          onClose={() => setEditMachineVisible(false)}
          onSaved={updated => {
            setMachineOverride(updated)
            queryClient.invalidateQueries({ queryKey: ['machines'] })
          }}
        />
      )}

      {/* Breakdown detail modal */}
      {viewBreakdown && display && (
        <BreakdownDetailModal
          breakdown={bdOverrides[viewBreakdown.id] ? { ...viewBreakdown, ...bdOverrides[viewBreakdown.id] } : viewBreakdown}
          machineName={display.name}
          visible={!!viewBreakdown}
          canEdit={canEdit}
          onClose={() => setViewBreakdown(null)}
          onEdit={() => {
            setEditBreakdown(bdOverrides[viewBreakdown.id] ? { ...viewBreakdown, ...bdOverrides[viewBreakdown.id] } : viewBreakdown)
          }}
          onDelete={() => {
            Alert.alert(
              'Delete Breakdown',
              'Are you sure you want to delete this breakdown record? This cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    const bdId = viewBreakdown.id
                    setDeletingBdId(bdId)
                    try {
                      await api.equipment.deleteBreakdown(bdId)
                      setViewBreakdown(null)
                      setBdOverrides(prev => {
                        const next = { ...prev }
                        delete next[bdId]
                        return next
                      })
                      // Remove from machine data optimistically by adding a tombstone
                      queryClient.invalidateQueries({ queryKey: ['machine', id] })
                      queryClient.invalidateQueries({ queryKey: ['breakdowns'] })
                      show('Breakdown deleted', 'success')
                    } catch {
                      show('Failed to delete breakdown', 'error')
                    } finally {
                      setDeletingBdId(null)
                    }
                  },
                },
              ]
            )
          }}
        />
      )}

      {/* Edit breakdown modal */}
      {canEdit && editBreakdown && (
        <EditBreakdownModal
          breakdown={editBreakdown}
          visible={!!editBreakdown}
          onClose={() => setEditBreakdown(null)}
          onSaved={updated => {
            setBdOverrides(prev => ({ ...prev, [updated.id]: updated }))
            // Also update viewBreakdown so detail modal reflects new data immediately
            if (viewBreakdown && viewBreakdown.id === updated.id) {
              setViewBreakdown(prev => prev ? { ...prev, ...updated } : prev)
            }
            queryClient.invalidateQueries({ queryKey: ['breakdowns'] })
            setEditBreakdown(null)
          }}
        />
      )}
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },

  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  backBtn: { width: 32, alignItems: 'flex-start' },
  editBtn: { width: 32, alignItems: 'flex-end' },
  headerTitle: { ...Typography.h3, color: Colors.white, flex: 1, textAlign: 'center' },

  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },

  machinePhotoWrap: {
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    position: 'relative' as const,
  },
  machinePhoto: {
    width: '100%' as any,
    height: 200,
    borderRadius: BorderRadius.md,
  },
  changePhotoBtn: {
    position: 'absolute' as const,
    bottom: Spacing.sm,
    right: Spacing.sm,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
  },
  changePhotoBtnText: {
    ...Typography.caption,
    color: Colors.white,
    fontWeight: '600' as const,
  },
  addPhotoBtn: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: Spacing.xs,
    height: 120,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: 'dashed' as const,
    backgroundColor: Colors.surface,
  },
  addPhotoBtnText: {
    ...Typography.body,
    color: Colors.primary,
    fontWeight: '600' as const,
  },

  infoCard: {},
  infoTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  infoTitles: { flex: 1, marginRight: Spacing.sm },
  machineName: { ...Typography.h3, color: Colors.textPrimary },
  machineType: { ...Typography.bodySmall, color: Colors.textSecondary, marginTop: 2 },
  activeBadge: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  activeBadgeText: { ...Typography.caption, fontWeight: '700' },

  infoGrid: { gap: Spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  infoLabel: { ...Typography.caption, color: Colors.textSecondary, width: 80, paddingTop: 1 },
  infoValue: { ...Typography.bodySmall, color: Colors.textPrimary },

  openAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: '#FFF3E0',
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  openAlertText: { ...Typography.bodySmall, color: Colors.warning, fontWeight: '600' },

  section: { gap: Spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { ...Typography.h4, color: Colors.textPrimary },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  reportBtnText: { ...Typography.caption, color: Colors.dark, fontWeight: '700' },

  bdCard: { padding: Spacing.md, gap: Spacing.xs },
  bdTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bdTopRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bdDate: { ...Typography.bodySmall, color: Colors.textSecondary },
  bdDesc: { ...Typography.body, color: Colors.textPrimary },
  bdMeta: { gap: 3, marginTop: Spacing.xs },
  bdMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bdMetaText: { ...Typography.caption, color: Colors.textSecondary },

  photoBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  photoBadgeText: { ...Typography.caption, color: Colors.textLight },

  statusPill: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: { ...Typography.caption, fontWeight: '700' },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginHorizontal: Spacing.md },

  emptyText: { ...Typography.body, color: Colors.textLight, textAlign: 'center' },

  loadingBody: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  errorBody: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  errorText: { ...Typography.body, color: Colors.textSecondary },
  retryBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText: { ...Typography.body, color: Colors.dark, fontWeight: '600' },
})

const modal = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  title: { ...Typography.h4, color: Colors.textPrimary },
  cancel: { ...Typography.body, color: Colors.textSecondary },
  save: { ...Typography.body, color: Colors.primary, fontWeight: '700' },
  body: { flex: 1 },
  bodyContent: { padding: Spacing.md, gap: Spacing.md },
  field: { gap: Spacing.xs },
  label: { ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    ...Typography.body,
    color: Colors.textPrimary,
  },
  textarea: { minHeight: 100 },
  readOnly: { ...Typography.body, color: Colors.textSecondary },
  statusRow: { flexDirection: 'row', gap: Spacing.sm },
  statusBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  statusBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  statusBtnText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600' },
  statusBtnTextActive: { color: Colors.dark },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },

  // Detail modal
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusBannerText: { ...Typography.bodySmall, fontWeight: '700' },

  detailCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    gap: Spacing.md,
  },
  detailLabel: { ...Typography.caption, color: Colors.textSecondary, width: 90 },
  detailValue: { ...Typography.body, color: Colors.textPrimary },
  detailDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },

  section: { gap: Spacing.sm },
  sectionTitle: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  photo: { width: 90, height: 90, borderRadius: BorderRadius.sm },
  photoOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 4,
    padding: 2,
  },

  actions: { gap: Spacing.sm, marginTop: Spacing.sm },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
  },
  editBtnText: { ...Typography.body, color: Colors.dark, fontWeight: '700' },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.error,
    paddingVertical: Spacing.md,
  },
  deleteBtnText: { ...Typography.body, color: Colors.error, fontWeight: '600' },
})
