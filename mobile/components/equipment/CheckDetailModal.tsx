import { useState, useEffect } from 'react'
import {
  View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Alert, Image, Platform,
  Keyboard, InputAccessoryView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { API_BASE_URL } from '../../constants/api'
import { api } from '../../lib/api'
import { useToastStore } from '../../store/toast'
import { CONDITION_OPTIONS } from './CheckModal'
import type { DailyCheckMachine } from '../../types'

interface Props {
  visible: boolean
  machine: DailyCheckMachine
  userRole?: string
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}

export default function CheckDetailModal({ visible, machine, userRole, onClose, onSaved, onDeleted }: Props) {
  const check = machine.check
  const canEdit = userRole === 'admin' || userRole === 'supervisor'
  const [editing, setEditing] = useState(false)
  const [condition, setCondition] = useState(check?.condition ?? 'good')
  const [notes, setNotes] = useState(check?.notes ?? '')
  const [hoursReading, setHoursReading] = useState(
    check?.hours_reading != null ? String(check.hours_reading) : ''
  )
  const [saving, setSaving] = useState(false)
  const [lightboxUri, setLightboxUri] = useState<string | null>(null)
  const { show } = useToastStore()

  // Reset form state when the underlying check / visibility changes.
  useEffect(() => {
    if (visible && check) {
      setCondition(check.condition)
      setNotes(check.notes || '')
      setHoursReading(check.hours_reading != null ? String(check.hours_reading) : '')
      setEditing(false)
    }
  }, [visible, check?.id])

  if (!check) return null

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.equipment.editDailyCheck(check.id, {
        condition,
        notes: notes || undefined,
        hours_reading: hoursReading ? Number(hoursReading) : null,
      })
      show('Pre-start updated', 'success')
      setEditing(false)
      onSaved()
    } catch {
      show('Failed to update', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = () => {
    Alert.alert('Delete Pre-Start', 'This will remove the pre-start record. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await api.equipment.deleteDailyCheck(check.id)
          show('Pre-start deleted', 'success')
          onDeleted()
        } catch {
          show('Failed to delete', 'error')
        }
      }},
    ])
  }

  const currentCondition = editing ? condition : check.condition
  const condOpt = CONDITION_OPTIONS.find((c) => c.value === currentCondition)

  const photoUris = [
    ...(check.photo_url ? [check.photo_url] : []),
    ...(check.extra_photo_urls || []),
  ].map((u) => (u.startsWith('http') ? u : `${API_BASE_URL}${u}`))

  const formattedWhen = check.checked_at
    ? new Date(check.checked_at).toLocaleString('en-AU', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : null

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={s.cancel}>Close</Text>
          </TouchableOpacity>
          <Text style={s.title} numberOfLines={1}>{machine.name}</Text>
          {canEdit && !editing ? (
            <TouchableOpacity onPress={() => setEditing(true)}>
              <Text style={s.save}>Edit</Text>
            </TouchableOpacity>
          ) : editing ? (
            <TouchableOpacity onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color={Colors.primary} /> : (
                <Text style={s.save}>Save</Text>
              )}
            </TouchableOpacity>
          ) : <View style={{ width: 40 }} />}
        </View>
        <View style={s.headerAccent} />

        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {!editing ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap', marginBottom: Spacing.md }}>
                {condOpt && (
                  <View style={[s.pill, { backgroundColor: condOpt.bg }]}>
                    <Text style={[s.pillText, { color: condOpt.color }]}>{condOpt.label}</Text>
                  </View>
                )}
                {check.hours_reading != null && (
                  <View style={s.pill}>
                    <Text style={s.pillText}>{check.hours_reading} hrs</Text>
                  </View>
                )}
              </View>

              {check.checked_by && (
                <View style={s.metaRow}>
                  <Ionicons name="person-outline" size={14} color={Colors.textSecondary} />
                  <Text style={s.metaText}>Checked by {check.checked_by}</Text>
                </View>
              )}
              {formattedWhen && (
                <View style={s.metaRow}>
                  <Ionicons name="time-outline" size={14} color={Colors.textSecondary} />
                  <Text style={s.metaText}>{formattedWhen}</Text>
                </View>
              )}
              {machine.plant_id && (
                <View style={s.metaRow}>
                  <Ionicons name="pricetag-outline" size={14} color={Colors.textSecondary} />
                  <Text style={s.metaText}>Plant ID: {machine.plant_id}</Text>
                </View>
              )}
              {machine.type && (
                <View style={s.metaRow}>
                  <Ionicons name="hardware-chip-outline" size={14} color={Colors.textSecondary} />
                  <Text style={s.metaText}>{machine.type}</Text>
                </View>
              )}

              {check.notes ? (
                <View style={s.notesWrap}>
                  <Text style={s.label}>Notes</Text>
                  <Text style={s.notesText}>{check.notes}</Text>
                </View>
              ) : null}

              {photoUris.length > 0 && (
                <>
                  <Text style={[s.label, { marginTop: Spacing.md }]}>
                    Photos ({photoUris.length})
                  </Text>
                  <View style={s.photoGrid}>
                    {photoUris.map((uri, i) => (
                      <TouchableOpacity key={i} onPress={() => setLightboxUri(uri)} activeOpacity={0.85}>
                        <Image source={{ uri }} style={s.photoThumb} resizeMode="cover" />
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {canEdit && (
                <TouchableOpacity onPress={handleDelete} style={s.deleteBtn}>
                  <Ionicons name="trash-outline" size={16} color={Colors.error} />
                  <Text style={s.deleteBtnText}>Delete Pre-Start</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <>
              <Text style={s.label}>Condition</Text>
              <View style={s.conditionRow}>
                {CONDITION_OPTIONS.map((opt) => (
                  <TouchableOpacity key={opt.value}
                    style={[s.conditionBtn, condition === opt.value && { backgroundColor: opt.bg, borderColor: opt.color }]}
                    onPress={() => setCondition(opt.value)} activeOpacity={0.8}>
                    <Text style={[s.conditionBtnText, condition === opt.value && { color: opt.color, fontWeight: '700' }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[s.label, { marginTop: Spacing.md }]}>Machine Hours</Text>
              <TextInput style={[s.input, { minHeight: 0 }]} value={hoursReading} onChangeText={setHoursReading}
                placeholder="Hours reading" placeholderTextColor={Colors.textLight} keyboardType="decimal-pad"
                returnKeyType="done" onSubmitEditing={Keyboard.dismiss} blurOnSubmit
                inputAccessoryViewID={Platform.OS === 'ios' ? 'editCheckDone' : undefined} />
              <Text style={[s.label, { marginTop: Spacing.md }]}>Notes</Text>
              <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="Notes"
                placeholderTextColor={Colors.textLight} multiline numberOfLines={3} textAlignVertical="top"
                inputAccessoryViewID={Platform.OS === 'ios' ? 'editCheckDone' : undefined} />
            </>
          )}
        </ScrollView>

        {/* Full-screen photo lightbox */}
        {lightboxUri && (
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setLightboxUri(null)}
            style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }]}
          >
            <Image source={{ uri: lightboxUri }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />
            <Text style={{ color: '#fff', marginTop: Spacing.md, ...Typography.caption }}>
              Tap to close
            </Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID="editCheckDone">
          <View style={{ backgroundColor: '#f1f3f5', padding: 8, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <TouchableOpacity onPress={Keyboard.dismiss} style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
              <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 15 }}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
    </Modal>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.dark, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 4 },
  headerAccent: { height: 3, backgroundColor: Colors.primary },
  cancel: { ...Typography.body, color: Colors.textLight },
  title: { ...Typography.h4, color: Colors.white, flex: 1, textAlign: 'center', marginHorizontal: Spacing.sm },
  save: { ...Typography.body, color: Colors.primary, fontWeight: '700' },
  body: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  label: { ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm },
  pill: { backgroundColor: Colors.surface, borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { ...Typography.caption, fontWeight: '700', color: Colors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  metaText: { ...Typography.caption, color: Colors.textSecondary },
  notesWrap: { marginTop: Spacing.md, padding: Spacing.sm, backgroundColor: Colors.surface, borderRadius: BorderRadius.sm },
  notesText: { ...Typography.body, color: Colors.textPrimary },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  photoThumb: { width: 100, height: 100, borderRadius: BorderRadius.sm },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.error, marginTop: Spacing.lg },
  deleteBtnText: { ...Typography.body, color: Colors.error, fontWeight: '600' },
  conditionRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  conditionBtn: { flex: 1, minWidth: '45%', paddingVertical: Spacing.sm + 2, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, alignItems: 'center' },
  conditionBtnText: { ...Typography.bodySmall, color: Colors.textSecondary, fontWeight: '500' },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, ...Typography.body, color: Colors.textPrimary, minHeight: 80 },
})
