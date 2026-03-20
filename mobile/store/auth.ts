import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import { User } from '../types'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (accessToken: string, refreshToken: string, user: User) => Promise<void>
  logout: () => Promise<void>
  setLoading: (loading: boolean) => void
  loadStoredAuth: () => Promise<void>
  updateUser: (user: User) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: true,
  login: async (accessToken, refreshToken, user) => {
    await SecureStore.setItemAsync('access_token', accessToken)
    await SecureStore.setItemAsync('refresh_token', refreshToken)
    await SecureStore.setItemAsync('user', JSON.stringify(user))
    set({ accessToken, refreshToken, user, isAuthenticated: true })
  },
  logout: async () => {
    await SecureStore.deleteItemAsync('access_token')
    await SecureStore.deleteItemAsync('refresh_token')
    await SecureStore.deleteItemAsync('user')
    set({ accessToken: null, refreshToken: null, user: null, isAuthenticated: false })
  },
  setLoading: (loading) => set({ isLoading: loading }),
  updateUser: (user) => {
    SecureStore.setItemAsync('user', JSON.stringify(user))
    set({ user })
  },
  loadStoredAuth: async () => {
    try {
      const token = await SecureStore.getItemAsync('access_token')
      const refresh = await SecureStore.getItemAsync('refresh_token')
      const userStr = await SecureStore.getItemAsync('user')
      if (token && userStr) {
        set({
          accessToken: token,
          refreshToken: refresh,
          user: JSON.parse(userStr),
          isAuthenticated: true,
          isLoading: false,
        })
      } else {
        set({ isLoading: false })
      }
    } catch {
      set({ isLoading: false })
    }
  },
}))
