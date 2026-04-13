import { useEffect } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Spacing } from '../../constants/theme'
import { useAuthStore } from '../../store/auth'
import { registerForPushNotifications } from '../../lib/notifications'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

interface TabMeta {
  icon: IoniconName
  iconActive: IoniconName
}

const TAB_META: Record<string, TabMeta> = {
  index:     { icon: 'grid-outline',      iconActive: 'grid' },
  dashboard: { icon: 'home-outline',      iconActive: 'home' },
  entries:   { icon: 'clipboard-outline',  iconActive: 'clipboard' },
  equipment: { icon: 'construct-outline',  iconActive: 'construct' },
  travel:    { icon: 'airplane-outline',   iconActive: 'airplane' },
  documents: { icon: 'folder-outline',     iconActive: 'folder' },
  roster:    { icon: 'calendar-outline',   iconActive: 'calendar' },
}

function CustomTabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[tb.outer, { paddingBottom: Math.max(insets.bottom, 4) }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={tb.scroll}
        bounces={false}
      >
        {state.routes.map((route: any, index: number) => {
          const { options } = descriptors[route.key]
          if (options.href === null) return null // hidden tab

          const focused = state.index === index
          const label = options.title ?? route.name
          const meta = TAB_META[route.name]
          const iconName = meta
            ? (focused ? meta.iconActive : meta.icon)
            : (focused ? 'ellipse' : 'ellipse-outline')

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name)
                }
              }}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              style={tb.tab}
              activeOpacity={0.7}
            >
              <View style={[tb.iconWrap, focused && tb.iconWrapActive]}>
                <Ionicons
                  name={iconName as IoniconName}
                  size={20}
                  color={focused ? Colors.primary : Colors.textSecondary}
                />
              </View>
              <Text style={[tb.label, focused && tb.labelActive]} numberOfLines={1}>
                {label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
}

const tb = StyleSheet.create({
  outer: {
    backgroundColor: Colors.dark,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,183,197,0.15)',
  },
  scroll: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.xs,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm + 2,
    paddingTop: 6,
    paddingBottom: 2,
    minWidth: 56,
  },
  iconWrap: {
    width: 36,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  iconWrapActive: {
    backgroundColor: 'rgba(255,183,197,0.15)',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 3,
  },
  label: {
    fontSize: 9,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  labelActive: {
    color: Colors.primary,
  },
})

export default function TabsLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const userRole = useAuthStore((s) => s.user?.role)
  const isAdmin = userRole === 'admin'

  useEffect(() => {
    if (isAuthenticated) {
      registerForPushNotifications()
    }
  }, [isAuthenticated])

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{
        title: 'Overview',
        href: isAdmin ? undefined : null,
      }} />
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="entries" options={{ title: 'Entries' }} />
      <Tabs.Screen name="equipment" options={{ title: 'Equipment' }} />
      <Tabs.Screen name="travel" options={{ title: 'Travel' }} />
      <Tabs.Screen name="documents" options={{ title: 'Docs' }} />
      <Tabs.Screen name="roster" options={{ title: 'Roster' }} />
    </Tabs>
    </View>
  )
}
