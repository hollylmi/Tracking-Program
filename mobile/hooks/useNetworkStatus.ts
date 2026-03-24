import { useEffect, useState } from 'react'
import * as Network from 'expo-network'

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    const check = async () => {
      const state = await Network.getNetworkStateAsync()
      setIsOnline(
        state.isConnected === true &&
        state.isInternetReachable !== false
      )
    }

    check()
    const interval = setInterval(check, 10000)
    return () => clearInterval(interval)
  }, [])

  return isOnline
}
