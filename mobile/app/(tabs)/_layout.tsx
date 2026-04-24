import { useEffect } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, useWindowDimensions } from 'react-native'
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
  const { width } = useWindowDimensions()
  const isWide = width >= 700 // iPad or large phone landscape

  const visibleRoutes = state.routes.filter((_: any, i: number) => {
    const { options } = descriptors[state.routes[i].key]
    return options.href !== null
  })
  const tabCount = visibleRoutes.length

  const renderTab = (route: any, index: number) => {
    const { options } = descriptors[route.key]
    if (options.href === null) return null

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
        style={[tb.tab, isWide && { flex: 1 }]}
        activeOpacity={0.7}
      >
        <View style={[tb.iconWrap, focused && tb.iconWrapActive]}>
          <Ionicons
            name={iconName as IoniconName}
            size={isWide ? 22 : 20}
            color={focused ? Colors.primary : Colors.textSecondary}
          />
        </View>
        <Text style={[tb.label, focused && tb.labelActive, isWide && { fontSize: 11 }]} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    )
  }

  const content = state.routes.map((route: any, index: number) => renderTab(route, index))

  return (
    <View style={{ backgroundColor: Colors.dark }}>
      {/* Pink accent line on top of the tab bar — matches the web navbar. */}
      <View style={tb.accentLine} />
      <View style={[tb.outer, { paddingBottom: Math.max(insets.bottom, 4) }]}>
        {isWide ? (
          <View style={tb.wideRow}>{content}</View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={tb.scroll}
            bounces={false}
          >
            {content}
          </ScrollView>
        )}
      </View>
    </View>
  )
}

const tb = StyleSheet.create({
  outer: {
    backgroundColor: Colors.dark,
  },
  accentLine: {
    height: 2,
    backgroundColor: Colors.primary,
  },
  scroll: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.xs,
  },
  wideRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
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
