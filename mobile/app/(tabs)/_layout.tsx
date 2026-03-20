import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '../../constants/theme'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

const tabs: Array<{
  name: string
  title: string
  icon: IoniconName
  iconActive: IoniconName
}> = [
  { name: 'index', title: 'Dashboard', icon: 'home-outline', iconActive: 'home' },
  { name: 'entries', title: 'Entries', icon: 'clipboard-outline', iconActive: 'clipboard' },
  { name: 'equipment', title: 'Equipment', icon: 'construct-outline', iconActive: 'construct' },
  { name: 'documents', title: 'Documents', icon: 'folder-outline', iconActive: 'folder' },
  { name: 'roster', title: 'Roster', icon: 'calendar-outline', iconActive: 'calendar' },
]

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.dark,
          borderTopColor: '#3D3D3D',
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
        },
      }}
    >
      {tabs.map(({ name, title, icon, iconActive }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? iconActive : icon}
                size={size}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  )
}
