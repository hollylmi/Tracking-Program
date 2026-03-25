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
import { cachedQuery } from '../../lib/cachedQuery'
import { useProjectStore } from '../../store/project'
import { useHire } from '../../hooks/useHire'
import { Machine, Breakdown, HiredMachine } from '../../types'

// ── Fleet machine card (existing) ────────────────────────────────────────────

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

// ── Hired machine card ────────────────────────────────────────────────────────

function getHireStatus(hm: HiredMachine): { label: string; color: string; bg: string; icon: string } {
  const today = new Date().toISOString().slice(0, 10)

  // Check if returned (past return date)
  if (hm.return_date && hm.return_date < today) {
    return {
      label: 'Returned',
      color: Colors.textLight,
      bg: Colors.surface,
      icon: 'log-out-outline',
    }
  }

  // Check for active stand-down today
  const stoodDownToday = hm.stand_downs?.some(sd => sd.date === today)
  if (stoodDownToday) {
    return {
      label: 'Stood Down',
      color: Colors.warning,
      bg: 'rgba(255,152,0,0.15)',
      icon: 'pause-circle-outline',
    }
  }

  return {
    label: 'Active',
    color: Colors.success,
    bg: 'rgba(76,175,80,0.15)',
    icon: 'checkmark-circle-outline',
  }
}

function HiredMachineCard({ machine }: { machine: HiredMachine }) {
  const status = getHireStatus(machine)

  return (
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <View style={[styles.accentBar, { backgroundColor: status.color }]} />
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: status.color + '20' }]}>
          <Ionicons name={status.icon as any} size={22} color={status.color} />
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{machine.machine_name}</Text>
          {machine.hire_company ? (
            <Text style={styles.type}>{machine.hire_company}</Text>
          ) : null}
          {machine.plant_id ? (
            <Text style={styles.type}>Plant ID: {machine.plant_id}</Text>
          ) : null}
        </View>
        <View style={styles.right}>
          <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>
      </View>
    </Card>
  )
}

// ── Tab selector ──────────────────────────────────────────────────────────────

type TabKey = 'fleet' | 'hired'

function TabSelector({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <View style={tabStyles.container}>
      {(['fleet', 'hired'] as const).map((key) => (
        <TouchableOpacity
          key={key}
          style={[tabStyles.tab, active === key && tabStyles.tabActive]}
          onPress={() => onChange(key)}
          activeOpacity={0.7}
        >
          <Text style={[tabStyles.label, active === key && tabStyles.labelActive]}>
            {key === 'fleet' ? 'Fleet' : 'Hired'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

const tabStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  label: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  labelActive: {
    color: Colors.dark,
  },
})

// ── Main screen ───────────────────────────────────────────────────────────────

export default function EquipmentScreen() {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('fleet')
  const activeProject = useProjectStore((s) => s.activeProject)
  const projectId = activeProject?.id

  // Fleet data
  const { data: machines = [], isLoading: machinesLoading, refetch: refetchMachines } =
    useQuery({
      queryKey: ['machines', projectId],
      queryFn: () =>
        cachedQuery(`machines_project_${projectId}`, () =>
          api.equipment.list(projectId).then(r => r.data.machines)
        ),
      enabled: !!projectId,
      staleTime: 5 * 60 * 1000,
    })

  const { data: breakdowns = [], isLoading: breakdownsLoading, refetch: refetchBreakdowns } =
    useQuery({
      queryKey: ['breakdowns', projectId],
      queryFn: () =>
        cachedQuery(`breakdowns_${projectId}`, () =>
          api.equipment.breakdowns(projectId).then(r => r.data.breakdowns)
        ),
      enabled: !!projectId,
      staleTime: 2 * 60 * 1000,
    })

  // Hired data
  const { data: hiredMachines = [], isLoading: hireLoading, refetch: refetchHire } =
    useHire(projectId)

  const fleetLoading = machinesLoading || breakdownsLoading
  const isLoading = activeTab === 'fleet' ? fleetLoading : hireLoading

  const openCount = breakdowns.filter(b => !b.resolved).length

  // Build grouped + ungrouped lists for Fleet tab
  type FleetItem = { type: 'header'; label: string } | { type: 'machine'; machine: Machine }
  const fleetItems: FleetItem[] = (() => {
    const active = machines.filter(m => m.active)
    const inactive = machines.filter(m => !m.active)

    // Group active machines by group_name
    const groups: Record<string, Machine[]> = {}
    const ungrouped: Machine[] = []
    for (const m of active) {
      if (m.group_name) {
        if (!groups[m.group_name]) groups[m.group_name] = []
        groups[m.group_name].push(m)
      } else {
        ungrouped.push(m)
      }
    }

    const items: FleetItem[] = []
    // Grouped machines first
    for (const [groupName, groupMachines] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) {
      items.push({ type: 'header', label: `${groupName} (${groupMachines.length})` })
      groupMachines.forEach(m => items.push({ type: 'machine', machine: m }))
    }
    // Ungrouped active
    if (ungrouped.length > 0 && Object.keys(groups).length > 0) {
      items.push({ type: 'header', label: `Other Equipment (${ungrouped.length})` })
    }
    ungrouped.forEach(m => items.push({ type: 'machine', machine: m }))
    // Inactive
    if (inactive.length > 0) {
      items.push({ type: 'header', label: `Inactive (${inactive.length})` })
      inactive.forEach(m => items.push({ type: 'machine', machine: m }))
    }
    return items
  })()

  const handleRefresh = async () => {
    setRefreshing(true)
    if (activeTab === 'fleet') {
      await Promise.all([refetchMachines(), refetchBreakdowns()])
    } else {
      await refetchHire()
    }
    setRefreshing(false)
  }

  const subtitle = activeTab === 'fleet'
    ? (openCount > 0 ? `${openCount} open breakdown${openCount > 1 ? 's' : ''}` : undefined)
    : (hiredMachines.length > 0 ? `${hiredMachines.length} hired machine${hiredMachines.length !== 1 ? 's' : ''}` : undefined)

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="Equipment" subtitle={subtitle} />
      <TabSelector active={activeTab} onChange={setActiveTab} />

      {isLoading ? (
        <View style={styles.body}>
          {[0, 1, 2, 3].map(i => <View key={i} style={styles.skeleton} />)}
        </View>
      ) : activeTab === 'fleet' ? (
        machines.length === 0 ? (
          <EmptyState icon="🔧" title="No equipment" subtitle="No machines assigned to your projects" />
        ) : (
          <FlatList
            data={fleetItems}
            keyExtractor={(item, index) => item.type === 'header' ? `h-${index}` : `m-${item.machine.id}`}
            renderItem={({ item }) => {
              if (item.type === 'header') {
                return <Text style={styles.sectionLabel}>{item.label}</Text>
              }
              return (
                <MachineCard
                  machine={item.machine}
                  breakdowns={breakdowns}
                  onPress={() => router.push({ pathname: '/machine/[id]', params: { id: item.machine.id } })}
                />
              )
            }}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
            }
            showsVerticalScrollIndicator={false}
          />
        )
      ) : (
        hiredMachines.length === 0 ? (
          <EmptyState icon="📋" title="No hired machines" subtitle="No hired equipment for this project" />
        ) : (
          <FlatList
            data={hiredMachines}
            keyExtractor={m => String(m.id)}
            renderItem={({ item }) => <HiredMachineCard machine={item} />}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
            }
            showsVerticalScrollIndicator={false}
          />
        )
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
