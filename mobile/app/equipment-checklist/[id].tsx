import { useState, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import ScreenHeader from '../../components/layout/ScreenHeader'
import Card from '../../components/ui/Card'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { useToastStore } from '../../store/toast'
import { useChecklist } from '../../hooks/useEquipment'
import { api } from '../../lib/api'
import { compressImage } from '../../lib/compressImage'
import { EquipmentChecklistItem } from '../../types'

const CONDITION_OPTIONS: { value: string; label: string; color: string; bg: string }[] = [
  { value: 'good', label: 'Good', color: Colors.success, bg: 'rgba(61,139,65,0.15)' },
  { value: 'fair', label: 'Fair', color: Colors.warning, bg: 'rgba(201,106,0,0.15)' },
  { value: 'poor', label: 'Poor', color: '#E65100', bg: 'rgba(230,81,0,0.15)' },
  { value: 'broken_down', label: 'Broken Down', color: Colors.error, bg: 'rgba(198,40,40,0.15)' },
]

import { formatDate as fmtDateAU } from '../../lib/dates'

function formatDate(d: string | null) {
  return fmtDateAU(d, { day: 'numeric', month: 'short', year: 'numeric' })
}

function ChecklistItemCard({
  item,
  onCheck,
}: {
  item: EquipmentChecklistItem
  onCheck: () => void
}) {
  const condOpt = CONDITION_OPTIONS.find((c) => c.value === item.condition)

  return (
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: item.checked ? 'rgba(61,139,65,0.12)' : Colors.background }]}>
          <Ionicons
            name={item.checked ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={item.checked ? Colors.success : Colors.textLight}
          />
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{item.machine_label}</Text>
          {item.checked && item.checked_by ? (
            <Text style={styles.type}>
              Checked by {item.checked_by}
              {item.checked_at ? ` — ${new Date(item.checked_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
            </Text>
          ) : null}
          {item.notes ? <Text style={styles.type}>{item.notes}</Text> : null}
        </View>
        <View style={styles.right}>
          {item.checked && condOpt ? (
            <View style={[styles.conditionPill, { backgroundColor: condOpt.bg }]}>
              <Text style={[styles.conditionText, { color: condOpt.color }]}>{condOpt.label}</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.checkBtn} onPress={onCheck} activeOpacity={0.8}>
              <Text style={styles.checkBtnText}>Check</Text>
            </TouchableOpacity>
          )}
          {item.photo_url ? (
            <Ionicons name="image-outline" size={16} color={Colors.textLight} />
          ) : null}
        </View>
      </View>
    </Card>
  )
}

function CheckModal({
  visible,
  machineName,
  onClose,
  onSubmit,
}: {
  visible: boolean
  machineName: string
  onClose: () => void
  onSubmit: (condition: string, notes: string, photoUri?: string, photoFilename?: string) => Promise<void>
}) {
  const [condition, setCondition] = useState('good')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<{ uri: string; filename: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await onSubmit(condition, notes, photo?.uri, photo?.filename)
      setCondition('good')
      setNotes('')
      setPhoto(null)
    } finally {
      setSubmitting(false)
    }
  }

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Camera access is needed.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    })
    if (!result.canceled && result.assets.length > 0) {
      const compressed = await compressImage(result.assets[0].uri)
      setPhoto({ uri: compressed, filename: `cl_${Date.now()}.jpg` })
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modalStyles.root} edges={['top', 'bottom']}>
        <View style={modalStyles.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={modalStyles.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={modalStyles.title} numberOfLines={1}>{machineName}</Text>
          <TouchableOpacity onPress={handleSubmit} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Text style={modalStyles.save}>Submit</Text>
            )}
          </TouchableOpacity>
        </View>
        <View style={modalStyles.headerAccent} />

        <View style={modalStyles.body}>
          <Text style={modalStyles.label}>Condition</Text>
          <View style={modalStyles.conditionRow}>
            {CONDITION_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  modalStyles.conditionBtn,
                  condition === opt.value && { backgroundColor: opt.bg, borderColor: opt.color },
                ]}
                onPress={() => setCondition(opt.value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    modalStyles.conditionBtnText,
                    condition === opt.value && { color: opt.color, fontWeight: '700' },
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[modalStyles.label, { marginTop: Spacing.md }]}>Notes</Text>
          <TextInput
            style={modalStyles.input}
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional notes"
            placeholderTextColor={Colors.textLight}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          <Text style={[modalStyles.label, { marginTop: Spacing.md }]}>Photo</Text>
          {photo ? (
            <View style={modalStyles.photoRow}>
              <Image source={{ uri: photo.uri }} style={modalStyles.photoThumb} />
              <TouchableOpacity onPress={() => setPhoto(null)}>
                <Ionicons name="close-circle" size={24} color={Colors.error} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={modalStyles.photoBtn} onPress={takePhoto} activeOpacity={0.8}>
              <Ionicons name="camera-outline" size={20} color={Colors.primary} />
              <Text style={modalStyles.photoBtnText}>Take Photo</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  )
}

export default function EquipmentChecklistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const checklistId = id ? Number(id) : undefined
  const queryClient = useQueryClient()
  const { show } = useToastStore()

  const { data: checklist, isLoading, refetch } = useChecklist(checklistId)
  const [refreshing, setRefreshing] = useState(false)
  const [checkingItem, setCheckingItem] = useState<EquipmentChecklistItem | null>(null)

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  const handleSubmitCheck = useCallback(
    async (condition: string, notes: string, photoUri?: string, photoFilename?: string) => {
      if (!checkingItem || !checklistId) return
      try {
        await api.equipment.checkChecklistItem(checklistId, checkingItem.id, {
          condition,
          notes: notes || undefined,
          photo_uri: photoUri,
          photo_filename: photoFilename,
        })
        show('Item checked', 'success')
        setCheckingItem(null)
        queryClient.invalidateQueries({ queryKey: ['checklist', checklistId] })
      } catch {
        show('Failed to check item', 'error')
      }
    },
    [checkingItem, checklistId, queryClient, show]
  )

  const total = checklist?.total ?? 0
  const checked = checklist?.checked ?? 0
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0
  const isOverdue = checklist ? new Date(checklist.due_date + 'T00:00:00') < new Date() && !checklist.completed_at : false

  // Sort: unchecked first
  const items = checklist?.items ?? []
  const sorted = [...items].sort((a, b) => (a.checked ? 1 : 0) - (b.checked ? 1 : 0))

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title={checklist?.checklist_name ?? 'Checklist'}
        subtitle={checklist?.project_name ?? undefined}
        showBack
      />

      {/* Info strip */}
      {checklist && (
        <View style={styles.infoStrip}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Due: {formatDate(checklist.due_date)}</Text>
            {isOverdue && (
              <View style={styles.overdueBadge}>
                <Text style={styles.overdueText}>OVERDUE</Text>
              </View>
            )}
            {checklist.completed_at && (
              <View style={[styles.overdueBadge, { backgroundColor: 'rgba(61,139,65,0.15)' }]}>
                <Text style={[styles.overdueText, { color: Colors.success }]}>COMPLETED</Text>
              </View>
            )}
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${pct}%`, backgroundColor: pct === 100 ? Colors.success : Colors.primary },
              ]}
            />
          </View>
          <Text style={styles.progressLabel}>{checked} / {total} items checked</Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.body}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeleton} />
          ))}
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ChecklistItemCard
              item={item}
              onCheck={() => setCheckingItem(item)}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {checkingItem && (
        <CheckModal
          visible={!!checkingItem}
          machineName={checkingItem.machine_label}
          onClose={() => setCheckingItem(null)}
          onSubmit={handleSubmitCheck}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },
  body: { flex: 1, backgroundColor: Colors.background, padding: Spacing.md, gap: Spacing.sm },
  list: { padding: Spacing.md, gap: Spacing.sm, backgroundColor: Colors.background },

  infoStrip: {
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  infoLabel: { ...Typography.bodySmall, color: Colors.textSecondary },
  overdueBadge: {
    backgroundColor: 'rgba(198,40,40,0.15)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  overdueText: { ...Typography.caption, color: Colors.error, fontWeight: '700' },
  progressTrack: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressLabel: { ...Typography.caption, color: Colors.textLight, marginTop: Spacing.xs },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingLeft: Spacing.md + 4,
    paddingRight: Spacing.md,
    gap: Spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  info: { flex: 1 },
  name: { ...Typography.h4, color: Colors.textPrimary },
  type: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

  conditionPill: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  conditionText: { ...Typography.caption, fontWeight: '700' },

  checkBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
  },
  checkBtnText: { ...Typography.caption, color: Colors.dark, fontWeight: '700' },

  skeleton: {
    height: 72,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
  },
})

const modalStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.dark,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
  },
  headerAccent: { height: 3, backgroundColor: Colors.primary },
  cancel: { ...Typography.body, color: Colors.textLight },
  title: { ...Typography.h4, color: Colors.white, flex: 1, textAlign: 'center', marginHorizontal: Spacing.sm },
  save: { ...Typography.body, color: Colors.primary, fontWeight: '700' },
  body: { padding: Spacing.md },
  label: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  conditionRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  conditionBtn: {
    flex: 1,
    minWidth: '45%',
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  conditionBtnText: { ...Typography.bodySmall, color: Colors.textSecondary, fontWeight: '500' },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.body,
    color: Colors.textPrimary,
    minHeight: 80,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  photoThumb: { width: 80, height: 80, borderRadius: BorderRadius.sm },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
  },
  photoBtnText: { ...Typography.body, color: Colors.primary, fontWeight: '600' },
})
