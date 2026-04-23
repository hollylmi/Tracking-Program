import { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import ScreenHeader from '../components/layout/ScreenHeader'
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme'
import { API_BASE_URL } from '../constants/api'
import { api } from '../lib/api'
import { useAuthStore } from '../store/auth'
import { useToastStore } from '../store/toast'

let NfcManager: any = null
let NfcTech: any = null
let Ndef: any = null
try {
  const nfc = require('react-native-nfc-manager')
  NfcManager = nfc.default
  NfcTech = nfc.NfcTech
  Ndef = nfc.Ndef
} catch {}

export default function NewEquipmentScreen() {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const { show } = useToastStore()

  const canCreate = user?.role === 'admin' || user?.role === 'supervisor'

  const [name, setName] = useState('')
  const [plantId, setPlantId] = useState('')
  const [machineType, setMachineType] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [modelNumber, setModelNumber] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [description, setDescription] = useState('')

  const [submitting, setSubmitting] = useState(false)

  // NFC write-after-create flow
  const [createdMachine, setCreatedMachine] = useState<{ id: number; name: string } | null>(null)
  const [writePromptVisible, setWritePromptVisible] = useState(false)
  const [tagLabel, setTagLabel] = useState('')
  const [nfcWriting, setNfcWriting] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Missing name', 'Equipment name is required.')
      return
    }
    setSubmitting(true)
    try {
      const r = await api.equipment.create({
        name: name.trim(),
        plant_id: plantId.trim() || undefined,
        machine_type: machineType.trim() || undefined,
        manufacturer: manufacturer.trim() || undefined,
        model_number: modelNumber.trim() || undefined,
        serial_number: serialNumber.trim() || undefined,
        description: description.trim() || undefined,
      })
      setCreatedMachine({ id: r.data.id, name: r.data.name })
      setWritePromptVisible(true)
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Could not create equipment.'
      Alert.alert('Error', msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSkipTag = () => {
    if (!createdMachine) return
    setWritePromptVisible(false)
    show('Equipment added.', 'success')
    router.replace({ pathname: '/machine/[id]', params: { id: String(createdMachine.id) } })
  }

  const handleWriteTag = async () => {
    if (!createdMachine) return
    if (!NfcManager) {
      Alert.alert('NFC Not Available', 'This device does not support NFC.')
      return
    }
    const supported = await NfcManager.isSupported().catch(() => false)
    if (!supported) {
      Alert.alert('NFC Not Available', 'This device does not support NFC.')
      return
    }

    setWritePromptVisible(false)
    setNfcWriting(true)
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef)
      const tag = await NfcManager.getTag()
      const tagUid: string | undefined = tag?.id
      if (!tagUid) throw new Error('Could not read tag UID')

      const url = `${API_BASE_URL}/equipment/scan/${createdMachine.id}`
      const bytes = Ndef.encodeMessage([Ndef.uriRecord(url)])
      if (!bytes) throw new Error('Could not encode tag payload')
      await NfcManager.ndefHandler.writeNdefMessage(bytes)

      await api.equipment.registerTag(createdMachine.id, {
        uid: tagUid,
        label: tagLabel.trim() || undefined,
      })

      NfcManager.cancelTechnologyRequest().catch(() => {})
      setNfcWriting(false)
      show('Equipment added and NFC tag written.', 'success')
      router.replace({ pathname: '/machine/[id]', params: { id: String(createdMachine.id) } })
    } catch (e: any) {
      NfcManager.cancelTechnologyRequest().catch(() => {})
      setNfcWriting(false)
      if (e?.message === 'cancelled') {
        // Treat as skip — equipment is still created
        show('Equipment added (tag write cancelled).', 'info')
        router.replace({ pathname: '/machine/[id]', params: { id: String(createdMachine.id) } })
        return
      }
      Alert.alert(
        'Tag Write Failed',
        (e?.message || 'Could not write to NFC tag.') + '\n\nThe equipment was still created — you can try writing a tag later from the machine detail page.',
        [
          {
            text: 'OK',
            onPress: () => router.replace({ pathname: '/machine/[id]', params: { id: String(createdMachine.id) } }),
          },
        ],
      )
    }
  }

  if (!canCreate) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <ScreenHeader title="New Equipment" showBack />
        <View style={{ padding: Spacing.lg }}>
          <Text style={{ ...Typography.body, color: Colors.textPrimary }}>
            Only admin or supervisor users can add equipment.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="New Equipment" showBack />
      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: Spacing.xl * 2 }}>

        <Text style={styles.label}>Name *</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Excavator 3T — CAT 303"
          placeholderTextColor={Colors.textLight} />

        <Text style={styles.label}>Plant ID</Text>
        <TextInput style={styles.input} value={plantId} onChangeText={setPlantId} placeholder="Internal ID / fleet number"
          placeholderTextColor={Colors.textLight} autoCapitalize="characters" />

        <Text style={styles.label}>Type</Text>
        <TextInput style={styles.input} value={machineType} onChangeText={setMachineType} placeholder="e.g. Excavator, Roller, Compactor"
          placeholderTextColor={Colors.textLight} />

        <Text style={styles.label}>Manufacturer</Text>
        <TextInput style={styles.input} value={manufacturer} onChangeText={setManufacturer} placeholder="e.g. Caterpillar"
          placeholderTextColor={Colors.textLight} />

        <Text style={styles.label}>Model Number</Text>
        <TextInput style={styles.input} value={modelNumber} onChangeText={setModelNumber} placeholder="e.g. 303 CR"
          placeholderTextColor={Colors.textLight} />

        <Text style={styles.label}>Serial Number</Text>
        <TextInput style={styles.input} value={serialNumber} onChangeText={setSerialNumber} placeholder="Manufacturer serial"
          placeholderTextColor={Colors.textLight} />

        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder="Anything worth recording about this item"
          placeholderTextColor={Colors.textLight}
        />

        <TouchableOpacity
          style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitBtnText}>Create Equipment</Text>}
        </TouchableOpacity>

        <Text style={styles.footNote}>
          Required: name. Everything else can be filled in later.
        </Text>
      </ScrollView>

      {/* Write Tag prompt */}
      <Modal visible={writePromptVisible} transparent animationType="fade"
        onRequestClose={() => setWritePromptVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={{ ...Typography.h4, color: Colors.textPrimary, marginBottom: Spacing.xs }}>
              Equipment Created
            </Text>
            <Text style={{ ...Typography.bodySmall, color: Colors.textSecondary, marginBottom: Spacing.md }}>
              {createdMachine?.name} is saved. Would you like to program an NFC tag for it now?
            </Text>
            <Text style={styles.label}>Tag label (optional)</Text>
            <TextInput
              style={styles.input}
              value={tagLabel}
              onChangeText={setTagLabel}
              placeholder="e.g. rear panel sticker"
              placeholderTextColor={Colors.textLight}
            />
            <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md }}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: Colors.border }]}
                onPress={handleSkipTag}
              >
                <Text style={{ ...Typography.body, color: Colors.textPrimary }}>Skip for now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: Colors.primary }]}
                onPress={handleWriteTag}
              >
                <Text style={{ ...Typography.body, color: '#fff', fontWeight: '700' }}>Write Tag</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Writing modal */}
      <Modal visible={nfcWriting} transparent animationType="fade"
        onRequestClose={() => {
          NfcManager?.cancelTechnologyRequest().catch(() => {})
          setNfcWriting(false)
        }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={{ ...Typography.h4, color: Colors.textPrimary, marginTop: Spacing.md, textAlign: 'center' }}>
              Hold tag near device
            </Text>
            <Text style={{ ...Typography.bodySmall, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xs }}>
              Place an unprogrammed NFC tag against {Platform.OS === 'ios' ? 'the top back' : 'the centre back'} of your phone.
            </Text>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: Colors.border, marginTop: Spacing.md, alignSelf: 'center' }]}
              onPress={() => {
                NfcManager?.cancelTechnologyRequest().catch(() => {})
                setNfcWriting(false)
                if (createdMachine) {
                  router.replace({ pathname: '/machine/[id]', params: { id: String(createdMachine.id) } })
                }
              }}
            >
              <Text style={{ ...Typography.body, color: Colors.textPrimary }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  label: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
    marginTop: Spacing.sm,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    fontSize: 15,
    color: Colors.textPrimary,
    backgroundColor: '#fff',
  },
  submitBtn: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    alignItems: 'center',
  },
  submitBtnText: { ...Typography.body, color: '#fff', fontWeight: '700' },
  footNote: {
    ...Typography.caption,
    color: Colors.textLight,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 420,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
  },
})
