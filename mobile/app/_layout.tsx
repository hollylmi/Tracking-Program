import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { initDB } from '../lib/db'
import { api } from '../lib/api'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Toast from '../components/ui/Toast'
import { useToastStore } from '../store/toast'
import { useBackgroundSync } from '../hooks/useBackgroundSync'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
})

function GlobalToast() {
  const { visible, message, type, hide } = useToastStore()
  return <Toast visible={visible} message={message} type={type} onHide={hide} />
}

export default function RootLayout() {
  const { isLoading, loadStoredAuth, updateUser } = useAuthStore()
  // Stays true until both loadStoredAuth and the /me refresh are done,
  // so the spinner never flickers off between the two async steps.
  const [initializing, setInitializing] = useState(true)

  useBackgroundSync()

  useEffect(() => {
    const init = async () => {
      initDB()
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
      <GlobalToast />
      <Stack screenOptions={{ headerShown: false }} initialRouteName="index">
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="entry/new"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="entry/[id]/index"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="entry/[id]/edit"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="lot-entries"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="machine/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="breakdown/new"
          options={{ headerShown: false }}
        />
      </Stack>
    </QueryClientProvider>
  )
}
