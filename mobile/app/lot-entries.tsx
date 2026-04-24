import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme'
import { useEntries } from '../hooks/useEntries'
import { Entry } from '../types'
import { useState } from 'react'

import { formatDate as fmtDateAU } from '../lib/dates'

function formatDate(dateStr: string): string {
  return fmtDateAU(dateStr, { weekday: 'short', day: 'numeric', month: 'short' })
}

function EntryCard({ entry, onPress }: { entry: Entry; onPress: () => void }) {
  const hasExtras = entry.delay_hours > 0 || entry.photo_count > 0 || !!entry.notes
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <Card padding="none">
        <View style={styles.entryInner}>
          <View style={styles.entryContent}>
            <Text style={styles.entryDate}>{formatDate(entry.date)}</Text>
            <View style={styles.statsRow}>
              <Text style={styles.stat}>{entry.install_hours} hrs</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.stat}>{entry.install_sqm} m²</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.stat}>{entry.num_people} crew</Text>
            </View>
            {hasExtras && (
              <View style={styles.badgeRow}>
                {entry.delay_hours > 0 && (
                  <View style={styles.delayBadge}>
                    <Text style={styles.delayText}>⚠ {entry.delay_hours}h delay</Text>
                  </View>
                )}
                {entry.photo_count > 0 && (
                  <View style={styles.photoBadge}>
                    <Ionicons name="camera-outline" size={11} color={Colors.textSecondary} />
                    <Text style={styles.photoCount}>{entry.photo_count}</Text>
                  </View>
                )}
                {entry.notes && (
                  <View style={styles.notesBadge}>
                    <Text style={styles.notesBadgeText}>Notes</Text>
                  </View>
                )}
              </View>
            )}
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
        </View>
      </Card>
    </TouchableOpacity>
  )
}

export default function LotEntriesScreen() {
  const router = useRouter()
  const { lot, material } = useLocalSearchParams<{ lot: string; material: string }>()
  const [refreshing, setRefreshing] = useState(false)

  const { data, isLoading, isError, refetch } = useEntries({
    lot_number: lot,
    material: material,
    per_page: 100,
  })

  const entries = data?.entries ?? []

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  const title = lot ? `Lot ${lot}` : 'Entries'
  const subtitle = material ?? undefined

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle}>{title}</Text>
          {subtitle && <Text style={styles.headerSub}>{subtitle}</Text>}
        </View>
        <View style={{ width: 32 }} />
      </View>
      <View style={styles.headerAccent} />

      {/* Body */}
      {isLoading ? (
        <View style={styles.listContent}>
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} padding="none">
              <View style={{ padding: Spacing.md, gap: 8 }}>
                <View style={[styles.skeleton, { width: '45%', height: 12 }]} />
                <View style={[styles.skeleton, { width: '65%', height: 10 }]} />
              </View>
            </Card>
          ))}
        </View>
      ) : isError ? (
        <View style={styles.errorBody}>
          <Text style={styles.errorText}>Could not load entries.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => String(e.id)}
          renderItem={({ item }) => (
            <EntryCard entry={item} onPress={() => router.push(`/entry/${item.id}`)} />
          )}
          contentContainerStyle={[
            styles.listContent,
            entries.length === 0 && styles.listContentEmpty,
          ]}
          ListHeaderComponent={
            entries.length > 0 ? (
              <Text style={styles.count}>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="📋"
              title="No entries yet"
              subtitle={`No entries recorded for Lot ${lot}`}
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
          style={styles.list}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },

  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  headerAccent: { height: 3, backgroundColor: Colors.primary },
  backBtn: {
    width: 32,
    alignItems: 'flex-start',
  },
  headerTitles: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    ...Typography.h3,
    color: Colors.white,
  },
  headerSub: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 1,
  },

  count: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },

  list: { backgroundColor: Colors.background },
  listContent: {
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.background,
  },
  listContentEmpty: { flexGrow: 1 },

  entryInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  entryContent: { flex: 1, gap: 4 },
  entryDate: {
    ...Typography.bodySmall,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stat: { ...Typography.caption, color: Colors.textSecondary },
  dot: { ...Typography.caption, color: Colors.textLight },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  delayBadge: {
    backgroundColor: '#FFF3E0',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  delayText: { ...Typography.caption, color: Colors.warning, fontWeight: '600' },
  photoBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  photoCount: { ...Typography.caption, color: Colors.textSecondary },
  notesBadge: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  notesBadgeText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '500' },

  errorBody: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  errorText: { ...Typography.body, color: Colors.textSecondary },
  retryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  retryText: { ...Typography.body, color: Colors.dark, fontWeight: '600' },

  skeleton: { backgroundColor: Colors.surface, borderRadius: BorderRadius.sm },
})
