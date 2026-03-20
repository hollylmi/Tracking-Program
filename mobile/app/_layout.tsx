import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { api } from '../lib/api'
import LoadingSpinner from '../components/ui/LoadingSpinner'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
})

export default function RootLayout() {
  const { isLoading, loadStoredAuth, updateUser } = useAuthStore()
  // Stays true until both loadStoredAuth and the /me refresh are done,
  // so the spinner never flickers off between the two async steps.
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    const init = async () => {
      await loadStoredAuth()
      // If a token was restored, refresh the user object so
      // accessible_projects is always current on app start.
      if (useAuthStore.getState().isAuthenticated) {
        try {
          const { data } = await api.auth.me()
          updateUser(data)
        } catch {
          // Token expired or revoked — the response interceptor will have
          // attempted a refresh and called logout() if it failed.
          // Nothing extra to do; the app will redirect to /login.
        }
      }
      setInitializing(false)
    }
    init()
  }, [])

  if (isLoading || initializing) {
    return <LoadingSpinner fullScreen />
  }

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} initialRouteName="index">
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="entry/new"
          options={{ headerShown: true, title: 'New Entry', headerBackTitle: '' }}
        />
        <Stack.Screen
          name="entry/[id]"
          options={{ headerShown: true, title: 'Entry Detail', headerBackTitle: '' }}
        />
        <Stack.Screen
          name="breakdown/new"
          options={{ headerShown: true, title: 'Log Breakdown', headerBackTitle: '' }}
        />
      </Stack>
    </QueryClientProvider>
  )
}
