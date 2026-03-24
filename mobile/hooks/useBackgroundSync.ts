import { useEffect, useRef } from 'react'
import * as Network from 'expo-network'
import { syncPendingEntries } from '../lib/sync'
import { prefetchAllData } from '../lib/prefetch'

/**
 * Polls network state every 10 s and triggers:
 *  1. Push of locally-saved entries/breakdowns/photos to the server
 *  2. Prefetch of all viewable data into SQLite cache for offline use
 * whenever the device transitions from offline → online.
 *
 * The initial prefetch on app start is handled separately (after auth loads)
 * — this hook only handles the offline→online transition.
 */
export function useBackgroundSync() {
  const wasOnline = useRef<boolean | null>(null)

  useEffect(() => {
    const check = async () => {
      const state = await Network.getNetworkStateAsync()
      const online =
        state.isConnected === true && state.isInternetReachable !== false

      // Only trigger on offline → online transitions (not first mount)
      const justCameOnline = wasOnline.current === false && online

      if (justCameOnline) {
        syncPendingEntries().then(() => prefetchAllData())
      }

      wasOnline.current = online
    }

    check()
    const interval = setInterval(check, 10000)
    return () => clearInterval(interval)
  }, [])
}
