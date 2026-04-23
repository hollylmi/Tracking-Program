import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, TextInput, Modal, Image, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { api } from '../../lib/api'
import { compressImage } from '../../lib/compressImage'
import { formatDate } from '../../lib/dates'
import { useToastStore } from '../../store/toast'

let NfcManager: any = null
let NfcTech: any = null
try {
  const nfc = require('react-native-nfc-manager')
  NfcManager = nfc.default
  NfcTech = nfc.NfcTech
} catch {}

type TransferItem = {
  id: number
  machine_id: number
  machine_name: string | null
  plant_id: string | null
  status: string
  pre_checked: boolean
  arrived: boolean
  active_tag_uid: string | null
  pre_check_condition: string | null
  arrival_check_condition: string | null
}

const CONDITIONS = [
  { v: 'good', l: 'Good', c: '#28a745' },
  { v: 'fair', l: 'Fair', c: '#fd7e14' },
  { v: 'poor', l: 'Poor', c: '#E65100' },
  { v: 'broken_down', l: 'Broken Down', c: '#dc3545' },
]

export default function TransferBatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { show } = useToastStore()
  const queryClient = useQueryClient()
  const batchId = Number(id)

  const { data: batch, isLoading, refetch } = useQuery({
    queryKey: ['transfer-batch', batchId],
    queryFn: () => api.equipment.getTransferBatch(batchId).then(r => r.data),
    enabled: !!batchId,
  })

  // Which stage are we prompting for?
  const [activeItem, setActiveItem] = useState<TransferItem | null>(null)
  const [stage, setStage] = useState<'pre_check' | 'arrive' | null>(null)

  // NFC scan state
  const [scanning, setScanning] = useState(false)
  const [verifiedUid, setVerifiedUid] = useState<string | null>(null)

  // Form state
  const [cond, setCond] = useState('good')
  const [hrs, setHrs] = useState('')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<{ uri: string; filename: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const resetForm = useCallback(() => {
    setCond('good')
    setHrs('')
    setNotes('')
    setPhoto(null)
    setVerifiedUid(null)
  }, [])

  const closeForm = () => {
    setActiveItem(null)
    setStage(null)
    resetForm()
  }

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)/index' as any)
  }

  const startFlow = (item: TransferItem, kind: 'pre_check' | 'arrive') => {
    resetForm()
    setActiveItem(item)
    setStage(kind)
    // If the machine has a registered active tag, require NFC verification first.
    // Otherwise skip straight to the form (older machines without NFC).
    if (item.active_tag_uid) {
      triggerNfcScan(item)
    }
  }

  const triggerNfcScan = async (item: TransferItem) => {
    if (!NfcManager) {
      Alert.alert('NFC Not Available', 'This device does not support NFC.')
      return
    }
    setScanning(true)
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef)
      const tag = await NfcManager.getTag()
      const uid: string | undefined = tag?.id
      NfcManager.cancelTechnologyRequest().catch(() => {})
      setScanning(false)
      if (!uid) {
        Alert.alert('Scan Failed', 'Could not read the NFC tag.')
        return
      }
      if (item.active_tag_uid && uid !== item.active_tag_uid) {
        Alert.alert(
          'Wrong Machine',
          `That tag does not match "${item.machine_name}". Make sure you're scanning the correct equipment.`,
        )
        return
      }
      setVerifiedUid(uid)
      show('Tag verified. Fill in the check details.', 'success')
    } catch (e: any) {
      NfcManager.cancelTechnologyRequest().catch(() => {})
      setScanning(false)
      if (e?.message !== 'cancelled') {
        Alert.alert('Scan Failed', 'Could not read the NFC tag.')
      }
    }
  }

  const takeOrPickPhoto = async () => {
    Alert.alert('Add Photo', '', [
      {
        text: 'Camera',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync()
          if (perm.status !== 'granted') return
          const r = await ImagePicker.launchCameraAsync({ quality: 0.8 })
          if (!r.canceled && r.assets.length > 0) {
            const uri = await compressImage(r.assets[0].uri)
            setPhoto({ uri, filename: `transfer_${Date.now()}.jpg` })
          }
        },
      },
      {
        text: 'Photo Library',
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
          if (perm.status !== 'granted') return
          const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 })
          if (!r.canceled && r.assets.length > 0) {
            const uri = await compressImage(r.assets[0].uri)
            setPhoto({ uri, filename: `transfer_${Date.now()}.jpg` })
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const submitCheck = async () => {
    if (!activeItem || !stage) return
    if (activeItem.active_tag_uid && !verifiedUid) {
      Alert.alert('Tag Scan Required', 'Please scan the NFC tag on this machine first.')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        condition: cond,
        hours_reading: hrs || undefined,
        notes: notes || undefined,
        tag_uid: verifiedUid || undefined,
        photo_uri: photo?.uri,
        photo_filename: photo?.filename,
      }
      if (stage === 'pre_check') {
        await api.equipment.submitTransferPreCheck(activeItem.id, payload)
        show('Pre-move check recorded.', 'success')
      } else {
        await api.equipment.submitTransferArrival(activeItem.id, payload)
        show('Arrival check recorded. Machine transferred.', 'success')
      }
      queryClient.invalidateQueries({ queryKey: ['transfer-batch', batchId] })
      queryClient.invalidateQueries({ queryKey: ['my-todos'] })
      await refetch()
      closeForm()
    } catch (e: any) {
      const body = e?.body || {}
      Alert.alert(
        stage === 'pre_check' ? 'Pre-check Failed' : 'Arrival Failed',
        body.error || e?.message || 'Could not save the check.',
      )
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

  if (!batch) {
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
          Transfer not found.
        </Text>
      </SafeAreaView>
    )
  }

  const allPreChecked = batch.items.every(i => i.pre_checked)
  const allArrived = batch.items.every(i => i.arrived)

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Transfer · {batch.from_project.name} → {batch.to_project.name}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: Spacing.xl * 2 }}>
        <View style={styles.summaryCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ ...Typography.caption, color: Colors.textSecondary }}>Status</Text>
            <View style={[
              styles.statusPill,
              batch.status === 'in_transit' ? { backgroundColor: '#fff3cd' }
              : batch.status === 'completed' ? { backgroundColor: '#d1e7dd' }
              : { backgroundColor: '#cff4fc' },
            ]}>
              <Text style={{
                ...Typography.caption, fontWeight: '700',
                color: batch.status === 'in_transit' ? '#664d03'
                     : batch.status === 'completed' ? '#0a3622'
                     : '#055160',
              }}>
                {batch.status.replace('_', ' ').toUpperCase()}
              </Text>
            </View>
          </View>
          <View style={{ marginTop: Spacing.xs }}>
            <Text style={{ ...Typography.bodySmall, color: Colors.textPrimary }}>
              Scheduled: {formatDate(batch.scheduled_date)}
            </Text>
            {batch.transport_contact ? (
              <Text style={{ ...Typography.bodySmall, color: Colors.textSecondary }}>
                Driver: {batch.transport_contact}
              </Text>
            ) : null}
            {batch.pickup_location ? (
              <Text style={{ ...Typography.caption, color: Colors.textSecondary, marginTop: 2 }}>
                Pickup: {batch.pickup_location}
              </Text>
            ) : null}
            {batch.dropoff_location ? (
              <Text style={{ ...Typography.caption, color: Colors.textSecondary }}>
                Dropoff: {batch.dropoff_location}
              </Text>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm }}>
            <Text style={{ ...Typography.caption, color: allPreChecked ? Colors.success : Colors.textSecondary, fontWeight: '600' }}>
              Pre-checks: {batch.items.filter(i => i.pre_checked).length}/{batch.items.length}
            </Text>
            <Text style={{ ...Typography.caption, color: allArrived ? Colors.success : Colors.textSecondary, fontWeight: '600' }}>
              Arrivals: {batch.items.filter(i => i.arrived).length}/{batch.items.length}
            </Text>
          </View>
        </View>

        {/* Items */}
        {batch.items.map(item => {
          const needsPreCheck = !item.pre_checked && batch.status === 'scheduled'
          const needsArrival = item.pre_checked && !item.arrived && batch.status === 'in_transit'
          return (
            <View key={item.id} style={styles.itemCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...Typography.body, fontWeight: '700', color: Colors.textPrimary }}>
                    {item.machine_name}
                  </Text>
                  {item.plant_id ? (
                    <Text style={{ ...Typography.caption, color: Colors.textSecondary }}>
                      Plant ID: {item.plant_id}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {item.pre_checked ? (
                    <Text style={{ ...Typography.caption, color: Colors.success }}>
                      <Ionicons name="checkmark-circle" size={12} color={Colors.success} /> Pre-checked
                    </Text>
                  ) : null}
                  {item.arrived ? (
                    <Text style={{ ...Typography.caption, color: Colors.success }}>
                      <Ionicons name="checkmark-circle" size={12} color={Colors.success} /> Arrived
                    </Text>
                  ) : null}
                </View>
              </View>

              {!item.active_tag_uid && (
                <Text style={{ ...Typography.caption, color: Colors.textLight, marginTop: 4, fontStyle: 'italic' }}>
                  No NFC tag registered — check can still be submitted manually.
                </Text>
              )}

              {needsPreCheck && (
                <TouchableOpacity
                  style={[styles.itemAction, { borderColor: '#28a745' }]}
                  onPress={() => startFlow(item, 'pre_check')}
                >
                  <Ionicons
                    name={item.active_tag_uid ? 'scan-outline' : 'checkmark-circle-outline'}
                    size={16} color="#28a745"
                  />
                  <Text style={{ color: '#28a745', fontWeight: '700', fontSize: 13 }}>
                    {item.active_tag_uid ? 'Scan to Pre-Check' : 'Record Pre-Check'}
                  </Text>
                </TouchableOpacity>
              )}
              {needsArrival && (
                <TouchableOpacity
                  style={[styles.itemAction, { borderColor: '#0d6efd' }]}
                  onPress={() => startFlow(item, 'arrive')}
                >
                  <Ionicons
                    name={item.active_tag_uid ? 'scan-outline' : 'checkmark-done-outline'}
                    size={16} color="#0d6efd"
                  />
                  <Text style={{ color: '#0d6efd', fontWeight: '700', fontSize: 13 }}>
                    {item.active_tag_uid ? 'Scan to Confirm Arrival' : 'Record Arrival'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )
        })}
      </ScrollView>

      {/* NFC scan modal */}
      <Modal visible={scanning} transparent animationType="fade"
        onRequestClose={() => {
          NfcManager?.cancelTechnologyRequest().catch(() => {})
          setScanning(false)
        }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={{ ...Typography.h4, color: Colors.textPrimary, marginTop: Spacing.md, textAlign: 'center' }}>
              Scan the NFC tag
            </Text>
            <Text style={{ ...Typography.bodySmall, color: Colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
              Hold your phone against the tag on {activeItem?.machine_name || 'this machine'}.
            </Text>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: Colors.border, marginTop: Spacing.md, alignSelf: 'center' }]}
              onPress={() => {
                NfcManager?.cancelTechnologyRequest().catch(() => {})
                setScanning(false)
              }}
            >
              <Text style={{ color: Colors.textPrimary }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Form modal (shown after tag scan) */}
      <Modal visible={!!activeItem && !scanning} transparent animationType="slide"
        onRequestClose={closeForm}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 480 }]}>
            <Text style={{ ...Typography.h4, color: Colors.textPrimary }}>
              {stage === 'pre_check' ? 'Pre-Move Check' : 'Arrival Check'}
            </Text>
            <Text style={{ ...Typography.bodySmall, color: Colors.textSecondary, marginBottom: Spacing.sm }}>
              {activeItem?.machine_name}
            </Text>

            {activeItem?.active_tag_uid && !verifiedUid && (
              <TouchableOpacity
                style={[styles.itemAction, { borderColor: Colors.warning, marginBottom: Spacing.sm }]}
                onPress={() => activeItem && triggerNfcScan(activeItem)}
              >
                <Ionicons name="scan-outline" size={16} color={Colors.warning} />
                <Text style={{ color: Colors.warning, fontWeight: '700' }}>Scan Tag First</Text>
              </TouchableOpacity>
            )}
            {verifiedUid && (
              <View style={[styles.itemAction, { borderColor: Colors.success, marginBottom: Spacing.sm }]}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                <Text style={{ color: Colors.success, fontWeight: '700' }}>Tag verified</Text>
              </View>
            )}

            <Text style={styles.label}>Condition</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: Spacing.sm }}>
              {CONDITIONS.map(o => (
                <TouchableOpacity key={o.v} onPress={() => setCond(o.v)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 2,
                    borderColor: cond === o.v ? o.c : Colors.border,
                    backgroundColor: cond === o.v ? o.c + '20' : '#fff',
                  }}>
                  <Text style={{ fontSize: 12, fontWeight: cond === o.v ? '700' : '500', color: cond === o.v ? o.c : Colors.textSecondary }}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput style={styles.input} value={hrs} onChangeText={setHrs}
              placeholder="Hours reading" keyboardType="decimal-pad"
              placeholderTextColor={Colors.textLight} />
            <TextInput style={[styles.input, { marginTop: 6, height: 60, textAlignVertical: 'top' }]}
              value={notes} onChangeText={setNotes} placeholder="Notes..." multiline
              placeholderTextColor={Colors.textLight} />

            <TouchableOpacity style={[styles.itemAction, { marginTop: 6 }]} onPress={takeOrPickPhoto}>
              <Ionicons name="camera-outline" size={16} color={Colors.primary} />
              <Text style={{ color: Colors.primary, fontWeight: '600' }}>
                {photo ? 'Photo attached' : 'Add Photo (optional)'}
              </Text>
            </TouchableOpacity>
            {photo && <Image source={{ uri: photo.uri }} style={{ width: 70, height: 70, borderRadius: 6, marginTop: 4 }} />}

            <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: Colors.border }]} onPress={closeForm}>
                <Text style={{ color: Colors.textPrimary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, {
                  backgroundColor: stage === 'pre_check' ? '#28a745' : '#0d6efd',
                  opacity: submitting ? 0.6 : 1,
                }]}
                disabled={submitting}
                onPress={submitCheck}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>
                      {stage === 'pre_check' ? 'Submit Pre-Check' : 'Submit Arrival'}
                    </Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.dark, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: '600' },
  backBtn: { padding: Spacing.xs },
  summaryCard: {
    backgroundColor: '#fff', padding: Spacing.md,
    borderRadius: BorderRadius.md, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  statusPill: {
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 10,
  },
  itemCard: {
    backgroundColor: '#fff', padding: Spacing.md,
    borderRadius: BorderRadius.md, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
    gap: Spacing.xs,
  },
  itemAction: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.sm, borderWidth: 2, alignSelf: 'flex-start',
    marginTop: Spacing.xs,
  },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: '#fff', padding: Spacing.lg,
    borderRadius: BorderRadius.lg, width: '100%', maxWidth: 420,
  },
  modalBtn: {
    flex: 1, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm, alignItems: 'center', justifyContent: 'center',
  },
  label: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600', marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm,
    padding: Spacing.sm, fontSize: 14, color: Colors.textPrimary, backgroundColor: '#fff',
  },
})
