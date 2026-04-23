import { useState } from 'react'
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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import Card from '../../components/ui/Card'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { api } from '../../lib/api'
import { cachedQuery } from '../../lib/cachedQuery'
import { compressImage } from '../../lib/compressImage'
import { formatDate } from '../../lib/dates'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { useToastStore } from '../../store/toast'

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

  const { data: machine, isLoading, isError } = useQuery({
    queryKey: ['machine', id],
    queryFn: () => cachedQuery(`machine_${id}`, () =>
      api.equipment.detail(Number(id)).then(r => r.data)),
    staleTime: 2 * 60 * 1000,
  })

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)/equipment')
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

  const submitCheck = async () => {
    if (!activeProject?.id) {
      show('Select a project first', 'error')
      return
    }
    if (!machine) return
    setSubmitting(true)
    try {
      await api.equipment.submitDailyCheck({
        machine_id: machine.id,
        project_id: activeProject.id,
        condition: cond,
        notes: notes || undefined,
        hours_reading: hrs || undefined,
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

        {/* Action grid */}
        <View style={styles.grid}>
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: '#28a745', backgroundColor: panel === 'check' ? 'rgba(40,167,69,0.12)' : '#fff' }]}
            onPress={() => setPanel(panel === 'check' ? null : 'check')}
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
            onPress={() => router.push({ pathname: '/machine/[id]', params: { id: String(machine.id) } })}
          >
            <Ionicons name="list-outline" size={28} color="#1565C0" />
            <Text style={[styles.actionText, { color: '#1565C0' }]}>Full Details</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: Colors.textSecondary }]}
            onPress={() => router.push({ pathname: '/machine/[id]', params: { id: String(machine.id) } })}
          >
            <Ionicons name="time-outline" size={28} color={Colors.textSecondary} />
            <Text style={[styles.actionText, { color: Colors.textSecondary }]}>History</Text>
          </TouchableOpacity>
        </View>

        {/* Inline check panel */}
        {panel === 'check' && (
          <Card style={{ borderLeftWidth: 3, borderLeftColor: '#28a745', marginTop: Spacing.md }}>
            <Text style={{ ...Typography.bodySmall, fontWeight: '700', color: '#28a745', marginBottom: 8 }}>Pre-Start Check</Text>
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
            <TextInput style={styles.input} value={hrs} onChangeText={setHrs} placeholder="Hours reading" keyboardType="decimal-pad" placeholderTextColor={Colors.textLight} />
            <TextInput style={[styles.input, { marginTop: 8, height: 72, textAlignVertical: 'top' }]} value={notes} onChangeText={setNotes} placeholder="Notes..." multiline placeholderTextColor={Colors.textLight} />

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

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: '#28a745' }]}
              onPress={submitCheck}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.submitBtnText}>Submit Check</Text>}
            </TouchableOpacity>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.dark, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 16, fontWeight: '600' },
  backBtn: { padding: Spacing.xs },
  photo: { width: 120, height: 120, borderRadius: BorderRadius.md, marginBottom: Spacing.sm },
  photoPlaceholder: {
    width: 120, height: 120, borderRadius: BorderRadius.md, backgroundColor: '#eef1f4',
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm,
  },
  alertDanger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f8d7da', padding: Spacing.sm, borderRadius: BorderRadius.md,
    marginTop: Spacing.md, borderWidth: 1, borderColor: '#f1aeb5',
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
