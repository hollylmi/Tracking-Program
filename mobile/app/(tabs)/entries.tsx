import { useState, useMemo } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import ScreenHeader from '../../components/layout/ScreenHeader'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'

import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { useEntries } from '../../hooks/useEntries'
import { Entry } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

type Filter = 'All' | 'Today' | 'This Week' | 'This Month'
const FILTERS: Filter[] = ['All', 'Today', 'This Week', 'This Month']

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { formatDate as fmtDateAU } from '../../lib/dates'

function formatDate(dateStr: string): string {
  return fmtDateAU(dateStr, { weekday: 'short', day: 'numeric', month: 'short' })
}

function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

function getWeekBounds(): { start: string; end: string } {
  const now = new Date()
  const day = now.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const mon = new Date(now)
  mon.setDate(now.getDate() + diffToMon)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  return { start: fmt(mon), end: fmt(sun) }
}

function getMonthBounds(): { start: string; end: string } {
  const now = new Date()
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  return { start, end: now.toISOString().split('T')[0] }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <Card padding="none">
      <View style={{ padding: Spacing.md, gap: 8 }}>
        <View style={[styles.skeleton, { width: '55%', height: 12 }]} />
        <View style={[styles.skeleton, { width: '40%', height: 10 }]} />
        <View style={[styles.skeleton, { width: '65%', height: 10 }]} />
      </View>
    </Card>
  )
}

function EntryCard({ entry, onPress }: { entry: Entry; onPress: () => void }) {
  const lotMatLabel = [
    entry.lot_number ? `Lot ${entry.lot_number}` : null,
    entry.material,
  ]
    .filter(Boolean)
    .join(' — ')

  const hasExtras = entry.delay_hours > 0 || entry.photo_count > 0 || !!entry.notes

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <Card padding="none">
        <View style={styles.entryInner}>
          <View style={styles.entryContent}>
            {/* Top row: date | lot — material */}
            <View style={styles.topRow}>
              <Text style={styles.entryDate}>{formatDate(entry.date)}</Text>
              {!!lotMatLabel && (
                <Text style={styles.entryLotMat} numberOfLines={1}>
                  {lotMatLabel}
                </Text>
              )}
            </View>

            {/* Stats row */}
            <View style={styles.statsRow}>
              <Text style={styles.stat}>{entry.install_hours} hrs</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.stat}>{entry.install_sqm} m²</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.stat}>{entry.num_people} crew</Text>
            </View>

            {/* Badge row */}
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

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function EntriesScreen() {
  const router = useRouter()
  const [activeFilter, setActiveFilter] = useState<Filter>('All')
  const [refreshing, setRefreshing] = useState(false)

  const { data, isLoading, isError, refetch } = useEntries({ per_page: 200 })
  const allEntries = data?.entries ?? []

  const filtered = useMemo(() => {
    const today = getToday()
    if (activeFilter === 'Today') {
      return allEntries.filter((e) => e.date === today)
    }
    if (activeFilter === 'This Week') {
      const { start, end } = getWeekBounds()
      return allEntries.filter((e) => e.date >= start && e.date <= end)
    }
    if (activeFilter === 'This Month') {
      const { start, end } = getMonthBounds()
      return allEntries.filter((e) => e.date >= start && e.date <= end)
    }
    return allEntries
  }, [allEntries, activeFilter])

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title="Entries"
        right={
          <TouchableOpacity
            onPress={() => router.push('/entry/new')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.newBtn}>+ New</Text>
          </TouchableOpacity>
        }
      />

      {/* Filter chips */}
      <View style={styles.filterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((f) => {
            const active = f === activeFilter
            return (
              <TouchableOpacity
                key={f}
                onPress={() => setActiveFilter(f)}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </View>

      {/* Body */}
      {isLoading ? (
        <View style={styles.listContent}>
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonCard key={i} />
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
          data={filtered}
          keyExtractor={(e) => String(e.id)}
          renderItem={({ item }) => (
            <EntryCard entry={item} onPress={() => router.push(`/entry/${item.id}`)} />
          )}
          contentContainerStyle={[
            styles.listContent,
            filtered.length === 0 && styles.listContentEmpty,
          ]}
          ListEmptyComponent={
            <EmptyState
              icon="📋"
              title="No entries yet"
              subtitle="Tap + New to log today's work"
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },

  // New button
  newBtn: {
    ...Typography.body,
    color: Colors.primary,
    fontFamily: 'Montserrat_600SemiBold',
  },

  // Filter bar
  filterBar: {
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: {
    ...Typography.label,
    color: Colors.textSecondary,
  },
  chipTextActive: {
    ...Typography.label,
    color: Colors.dark,
    fontWeight: '600',
  },

  // List
  list: {
    backgroundColor: Colors.background,
  },
  listContent: {
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.background,
  },
  listContentEmpty: {
    flexGrow: 1,
  },

  // Entry card internals
  entryInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  entryContent: {
    flex: 1,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  entryDate: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
  },
  entryLotMat: {
    ...Typography.bodySmall,
    color: Colors.textPrimary,
    maxWidth: '55%',
    textAlign: 'right',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stat: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  dot: {
    ...Typography.caption,
    color: Colors.textLight,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  delayBadge: {
    backgroundColor: 'rgba(255,152,0,0.15)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  delayText: {
    ...Typography.caption,
    color: Colors.warning,
    fontWeight: '600',
  },
  photoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  photoCount: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  notesBadge: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  notesBadgeText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '500',
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
  retryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  retryText: {
    ...Typography.body,
    color: Colors.dark,
    fontWeight: '600',
  },

  // Skeleton
  skeleton: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
  },
})
