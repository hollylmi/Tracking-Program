import { useEffect, useState } from 'react'
import { Linking } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { initDB } from '../lib/db'
import { api } from '../lib/api'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Toast from '../components/ui/Toast'
import { useToastStore } from '../store/toast'
import { useBackgroundSync } from '../hooks/useBackgroundSync'
import { syncPendingEntries } from '../lib/sync'
import { prefetchAllData } from '../lib/prefetch'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 5, // 5 minutes
      networkMode: 'always',     // let queryFn run offline (serves from SQLite cache)
    },
  },
})

function GlobalToast() {
  const { visible, message, type, hide } = useToastStore()
  return <Toast visible={visible} message={message} type={type} onHide={hide} />
}

function useUniversalLinkHandler() {
  const router = useRouter()

  useEffect(() => {
    function handleUrl(event: { url: string }) {
      // Supports both new public URL (/e/<id>) and legacy (/equipment/scan/<id>)
      const match = event.url.match(/\/e\/(\d+)/) || event.url.match(/\/equipment\/scan\/(\d+)/)
      if (match) {
        router.push({ pathname: '/machine/[id]', params: { id: match[1] } })
      }
    }

    Linking.getInitialURL().then(url => {
      if (url) handleUrl({ url })
    })

    const sub = Linking.addEventListener('url', handleUrl)
    return () => sub.remove()
  }, [router])
}

export default function RootLayout() {
  const { isLoading, loadStoredAuth, updateUser } = useAuthStore()
  // Stays true until both loadStoredAuth and the /me refresh are done,
  // so the spinner never flickers off between the two async steps.
  const [initializing, setInitializing] = useState(true)

  useBackgroundSync()
  useUniversalLinkHandler()

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
        // Push any pending local data, then prefetch everything for offline use
        syncPendingEntries().then(() => prefetchAllData())
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
