import { useEffect } from 'react'
import { View, StyleSheet } from 'react-native'
import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing } from '../../constants/theme'
import { useAuthStore } from '../../store/auth'
import { registerForPushNotifications } from '../../lib/notifications'
import { OfflineBanner } from '../../components/ui/OfflineBanner'
import ProjectSwitcher from '../../components/ui/ProjectSwitcher'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

export default function TabsLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const userRole = useAuthStore((s) => s.user?.role)
  const isAdmin = userRole === 'admin'

  useEffect(() => {
    if (isAuthenticated) {
      registerForPushNotifications()
    }
  }, [isAuthenticated])

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
    <View style={layoutStyles.switcherBar}>
      <ProjectSwitcher variant="pill" />
    </View>
    <Tabs
      initialRouteName={isAdmin ? 'overview' : 'index'}
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
      <Tabs.Screen name="overview" options={{
        title: 'Overview',
        href: isAdmin ? undefined : null,
        tabBarIcon: ({ focused, color }) => icon(focused, color, 'grid-outline', 'grid'),
      }} />
      <Tabs.Screen name="index" options={{
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
    paddingVertical: Spacing.xs,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,183,197,0.1)',
  },
})
