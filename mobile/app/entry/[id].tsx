import { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { api } from '../../lib/api'
import { API_BASE_URL } from '../../constants/api'
import { useAuthStore } from '../../store/auth'

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

function getPhotoUrl(url: string): string {
  if (url.startsWith('http')) return url
  return `${API_BASE_URL}${url}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PhotoThumbnail({ url, onPress }: { url: string; onPress: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const token = useAuthStore((s) => s.accessToken)
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <View style={styles.thumbnail}>
        {status !== 'error' && (
          <Image
            source={{ uri: getPhotoUrl(url), headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onLoad={() => setStatus('ok')}
            onError={() => setStatus('error')}
          />
        )}
        {status === 'loading' && (
          <ActivityIndicator style={StyleSheet.absoluteFill} color={Colors.primary} />
        )}
        {status === 'error' && (
          <View style={[StyleSheet.absoluteFill, styles.photoError]}>
            <Ionicons name="camera-outline" size={28} color={Colors.textSecondary} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name']
  label: string
  value: string
}) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={Colors.primary} style={styles.infoIcon} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function BasicRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.basicRow}>
      <Text style={styles.basicLabel}>{label}</Text>
      <Text style={styles.basicValue}>{value}</Text>
    </View>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [photoIndex, setPhotoIndex] = useState<number | null>(null)
  const [modalStatus, setModalStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const token = useAuthStore((s) => s.accessToken)

  const { data: entry, isLoading, isError } = useQuery({
    queryKey: ['entry', id],
    queryFn: () => api.entries.detail(Number(id)).then((r) => r.data),
    enabled: !!id,
  })

  // ── Loading ──
  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Entry Detail' }} />
        <LoadingSpinner fullScreen />
      </>
    )
  }

  // ── Error ──
  if (isError || !entry) {
    return (
      <>
        <Stack.Screen options={{ title: 'Entry Detail' }} />
        <View style={styles.errorBody}>
          <Text style={styles.errorText}>Could not load entry.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    )
  }

  const photos = entry.photos ?? []
  const selectedPhoto = photoIndex !== null ? photos[photoIndex] : null

  const lotMatLabel = [
    entry.lot_number ? `Lot ${entry.lot_number}` : null,
    entry.material,
  ]
    .filter(Boolean)
    .join(' — ')

  return (
    <>
      {/* Dynamic Stack header with date subtitle */}
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View>
              <Text style={styles.stackTitle}>Entry Detail</Text>
              <Text style={styles.stackSubtitle}>{formatDateShort(entry.date)}</Text>
            </View>
          ),
        }}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Section 1: Basic info ── */}
        <SectionHeader title="BASIC INFO" />
        <Card>
          <BasicRow label="Date" value={formatDateLong(entry.date)} />
          <View style={styles.divider} />
          <BasicRow label="Project" value={entry.project_name} />
          {!!lotMatLabel && (
            <>
              <View style={styles.divider} />
              <BasicRow label="Lot / Material" value={lotMatLabel} />
            </>
          )}
          {entry.submitted_by && (
            <>
              <View style={styles.divider} />
              <BasicRow label="Submitted by" value={entry.submitted_by} />
            </>
          )}
        </Card>

        {/* ── Section 2: Production ── */}
        <SectionHeader title="PRODUCTION" />
        <Card>
          <InfoRow icon="time-outline" label="Install Hours" value={`${entry.install_hours} hrs`} />
          <View style={styles.divider} />
          <InfoRow icon="grid-outline" label="Area Installed" value={`${entry.install_sqm} m²`} />
          <View style={styles.divider} />
          <InfoRow icon="people-outline" label="Crew Size" value={`${entry.num_people} people`} />
        </Card>

        {/* ── Section 3: Delays ── */}
        {entry.delay_hours > 0 && (
          <>
            <SectionHeader title="DELAYS" />
            <Card style={styles.delayCard}>
              <View style={styles.delayHeaderRow}>
                <Badge
                  label={`${entry.delay_hours}h delay`}
                  variant="delay"
                  icon="warning-outline"
                  size="md"
                />
                {entry.delay_billable !== null && (
                  <Badge
                    label={entry.delay_billable ? 'Billable' : 'Non-billable'}
                    variant={entry.delay_billable ? 'warning' : 'default'}
                    size="md"
                  />
                )}
              </View>
              {entry.delay_reason && (
                <Text style={styles.delayReason}>{entry.delay_reason}</Text>
              )}
            </Card>
          </>
        )}

        {/* ── Section 4: Photos ── */}
        {photos.length > 0 && (
          <>
            <SectionHeader title={`PHOTOS (${photos.length})`} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photoRow}
            >
              {photos.map((photo, i) => (
                <PhotoThumbnail
                  key={photo.id}
                  url={photo.url}
                  onPress={() => setPhotoIndex(i)}
                />
              ))}
            </ScrollView>
          </>
        )}

        {/* ── Section 5: Notes ── */}
        {entry.notes && (
          <>
            <SectionHeader title="NOTES" />
            <Card style={styles.notesCard}>
              <Text style={styles.notesText}>{entry.notes}</Text>
            </Card>
          </>
        )}
      </ScrollView>

      {/* ── Full-screen photo modal ── */}
      {selectedPhoto && (
        <Modal
          visible
          animationType="fade"
          onRequestClose={() => setPhotoIndex(null)}
          onShow={() => setModalStatus('loading')}
        >
          <View style={styles.modalContainer}>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setPhotoIndex(null)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={28} color={Colors.white} />
            </TouchableOpacity>
            <View style={styles.fullImage}>
              {modalStatus !== 'error' && (
                <Image
                  source={{ uri: getPhotoUrl(selectedPhoto.url), headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                  onLoad={() => setModalStatus('ok')}
                  onError={() => setModalStatus('error')}
                />
              )}
              {modalStatus === 'loading' && (
                <ActivityIndicator
                  style={StyleSheet.absoluteFill}
                  size="large"
                  color={Colors.white}
                />
              )}
              {modalStatus === 'error' && (
                <View style={[StyleSheet.absoluteFill, styles.photoError]}>
                  <Ionicons name="camera-outline" size={48} color={Colors.textSecondary} />
                </View>
              )}
            </View>
            {photos.length > 1 && (
              <Text style={styles.photoCounter}>
                {(photoIndex ?? 0) + 1} / {photos.length}
              </Text>
            )}
          </View>
        </Modal>
      )}
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Stack header
  stackTitle: {
    ...Typography.h4,
    color: Colors.textPrimary,
  },
  stackSubtitle: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 1,
  },

  // Scroll body
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: Spacing.xs,
  },

  // Section header
  sectionHeader: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
    paddingHorizontal: 2,
  },

  // Shared divider
  divider: {
    height: 1,
    backgroundColor: Colors.border,
  },

  // Basic info rows
  basicRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  basicLabel: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    flex: 1,
  },
  basicValue: {
    ...Typography.bodySmall,
    color: Colors.textPrimary,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },

  // Production info rows
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  infoIcon: {
    width: 24,
    textAlign: 'center',
  },
  infoLabel: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    flex: 1,
  },
  infoValue: {
    ...Typography.bodySmall,
    color: Colors.textPrimary,
    fontWeight: '600',
  },

  // Delay card
  delayCard: {
    borderLeftWidth: 4,
    borderLeftColor: Colors.warning,
  },
  delayHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  delayReason: {
    ...Typography.body,
    color: Colors.textPrimary,
  },

  // Photos
  photoRow: {
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  thumbnail: {
    width: 120,
    height: 120,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  photoError: {
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Notes
  notesCard: {
    backgroundColor: Colors.surface,
  },
  notesText: {
    ...Typography.body,
    color: Colors.textPrimary,
    fontStyle: 'italic',
  },

  // Error state
  errorBody: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  errorText: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  backBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  backBtnText: {
    ...Typography.body,
    color: Colors.dark,
    fontWeight: '600',
  },

  // Photo modal
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalClose: {
    position: 'absolute',
    top: 56,
    right: Spacing.md,
    zIndex: 10,
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    overflow: 'hidden',
  },
  photoCounter: {
    position: 'absolute',
    bottom: 48,
    ...Typography.body,
    color: Colors.white,
    opacity: 0.8,
  },
})
