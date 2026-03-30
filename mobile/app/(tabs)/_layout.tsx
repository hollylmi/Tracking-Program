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

const tabs: Array<{
  name: string
  title: string
  icon: IoniconName
  iconActive: IoniconName
}> = [
  { name: 'index',     title: 'Dashboard', icon: 'home-outline',      iconActive: 'home' },
  { name: 'entries',   title: 'Entries',   icon: 'clipboard-outline',  iconActive: 'clipboard' },
  { name: 'equipment', title: 'Equipment', icon: 'construct-outline',  iconActive: 'construct' },
  { name: 'travel',    title: 'Travel',    icon: 'airplane-outline',   iconActive: 'airplane' },
  { name: 'documents', title: 'Documents', icon: 'folder-outline',     iconActive: 'folder' },
  { name: 'roster',    title: 'Roster',    icon: 'calendar-outline',   iconActive: 'calendar' },
]

export default function TabsLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    if (isAuthenticated) {
      registerForPushNotifications()
    }
  }, [isAuthenticated])

  return (
    <View style={{ flex: 1 }}>
    <OfflineBanner />
    {/* Global project switcher — visible from every tab */}
    <View style={layoutStyles.switcherBar}>
      <ProjectSwitcher variant="pill" />
    </View>
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
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
        },
      }}
    >
      {tabs.map(({ name, title, icon, iconActive }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ focused, color }) => (
              <View style={{
                width: 44,
                height: 28,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                backgroundColor: focused ? 'rgba(255,183,197,0.15)' : 'transparent',
                shadowColor: focused ? Colors.primary : 'transparent',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: focused ? 0.55 : 0,
                shadowRadius: 8,
                elevation: focused ? 4 : 0,
              }}>
                <Ionicons
                  name={focused ? iconActive : icon}
                  size={22}
                  color={color}
                />
              </View>
            ),
          }}
        />
      ))}
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
