import { useState, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  Platform,
  Keyboard,
  InputAccessoryView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import Card from '../../components/ui/Card'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { api } from '../../lib/api'
import { cachedQuery } from '../../lib/cachedQuery'
import { compressImage } from '../../lib/compressImage'
import { formatDate } from '../../lib/dates'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { useToastStore } from '../../store/toast'

let NfcManager: any = null
let NfcTech: any = null
try {
  const nfc = require('react-native-nfc-manager')
  NfcManager = nfc.default
  NfcTech = nfc.NfcTech
} catch {}

const CONDITIONS = [
  { v: 'good', l: 'Good', c: '#28a745' },
  { v: 'fair', l: 'Fair', c: '#fd7e14' },
  { v: 'poor', l: 'Poor', c: '#E65100' },
  { v: 'broken_down', l: 'Broken Down', c: '#dc3545' },
]

export default function ScanLandingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { show } = useToastStore()
  const user = useAuthStore(s => s.user)
  const activeProject = useProjectStore(s => s.activeProject)
  const queryClient = useQueryClient()

  const [panel, setPanel] = useState<'check' | null>(null)
  const [cond, setCond] = useState('good')
  const [notes, setNotes] = useState('')
  const [hrs, setHrs] = useState('')
  const [photos, setPhotos] = useState<{ uri: string; filename: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [verifiedTagUid, setVerifiedTagUid] = useState<string | null>(null)
  const [scanningForCheck, setScanningForCheck] = useState(false)
  const [infoModal, setInfoModal] = useState<null | 'details' | 'history'>(null)

  // Detail / history modal data is fetched only when the user opens one of
  // the modals, so the scan page itself stays snappy.
  const { data: fullDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['machine', id, 'detail'],
    queryFn: () => api.equipment.detail(Number(id)).then((r) => r.data),
    enabled: !!id && !!infoModal,
    staleTime: 2 * 60 * 1000,
  })

  const { data: machine, isLoading, isError } = useQuery({
    queryKey: ['scan-info', id],
    // Fast minimal endpoint — only what the scan landing needs. Cached for 5
    // minutes so repeated scans of the same tag are instant.
    queryFn: () => cachedQuery(`scan_info_${id}`, () =>
      api.equipment.scanInfo(Number(id)).then(r => r.data)),
    staleTime: 5 * 60 * 1000,
  })

  // On arrival, record a scan event + grab GPS. This runs whether you got here
  // via universal link (iOS opening the app from an NFC tap) or via the
  // in-app Scan button.
  useEffect(() => {
    if (!id) return
    const machineId = Number(id)
    if (!machineId) return
    ;(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          })
          await api.equipment.recordScanLocation(machineId, {
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          })
        } else {
          await api.equipment.recordScanLocation(machineId, {})
        }
      } catch {
        api.equipment.recordScanLocation(machineId, {}).catch(() => {})
      }
    })()
  }, [id])

  const goBack = () => {
    // Always send users to the Equipment tab rather than trying to pop the
    // nav stack — back() can fail with "unmatched route" when the scan was
    // opened via universal link on a cold boot (no history). Replace is
    // snappier and reliably lands somewhere valid.
    router.replace('/(tabs)/equipment')
  }

  const takeOrPickPhoto = async (multi: boolean) => {
    return new Promise<{ uri: string; filename: string }[]>((resolve) => {
      Alert.alert('Add Photo', '', [
        {
          text: 'Camera', onPress: async () => {
            const p = await ImagePicker.requestCameraPermissionsAsync()
            if (p.status !== 'granted') { resolve([]); return }
            const r = await ImagePicker.launchCameraAsync({ quality: 0.8 })
            if (!r.canceled && r.assets.length > 0) {
              const uri = await compressImage(r.assets[0].uri)
              resolve([{ uri, filename: `check_${Date.now()}.jpg` }])
            } else resolve([])
          },
        },
        {
          text: 'Photo Library', onPress: async () => {
            const p = await ImagePicker.requestMediaLibraryPermissionsAsync()
            if (p.status !== 'granted') { resolve([]); return }
            const r = await ImagePicker.launchImageLibraryAsync({
              quality: 0.8, allowsMultipleSelection: multi,
            })
            if (!r.canceled && r.assets.length > 0) {
              const compressed = await Promise.all(r.assets.map(async (a, i) => ({
                uri: await compressImage(a.uri),
                filename: `check_${Date.now()}_${i}.jpg`,
              })))
              resolve(compressed)
            } else resolve([])
          },
        },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve([]) },
      ])
    })
  }

  const scanTagForCheck = async () => {
    if (!NfcManager) {
      Alert.alert('NFC Not Available', 'This device does not support NFC.')
      return
    }
    if (!machine) return
    setScanningForCheck(true)
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef)
      const tag = await NfcManager.getTag()
      const uid: string | undefined = tag?.id
      NfcManager.cancelTechnologyRequest().catch(() => {})
      setScanningForCheck(false)
      if (!uid) {
        Alert.alert('Scan Failed', 'Could not read the NFC tag.')
        return
      }
      // If machine has a registered tag, require exact match
      if ((machine as any).active_tag_uid && uid !== (machine as any).active_tag_uid) {
        Alert.alert('Wrong Tag', `That tag does not match ${machine.name}.`)
        return
      }
      setVerifiedTagUid(uid)
      show('Tag verified — fill in the check details.', 'success')
    } catch (e: any) {
      NfcManager.cancelTechnologyRequest().catch(() => {})
      setScanningForCheck(false)
      if (e?.message !== 'cancelled') {
        Alert.alert('Scan Failed', 'Could not read the NFC tag.')
      }
    }
  }

  const submitCheck = async () => {
    if (!activeProject?.id) {
      show('Select a project first', 'error')
      return
    }
    if (!machine) return
    // If the machine has a registered tag, we must have verified it first
    const requiresTag = !!(machine as any).active_tag_uid
    if (requiresTag && !verifiedTagUid) {
      Alert.alert('Scan Required', 'Scan the NFC tag on this machine before submitting the check.')
      return
    }
    setSubmitting(true)
    try {
      await api.equipment.submitDailyCheck({
        machine_id: machine.id,
        project_id: activeProject.id,
        condition: cond,
        notes: notes || undefined,
        hours_reading: hrs || undefined,
        tag_uid: verifiedTagUid || undefined,
        photos,
      })
      show('Check recorded', 'success')
      setCond('good'); setNotes(''); setHrs(''); setPhotos([]); setPanel(null)
      queryClient.invalidateQueries({ queryKey: ['machine'] })
      queryClient.invalidateQueries({ queryKey: ['daily-checks'] })
      if (cond === 'broken_down') {
        router.push({
          pathname: '/breakdown/new',
          params: { machine_id: String(machine.id), machine_name: machine.name },
        })
      }
    } catch {
      show('Failed to submit', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Loading…</Text>
          <View style={{ width: 32 }} />
        </View>
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.primary} />
      </SafeAreaView>
    )
  }

  if (isError || !machine) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Not Found</Text>
          <View style={{ width: 32 }} />
        </View>
        <Text style={{ padding: Spacing.lg, color: Colors.textSecondary }}>
          Could not load this piece of equipment.
        </Text>
      </SafeAreaView>
    )
  }

  const photoUrl = machine.photo_url || null
  const activeBreakdown = (machine.breakdowns || []).find(b => b.repair_status !== 'completed')

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{machine.name}</Text>
        <View style={{ width: 32 }} />
      </View>
      <View style={styles.headerAccent} />

      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: Spacing.xl * 2 }}>
        {/* Hero */}
        <Card style={{ alignItems: 'center', paddingVertical: Spacing.md }}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.photo} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Ionicons name="construct-outline" size={40} color={Colors.textLight} />
            </View>
          )}
          <Text style={{ ...Typography.h3, color: Colors.textPrimary, textAlign: 'center' }}>{machine.name}</Text>
          {machine.plant_id && (
            <Text style={{ ...Typography.bodySmall, color: Colors.textSecondary }}>Plant ID: {machine.plant_id}</Text>
          )}
          {(machine.manufacturer || machine.model_number || machine.type) && (
            <Text style={{ ...Typography.bodySmall, color: Colors.textSecondary, textAlign: 'center' }}>
              {[machine.type, machine.manufacturer, machine.model_number].filter(Boolean).join(' · ')}
            </Text>
          )}
        </Card>

        {/* Compliance warnings — every obligation in one place. Anything
            overdue, due today, or due within 30 days gets its own banner. */}
        <ComplianceWarnings machine={machine as any} />

        {/* Active breakdown warning */}
        {activeBreakdown && (
          <View style={styles.alertDanger}>
            <Ionicons name="warning" size={18} color="#842029" />
            <View style={{ flex: 1 }}>
              <Text style={{ ...Typography.bodySmall, fontWeight: '700', color: '#842029' }}>Active Breakdown</Text>
              {activeBreakdown.description && (
                <Text style={{ ...Typography.caption, color: '#842029' }} numberOfLines={2}>
                  {activeBreakdown.description}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Pending transfer banner with action */}
        {machine.pending_transfer && (() => {
          const pt: any = machine.pending_transfer
          const isTransit = pt.status === 'in_transit'
          const isAdminOrSup = user?.role === 'admin' || user?.role === 'supervisor'
          const needsPreCheck = !isTransit && !pt.pre_checked && isAdminOrSup
          const needsArrival = isTransit && !pt.arrived && isAdminOrSup
          return (
            <View style={[
              styles.alertDanger,
              {
                flexDirection: 'column',
                alignItems: 'stretch',
                backgroundColor: isTransit ? '#fff3cd' : '#cff4fc',
                borderColor: isTransit ? '#ffe69c' : '#b6effb',
              },
            ]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <Ionicons
                  name={isTransit ? ('car-outline' as any) : ('calendar-outline' as any)}
                  size={18}
                  color={isTransit ? '#664d03' : '#055160'}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{
                    ...Typography.bodySmall, fontWeight: '700',
                    color: isTransit ? '#664d03' : '#055160',
                  }}>
                    {isTransit ? 'In Transit — Arrival Pending' : 'Transfer Scheduled'}
                  </Text>
                  <Text style={{
                    ...Typography.caption,
                    color: isTransit ? '#664d03' : '#055160',
                  }}>
                    {isTransit
                      ? `Arriving at ${pt.to_project}${pt.anticipated_arrival_date ? ` around ${formatDate(pt.anticipated_arrival_date)}` : ''}`
                      : `Moving to ${pt.to_project} on ${formatDate(pt.scheduled_date)}${pt.anticipated_arrival_date ? ` (arrive ~${formatDate(pt.anticipated_arrival_date)})` : ''}`}
                  </Text>
                </View>
              </View>
              {(needsPreCheck || needsArrival) && pt.batch_id && (
                <TouchableOpacity
                  onPress={() => router.push({ pathname: '/transfer-batch/[id]', params: { id: String(pt.batch_id) } })}
                  style={{
                    marginTop: Spacing.sm, padding: Spacing.sm,
                    borderRadius: BorderRadius.sm,
                    backgroundColor: isTransit ? '#664d03' : '#055160',
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Ionicons name="scan-outline" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                    {needsArrival ? 'Confirm Arrival' : 'Complete Pre-Check'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )
        })()}

        {/* Action grid */}
        <View style={styles.grid}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              { borderColor: '#28a745', backgroundColor: panel === 'check' ? 'rgba(40,167,69,0.12)' : '#fff' },
              machine.pending_transfer?.status === 'in_transit' && { opacity: 0.4 },
            ]}
            disabled={machine.pending_transfer?.status === 'in_transit'}
            onPress={() => {
              if (machine.pending_transfer?.status === 'in_transit') {
                Alert.alert(
                  'Locked — In Transit',
                  `This machine is being transferred to ${machine.pending_transfer.to_project}. Complete the arrival scan first.`,
                )
                return
              }
              setPanel(panel === 'check' ? null : 'check')
            }}
          >
            <Ionicons name="checkmark-circle-outline" size={28} color="#28a745" />
            <Text style={[styles.actionText, { color: '#28a745' }]}>Pre-Start Check</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: '#dc3545' }]}
            onPress={() => router.push({
              pathname: '/breakdown/new',
              params: { machine_id: String(machine.id), machine_name: machine.name },
            })}
          >
            <Ionicons name="warning-outline" size={28} color="#dc3545" />
            <Text style={[styles.actionText, { color: '#dc3545' }]}>Report Breakdown</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: '#1565C0' }]}
            onPress={() => setInfoModal('details')}
          >
            <Ionicons name="list-outline" size={28} color="#1565C0" />
            <Text style={[styles.actionText, { color: '#1565C0' }]}>Full Details</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: Colors.textSecondary }]}
            onPress={() => setInfoModal('history')}
          >
            <Ionicons name="time-outline" size={28} color={Colors.textSecondary} />
            <Text style={[styles.actionText, { color: Colors.textSecondary }]}>History</Text>
          </TouchableOpacity>
        </View>

        {/* Inline check panel */}
        {panel === 'check' && (
          <Card style={{ borderLeftWidth: 3, borderLeftColor: '#28a745', marginTop: Spacing.md }}>
            <Text style={{ ...Typography.bodySmall, fontWeight: '700', color: '#28a745', marginBottom: 8 }}>Pre-Start Check</Text>

            {(machine as any).active_tag_uid && (
              verifiedTagUid ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderWidth: 2, borderColor: Colors.success, borderRadius: 8, marginBottom: 10 }}>
                  <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                  <Text style={{ color: Colors.success, fontWeight: '700', fontSize: 13 }}>Tag verified</Text>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={scanTagForCheck}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderWidth: 2, borderColor: Colors.warning, borderRadius: 8, marginBottom: 10 }}
                >
                  <Ionicons name="scan-outline" size={18} color={Colors.warning} />
                  <Text style={{ color: Colors.warning, fontWeight: '700', fontSize: 13 }}>Scan tag to begin</Text>
                </TouchableOpacity>
              )
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {CONDITIONS.map(o => (
                <TouchableOpacity key={o.v} onPress={() => setCond(o.v)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 2,
                    borderColor: cond === o.v ? o.c : Colors.border,
                    backgroundColor: cond === o.v ? o.c + '20' : '#fff',
                  }}>
                  <Text style={{ fontSize: 13, fontWeight: cond === o.v ? '700' : '500', color: cond === o.v ? o.c : Colors.textSecondary }}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.input} value={hrs} onChangeText={setHrs} placeholder="Hours reading" keyboardType="decimal-pad"
              returnKeyType="done" onSubmitEditing={Keyboard.dismiss} blurOnSubmit
              inputAccessoryViewID={Platform.OS === 'ios' ? 'scanDoneBar' : undefined}
              placeholderTextColor={Colors.textLight} />
            <TextInput style={[styles.input, { marginTop: 8, height: 72, textAlignVertical: 'top' }]} value={notes} onChangeText={setNotes} placeholder="Notes..." multiline
              inputAccessoryViewID={Platform.OS === 'ios' ? 'scanDoneBar' : undefined}
              placeholderTextColor={Colors.textLight} />

            <TouchableOpacity
              style={styles.photoBtn}
              onPress={async () => {
                const picked = await takeOrPickPhoto(true)
                if (picked.length) setPhotos(prev => [...prev, ...picked].slice(0, 10))
              }}
            >
              <Ionicons name="camera-outline" size={16} color={Colors.primary} />
              <Text style={{ ...Typography.caption, fontWeight: '600', color: Colors.primary, marginLeft: 4 }}>
                {photos.length > 0 ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : 'Add Photos'}
              </Text>
            </TouchableOpacity>
            {photos.length > 0 && (
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                {photos.map((p, i) => (
                  <TouchableOpacity key={i} onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))}>
                    <Image source={{ uri: p.uri }} style={{ width: 50, height: 50, borderRadius: 6 }} />
                    <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: '#dc3545', borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="close" size={10} color="#fff" />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {(() => {
              const tagRequired = !!(machine as any).active_tag_uid
              const disabled = submitting || (tagRequired && !verifiedTagUid)
              return (
                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: '#28a745', opacity: disabled ? 0.5 : 1 }]}
                  onPress={submitCheck}
                  disabled={disabled}
                >
                  {submitting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.submitBtnText}>
                        {tagRequired && !verifiedTagUid ? 'Scan tag to enable' : 'Submit Check'}
                      </Text>}
                </TouchableOpacity>
              )
            })()}
          </Card>
        )}
      </ScrollView>

      {/* NFC scanning modal */}
      <Modal visible={scanningForCheck} transparent animationType="fade"
        onRequestClose={() => {
          NfcManager?.cancelTechnologyRequest().catch(() => {})
          setScanningForCheck(false)
        }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: Spacing.lg }}>
          <View style={{ backgroundColor: '#fff', padding: Spacing.lg, borderRadius: BorderRadius.lg, maxWidth: 400, width: '100%' }}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={{ ...Typography.h4, color: Colors.textPrimary, marginTop: Spacing.md, textAlign: 'center' }}>
              Hold NFC tag near device
            </Text>
            <Text style={{ ...Typography.bodySmall, color: Colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
              Scan the tag on {machine?.name || 'this machine'} to verify.
            </Text>
            <TouchableOpacity
              onPress={() => {
                NfcManager?.cancelTechnologyRequest().catch(() => {})
                setScanningForCheck(false)
              }}
              style={{ marginTop: Spacing.md, alignSelf: 'center', padding: Spacing.sm }}
            >
              <Text style={{ color: Colors.textSecondary }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Full Details + History popup — one modal with a segmented switch so
          we don't need to re-render the sheet when toggling views. */}
      <InfoModal
        visible={!!infoModal}
        mode={infoModal}
        setMode={setInfoModal}
        scanInfo={machine as any}
        detail={fullDetail as any}
        detailLoading={detailLoading}
        onClose={() => setInfoModal(null)}
      />

      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID="scanDoneBar">
          <View style={{ backgroundColor: '#f1f3f5', padding: 8, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <TouchableOpacity onPress={Keyboard.dismiss} style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
              <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 15 }}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
    </SafeAreaView>
  )
}

// ── Compliance warnings block ────────────────────────────────────────────────

interface ComplianceItem {
  kind: string
  label: string
  interval_days: number | null
  interval_unit: string | null
  last_done_date: string | null
  next_due_date: string | null
  days_until_due: number | null
}

interface MachineForCompliance {
  next_inspection_date?: string | null
  warranty_expiry?: string | null
  dispose_by_date?: string | null
  compliance_items?: ComplianceItem[]
}

function ComplianceWarnings({ machine }: { machine: MachineForCompliance }) {
  type Row = {
    icon: string
    label: string
    status: 'overdue' | 'critical' | 'soon' | 'ok'
    days: number
    dateStr: string
  }

  const rows: Row[] = []

  const pushDate = (label: string, iso: string | null | undefined, icon: string) => {
    if (!iso) return
    const target = new Date(iso + 'T00:00:00')
    const days = Math.ceil((target.getTime() - Date.now()) / 86400000)
    let status: Row['status']
    if (days < 0) status = 'overdue'
    else if (days <= 3) status = 'critical'
    else if (days <= 30) status = 'soon'
    else status = 'ok'
    rows.push({ icon, label, status, days, dateStr: formatDate(iso) })
  }

  pushDate('Inspection', machine.next_inspection_date, 'search-outline')
  pushDate('Warranty', machine.warranty_expiry, 'shield-outline')
  pushDate('Dispose-by', machine.dispose_by_date, 'trash-outline')

  const iconForKind = (kind: string) =>
    kind === 'service' ? 'build-outline'
    : kind === 'test_tag' ? 'flash-outline'
    : kind === 'calibration' ? 'speedometer-outline'
    : kind === 'annual_cert' ? 'ribbon-outline'
    : 'checkmark-circle-outline'

  for (const item of machine.compliance_items || []) {
    if (!item.next_due_date) {
      // Only flag no-baseline items if the interval is configured and
      // time-based (usage-based intervals have no due date by design).
      if (item.interval_days && ['days', 'weeks', 'months', 'years'].includes(item.interval_unit || '')) {
        rows.push({
          icon: iconForKind(item.kind),
          label: item.label,
          status: 'soon',
          days: 0,
          dateStr: 'No baseline — log last completion',
        })
      }
      continue
    }
    pushDate(item.label, item.next_due_date, iconForKind(item.kind))
  }

  // Filter out the "ok" ones (more than 30 days away) — we only show warnings.
  const visible = rows.filter((r) => r.status !== 'ok')
  if (visible.length === 0) return null

  // Sort worst first
  const order = { overdue: 0, critical: 1, soon: 2, ok: 3 }
  visible.sort((a, b) => order[a.status] - order[b.status] || a.days - b.days)

  return (
    <>
      {visible.map((r, i) => {
        const bg = r.status === 'overdue' ? '#f8d7da'
                 : r.status === 'critical' ? '#fff3cd'
                 : '#cff4fc'
        const fg = r.status === 'overdue' ? '#842029'
                 : r.status === 'critical' ? '#664d03'
                 : '#055160'
        const headline = r.status === 'overdue'
          ? `${r.label} overdue by ${-r.days} day${-r.days === 1 ? '' : 's'}`
          : r.days === 0 ? `${r.label} due today`
          : r.status === 'soon' && r.dateStr.startsWith('No baseline')
          ? `${r.label} baseline missing`
          : `${r.label} due in ${r.days} day${r.days === 1 ? '' : 's'}`
        return (
          <View key={i} style={[styles.alertDanger, { backgroundColor: bg, borderColor: fg + '55' }]}>
            <Ionicons name={r.icon as any} size={18} color={fg} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...Typography.bodySmall, fontWeight: '700', color: fg }}>{headline}</Text>
              <Text style={{ ...Typography.caption, color: fg }}>{r.dateStr}</Text>
            </View>
          </View>
        )
      })}
    </>
  )
}

