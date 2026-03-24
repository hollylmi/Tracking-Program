import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import apiClient from './api'

const PUSH_TOKEN_KEY = 'push_token'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

async function requestPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync()
  if (existing === 'granted') return true

  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted'
}

export async function registerForPushNotifications(): Promise<void> {
  const granted = await requestPermission()
  if (!granted) return

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync()
    const token = tokenData.data
    const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android'

    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token)
    await apiClient.post('/device-token', { token, platform })
  } catch (e) {
    console.warn('Push token registration failed:', e)
  }
}

export async function unregisterPushToken(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY)
    if (!token) return

    await apiClient.delete('/device-token', { data: { token } })
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY)
  } catch (e) {
    console.warn('Push token unregister failed:', e)
  }
}
