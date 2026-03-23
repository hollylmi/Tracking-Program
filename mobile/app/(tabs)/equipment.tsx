import { useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import ScreenHeader from '../../components/layout/ScreenHeader'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { api } from '../../lib/api'
import { useProjectStore } from '../../store/project'
import { Machine, Breakdown } from '../../types'

function MachineCard({
  machine,
  breakdowns,
  onPress,
}: {
  machine: Machine
  breakdowns: Breakdown[]
  onPress: () => void
}) {
  const myBreakdowns = breakdowns.filter(b => b.machine_id === machine.id)
  const openCount = myBreakdowns.filter(b => !b.resolved).length
  const isDown = machine.active && openCount > 0
  const isWorking = machine.active && openCount === 0

  // Colour the left border by status
  const borderColor = !machine.active
    ? Colors.textLight
    : isDown
    ? Colors.warning
    : Colors.success

  const statusLabel = !machine.active ? 'Inactive' : isDown ? 'Broken Down' : 'Working'
  const statusColor = !machine.active ? Colors.textLight : isDown ? Colors.warning : Colors.success
  const statusBg   = !machine.active ? Colors.surface : isDown ? 'rgba(255,152,0,0.15)' : 'rgba(76,175,80,0.15)'
  const iconColor  = !machine.active ? Colors.textLight : isDown ? Colors.warning : Colors.success
  const iconName   = !machine.active
    ? 'construct-outline'
    : isDown
    ? 'warning-outline'
    : 'checkmark-circle-outline'

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <Card padding="none" style={{ overflow: 'hidden' }}>
        {/* Coloured left accent bar */}
        <View style={[styles.accentBar, { backgroundColor: borderColor }]} />
        <View style={styles.row}>
          <View style={[styles.iconWrap, { backgroundColor: iconColor + '20' }]}>
            <Ionicons name={iconName as any} size={22} color={iconColor} />
          </View>
          <View style={styles.info}>
            <Text style={styles.name}>{machine.name}</Text>
            {machine.type ? <Text style={styles.type}>{machine.type}</Text> : null}
          </View>
          <View style={styles.right}>
            <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
          </View>
        </View>
        {isDown && (
          <View style={styles.breakdownBanner}>
            <Ionicons name="warning" size={12} color={Colors.warning} />
            <Text style={styles.breakdownBannerText}>
              {openCount} open breakdown{openCount > 1 ? 's' : ''}
            </Text>
          </View>
        )}
      </Card>
    </TouchableOpacity>
  )
}

export default function EquipmentScreen() {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const activeProject = useProjectStore((s) => s.activeProject)
  const projectId = activeProject?.id

  const { data: machines = [], isLoading: machinesLoading, refetch: refetchMachines } =
    useQuery({
      queryKey: ['machines', projectId],
      queryFn: () => api.equipment.list(projectId).then(r => r.data.machines),
      enabled: !!projectId,
      staleTime: 5 * 60 * 1000,
    })

  const { data: breakdowns = [], isLoading: breakdownsLoading, refetch: refetchBreakdowns } =
    useQuery({
      queryKey: ['breakdowns', projectId],
      queryFn: () => api.equipment.breakdowns(projectId).then(r => r.data.breakdowns),
      enabled: !!projectId,
      staleTime: 2 * 60 * 1000,
    })

  const isLoading = machinesLoading || breakdownsLoading

  const openCount = breakdowns.filter(b => !b.resolved).length
  const active = machines.filter(m => m.active)
  const inactive = machines.filter(m => !m.active)
  const sorted = [...active, ...inactive]

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([refetchMachines(), refetchBreakdowns()])
    setRefreshing(false)
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title="Equipment"
        subtitle={openCount > 0 ? `${openCount} open breakdown${openCount > 1 ? 's' : ''}` : undefined}
      />

      {isLoading ? (
        <View style={styles.body}>
          {[0, 1, 2, 3].map(i => <View key={i} style={styles.skeleton} />)}
        </View>
      ) : machines.length === 0 ? (
        <EmptyState icon="🔧" title="No equipment" subtitle="No machines assigned to your projects" />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={m => String(m.id)}
          renderItem={({ item, index }) => (
            <>
              {/* Section labels */}
              {index === 0 && active.length > 0 && inactive.length > 0 && (
                <Text style={styles.sectionLabel}>Active ({active.length})</Text>
              )}
              {index === active.length && inactive.length > 0 && (
                <Text style={[styles.sectionLabel, { marginTop: Spacing.md }]}>
                  Inactive ({inactive.length})
                </Text>
              )}
              <MachineCard
                machine={item}
                breakdowns={breakdowns}
                onPress={() => router.push({ pathname: '/machine/[id]', params: { id: item.id } })}
              />
            </>
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },
  body: { flex: 1, backgroundColor: Colors.background, padding: Spacing.md, gap: Spacing.sm },

  list: { padding: Spacing.md, gap: Spacing.sm, backgroundColor: Colors.background },

  sectionLabel: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },

  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: BorderRadius.md,
    borderBottomLeftRadius: BorderRadius.md,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingLeft: Spacing.md + 4,  // offset for accent bar
    paddingRight: Spacing.md,
    gap: Spacing.md,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  info: { flex: 1 },
  name: { ...Typography.h4, color: Colors.textPrimary },
  type: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

  statusPill: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusText: { ...Typography.caption, fontWeight: '700' },

  breakdownBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,152,0,0.12)',
    paddingHorizontal: Spacing.md + 4,
    paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,152,0,0.25)',
  },
  breakdownBannerText: {
    ...Typography.caption,
    color: Colors.warning,
    fontWeight: '600',
  },

  skeleton: {
    height: 72,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
})