// ── Details / History popup ──────────────────────────────────────────────────

function InfoModal({ visible, mode, setMode, scanInfo, detail, detailLoading, onClose }: {
  visible: boolean
  mode: 'details' | 'history' | null
  setMode: (m: 'details' | 'history') => void
  scanInfo: any
  detail: any
  detailLoading: boolean
  onClose: () => void
}) {
  const m = scanInfo
  if (!m) return null

  const Row = ({ label, value }: { label: string; value: any }) => {
    if (value == null || value === '') return null
    return (
      <View style={infoStyles.row}>
        <Text style={infoStyles.label}>{label}</Text>
        <Text style={infoStyles.value}>{String(value)}</Text>
      </View>
    )
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top', 'bottom']}>
        <View style={infoStyles.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: Colors.textLight, fontSize: 15 }}>Close</Text>
          </TouchableOpacity>
          <Text style={infoStyles.title} numberOfLines={1}>{m.name}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={infoStyles.headerAccent} />
        <View style={infoStyles.segmentWrap}>
          <TouchableOpacity
            style={[infoStyles.segment, mode === 'details' && infoStyles.segmentActive]}
            onPress={() => setMode('details')}
          >
            <Text style={[infoStyles.segmentText, mode === 'details' && infoStyles.segmentTextActive]}>Details</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[infoStyles.segment, mode === 'history' && infoStyles.segmentActive]}
            onPress={() => setMode('history')}
          >
            <Text style={[infoStyles.segmentText, mode === 'history' && infoStyles.segmentTextActive]}>History</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: Spacing.xl * 2 }}>
          {mode === 'details' ? (
            <>
              <View style={infoStyles.section}>
                <Text style={infoStyles.sectionTitle}>Identification</Text>
                <Row label="Plant ID" value={m.plant_id} />
                <Row label="Type" value={m.type} />
                <Row label="Manufacturer" value={m.manufacturer} />
                <Row label="Model" value={m.model_number} />
                <Row label="Serial" value={m.serial_number} />
                <Row label="Engine #" value={m.engine_number} />
                <Row label="Site" value={m.project_name} />
              </View>

              <View style={infoStyles.section}>
                <Text style={infoStyles.sectionTitle}>Lifecycle</Text>
                <Row label="Acquired" value={m.acquired_date ? formatDate(m.acquired_date) : null} />
                <Row label="Built" value={m.build_date ? formatDate(m.build_date) : null} />
                <Row label="Warranty until" value={m.warranty_expiry ? formatDate(m.warranty_expiry) : null} />
                <Row label="Dispose by" value={m.dispose_by_date ? formatDate(m.dispose_by_date) : null} />
              </View>

              <View style={infoStyles.section}>
                <Text style={infoStyles.sectionTitle}>Inspections &amp; Compliance</Text>
                <Row label="Next inspection" value={m.next_inspection_date ? formatDate(m.next_inspection_date) : null} />
                <Row label="Interval" value={m.inspection_interval_days ? `${m.inspection_interval_days} days` : null} />
                {(m.compliance_items || []).map((ci: ComplianceItem) => (
                  <View key={ci.kind} style={infoStyles.row}>
                    <Text style={infoStyles.label}>{ci.label}</Text>
                    <Text style={infoStyles.value}>
                      {ci.next_due_date
                        ? `Next ${formatDate(ci.next_due_date)}`
                        : ci.interval_days
                        ? `every ${ci.interval_days} ${ci.interval_unit}`
                        : 'Not configured'}
                      {ci.last_done_date ? `  ·  last ${formatDate(ci.last_done_date)}` : ''}
                    </Text>
                  </View>
                ))}
                {(!m.compliance_items || m.compliance_items.length === 0) && (
                  <Text style={infoStyles.empty}>No service / test obligations configured.</Text>
                )}
              </View>

              {(m.description || m.service_instructions || m.storage_instructions || m.spare_parts_notes) && (
                <View style={infoStyles.section}>
                  <Text style={infoStyles.sectionTitle}>Notes</Text>
                  {m.description ? <Text style={infoStyles.noteText}>{m.description}</Text> : null}
                  {m.service_instructions ? (
                    <>
                      <Text style={infoStyles.subLabel}>Service instructions</Text>
                      <Text style={infoStyles.noteText}>{m.service_instructions}</Text>
                    </>
                  ) : null}
                  {m.storage_instructions ? (
                    <>
                      <Text style={infoStyles.subLabel}>Storage instructions</Text>
                      <Text style={infoStyles.noteText}>{m.storage_instructions}</Text>
                    </>
                  ) : null}
                  {m.spare_parts_notes ? (
                    <>
                      <Text style={infoStyles.subLabel}>Spare parts</Text>
                      <Text style={infoStyles.noteText}>{m.spare_parts_notes}</Text>
                    </>
                  ) : null}
                </View>
              )}
            </>
          ) : (
            <>
              {detailLoading ? (
                <ActivityIndicator style={{ marginTop: 40 }} color={Colors.primary} />
              ) : (
                <>
                  <View style={infoStyles.section}>
                    <Text style={infoStyles.sectionTitle}>Recent Pre-Starts</Text>
                    {detail?.daily_checks?.length ? detail.daily_checks.map((c: any) => {
                      const cond = CONDITIONS.find((o) => o.v === c.condition)
                      return (
                        <View key={c.id} style={infoStyles.historyItem}>
                          <View style={{ flex: 1 }}>
                            <Text style={infoStyles.historyDate}>{formatDate(c.check_date)}</Text>
                            {c.checked_by ? <Text style={infoStyles.historyMeta}>by {c.checked_by}</Text> : null}
                            {c.hours_reading != null ? <Text style={infoStyles.historyMeta}>{c.hours_reading} hrs</Text> : null}
                            {c.notes ? <Text style={infoStyles.historyNote} numberOfLines={2}>{c.notes}</Text> : null}
                          </View>
                          {cond && (
                            <View style={{ backgroundColor: cond.c + '22', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                              <Text style={{ color: cond.c, fontSize: 11, fontWeight: '700' }}>{cond.l}</Text>
                            </View>
                          )}
                        </View>
                      )
                    }) : <Text style={infoStyles.empty}>No pre-starts recorded yet.</Text>}
                  </View>

                  <View style={infoStyles.section}>
                    <Text style={infoStyles.sectionTitle}>Breakdown History</Text>
                    {detail?.breakdowns?.length ? detail.breakdowns.map((b: any) => (
                      <View key={b.id} style={infoStyles.historyItem}>
                        <View style={{ flex: 1 }}>
                          <Text style={infoStyles.historyDate}>{formatDate(b.date)}</Text>
                          {b.description ? <Text style={infoStyles.historyNote} numberOfLines={3}>{b.description}</Text> : null}
                          {b.repairing_by ? <Text style={infoStyles.historyMeta}>Repairing: {b.repairing_by}</Text> : null}
                        </View>
                        <View style={{
                          backgroundColor: b.repair_status === 'completed' ? '#d1e7dd' : '#f8d7da',
                          paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
                        }}>
                          <Text style={{
                            color: b.repair_status === 'completed' ? '#0f5132' : '#842029',
                            fontSize: 11, fontWeight: '700',
                          }}>
                            {(b.repair_status || 'pending').replace('_', ' ')}
                          </Text>
                        </View>
                      </View>
                    )) : <Text style={infoStyles.empty}>No breakdowns recorded.</Text>}
                  </View>
                </>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const infoStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.dark, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 4 },
  headerAccent: { height: 3, backgroundColor: Colors.primary },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 16, fontWeight: '600', marginHorizontal: Spacing.sm },
  segmentWrap: { flexDirection: 'row', backgroundColor: Colors.surface, padding: 4, margin: Spacing.md, borderRadius: BorderRadius.sm, gap: 4 },
  segment: { flex: 1, paddingVertical: Spacing.xs + 2, alignItems: 'center', borderRadius: BorderRadius.sm },
  segmentActive: { backgroundColor: Colors.primary },
  segmentText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  segmentTextActive: { color: Colors.dark, fontWeight: '700' },
  section: {
    backgroundColor: '#fff', borderRadius: BorderRadius.md,
    padding: Spacing.md, marginBottom: Spacing.md,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07, shadowRadius: 4, elevation: 2,
  },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: Colors.textSecondary, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', paddingVertical: 4 },
  label: { width: 120, fontSize: 12, color: Colors.textSecondary },
  value: { flex: 1, fontSize: 13, color: Colors.textPrimary, fontWeight: '500' },
  noteText: { fontSize: 13, color: Colors.textPrimary, marginTop: 4, lineHeight: 18 },
  subLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { fontSize: 12, color: Colors.textLight, fontStyle: 'italic' },
  historyItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  historyDate: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  historyMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  historyNote: { fontSize: 12, color: Colors.textPrimary, marginTop: 4, lineHeight: 16 },
})

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.dark, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  headerAccent: { height: 3, backgroundColor: Colors.primary },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 16, fontWeight: '600' },
  backBtn: { padding: Spacing.xs },
  photo: { width: 120, height: 120, borderRadius: BorderRadius.md, marginBottom: Spacing.sm },
  photoPlaceholder: {
    width: 120, height: 120, borderRadius: BorderRadius.md, backgroundColor: '#eef1f4',
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm,
  },
  alertDanger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f8d7da', padding: Spacing.sm + 2, borderRadius: BorderRadius.md,
    marginTop: Spacing.sm + 2,
  },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md,
  },
  actionBtn: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    padding: Spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  actionText: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm,
    padding: Spacing.sm, fontSize: 14, color: Colors.textPrimary, backgroundColor: '#fff',
  },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.sm, padding: Spacing.xs,
    borderWidth: 1, borderColor: Colors.primary, borderRadius: BorderRadius.sm,
    borderStyle: 'dashed',
  },
  submitBtn: {
    marginTop: Spacing.md, padding: Spacing.sm,
    borderRadius: BorderRadius.md, alignItems: 'center',
  },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
})
