import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, ActionSheetIOS, Platform, Alert, StyleSheet } from 'react-native'
import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { api } from '../../lib/api'
import { registerForPushNotifications } from '../../lib/notifications'
import { OfflineBanner } from '../../components/ui/OfflineBanner'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

export default function TabsLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  const userRole = user?.role
  const isAdmin = userRole === 'admin'
  const { activeProject, setActiveProject } = useProjectStore()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (isAuthenticated) {
      registerForPushNotifications()
    }
  }, [isAuthenticated])

  // Only operational projects for switching
  const operationalProjects = (user?.accessible_projects ?? []).filter((p: any) => {
    const status = p.status || (p.active ? 'active' : 'completed')
    return status === 'active'
  })

  const handleSwitchProject = () => {
    if (operationalProjects.length <= 1) return
    const names = operationalProjects.map((p: any) => p.name)

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...names, 'Cancel'], cancelButtonIndex: names.length, title: 'Switch Project' },
        (idx) => {
          if (idx < names.length) doSwitch(operationalProjects[idx])
        }
      )
    } else {
      Alert.alert('Switch Project', undefined,
        [...operationalProjects.map((p: any) => ({
          text: p.name, onPress: () => doSwitch(p),
        })), { text: 'Cancel', style: 'cancel' as const }]
      )
    }
  }

  const doSwitch = async (p: any) => {
    setActiveProject({
      id: p.id, name: p.name, start_date: null, active: true,
      quoted_days: null, hours_per_day: null, site_address: null,
      site_contact: null, track_by_lot: false,
    })
    try {
      const { data } = await api.projects.detail(p.id)
      setActiveProject(data)
    } catch {}
    queryClient.invalidateQueries()
  }

  const icon = (focused: boolean, color: string, name: IoniconName, activeName: IoniconName) => (
    <View style={{
      width: 44, height: 28, alignItems: 'center', justifyContent: 'center',
      borderRadius: 8,
      backgroundColor: focused ? 'rgba(255,183,197,0.15)' : 'transparent',
      shadowColor: focused ? Colors.primary : 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: focused ? 0.55 : 0, shadowRadius: 8,
      elevation: focused ? 4 : 0,
    }}>
      <Ionicons name={focused ? activeName : name} size={22} color={color} />
    </View>
  )

  return (
    <View style={{ flex: 1 }}>
    <OfflineBanner />
    <TouchableOpacity
      style={layoutStyles.switcherBar}
      onPress={handleSwitchProject}
      activeOpacity={operationalProjects.length > 1 ? 0.7 : 1}
    >
      <View style={layoutStyles.pill}>
        <Text style={layoutStyles.pillText} numberOfLines={1}>
          {activeProject?.name ?? 'No project'}
        </Text>
        {operationalProjects.length > 1 && (
          <Ionicons name="chevron-down" size={12} color={Colors.primary} />
        )}
      </View>
    </TouchableOpacity>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.dark,
          borderTopColor: 'rgba(255,183,197,0.15)',
          borderTopWidth: 1,
          height: 58,
          paddingBottom: 6,
          paddingTop: 4,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{
        title: 'Overview',
        href: isAdmin ? undefined : null,
        tabBarIcon: ({ focused, color }) => icon(focused, color, 'grid-outline', 'grid'),
      }} />
      <Tabs.Screen name="dashboard" options={{
        title: 'Dashboard',
        tabBarIcon: ({ focused, color }) => icon(focused, color, 'home-outline', 'home'),
      }} />
      <Tabs.Screen name="entries" options={{
        title: 'Entries',
        tabBarIcon: ({ focused, color }) => icon(focused, color, 'clipboard-outline', 'clipboard'),
      }} />
      <Tabs.Screen name="equipment" options={{
        title: 'Equipment',
        tabBarIcon: ({ focused, color }) => icon(focused, color, 'construct-outline', 'construct'),
      }} />
      <Tabs.Screen name="travel" options={{
        title: 'Travel',
        tabBarIcon: ({ focused, color }) => icon(focused, color, 'airplane-outline', 'airplane'),
      }} />
      <Tabs.Screen name="documents" options={{
        title: 'Documents',
        tabBarIcon: ({ focused, color }) => icon(focused, color, 'folder-outline', 'folder'),
      }} />
      <Tabs.Screen name="roster" options={{
        title: 'Roster',
        tabBarIcon: ({ focused, color }) => icon(focused, color, 'calendar-outline', 'calendar'),
      }} />
    </Tabs>
    </View>
  )
}

const layoutStyles = StyleSheet.create({
  switcherBar: {
    backgroundColor: Colors.dark,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,183,197,0.1)',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,183,197,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,183,197,0.3)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 8,
    minWidth: 160,
    minHeight: 38,
  },
  pillText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '700',
    flexShrink: 1,
  },
})

