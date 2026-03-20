import { useEffect, useRef } from 'react'
import * as Network from 'expo-network'
import { syncPendingEntries } from '../lib/sync'

/**
 * Polls network state every 10 s and triggers a sync of locally-saved entries
 * whenever the device transitions from offline → online.
 * Also runs once on mount (in case the app was opened while already online
 * with pending entries from a previous offline session).
 */
export function useBackgroundSync() {
  const wasOnline = useRef<boolean | null>(null)

  useEffect(() => {
    const check = async () => {
      const state = await Network.getNetworkStateAsync()
      const online =
        state.isConnected === true && state.isInternetReachable !== false

      const justCameOnline = wasOnline.current === false && online
      const firstCheckOnline = wasOnline.current === null && online

      if (justCameOnline || firstCheckOnline) {
        syncPendingEntries()
      }

      wasOnline.current = online
    }

    check()
    const interval = setInterval(check, 10000)
    return () => clearInterval(interval)
  }, [])
}
