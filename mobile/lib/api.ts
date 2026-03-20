import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios'
import { API_BASE_URL } from '../constants/api'
import { useAuthStore } from '../store/auth'
import { User, Project, Entry, Machine, Breakdown, Document, RosterDay } from '../types'

const apiClient: AxiosInstance = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// ── Request interceptor: attach access token ──────────────────────────────────
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// ── Response interceptor: handle 401 / token refresh ─────────────────────────
let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Queue requests while a refresh is in progress
        return new Promise((resolve) => {
          refreshQueue.push((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`
            resolve(apiClient(originalRequest))
          })
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const refreshToken = useAuthStore.getState().refreshToken
        if (!refreshToken) throw new Error('No refresh token')

        const { data } = await axios.post(`${API_BASE_URL}/api/auth/refresh`, null, {
          headers: { Authorization: `Bearer ${refreshToken}` },
        })

        const newAccessToken: string = data.access_token
        // Update store with new access token (keep existing user/refresh)
        const { user, refreshToken: storedRefresh } = useAuthStore.getState()
        if (user && storedRefresh) {
          await useAuthStore.getState().login(newAccessToken, storedRefresh, user)
        }

        refreshQueue.forEach((cb) => cb(newAccessToken))
        refreshQueue = []

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`
        return apiClient(originalRequest)
      } catch {
        refreshQueue = []
        await useAuthStore.getState().logout()
        return Promise.reject(error)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
)

// ── Typed API surface ─────────────────────────────────────────────────────────

export const api = {
  auth: {
    login: (username: string, password: string) =>
      apiClient.post<{ access_token: string; refresh_token: string; user: User }>(
        '/auth/login',
        { username, password }
      ),
    me: () => apiClient.get<User>('/auth/me'),
    logout: () => apiClient.post('/auth/logout'),
  },

  projects: {
    list: () => apiClient.get<Project[]>('/projects'),
    detail: (id: number) => apiClient.get<Project>(`/projects/${id}`),
  },

  entries: {
    list: (params?: Record<string, string | number | undefined>) =>
      apiClient.get<{ entries: Entry[]; total: number; page: number; pages: number }>(
        '/entries',
        { params }
      ),
    detail: (id: number) => apiClient.get<Entry>(`/entries/${id}`),
    create: (data: Partial<Entry>) => apiClient.post<Entry>('/entries', data),
    update: (id: number, data: Partial<Entry>) => apiClient.put<Entry>(`/entries/${id}`, data),
  },

  equipment: {
    list: () => apiClient.get<Machine[]>('/equipment'),
    breakdowns: () => apiClient.get<Breakdown[]>('/breakdowns'),
    createBreakdown: (data: Partial<Breakdown>) =>
      apiClient.post<Breakdown>('/breakdowns', data),
  },

  documents: {
    list: (projectId?: number) =>
      apiClient.get<Document[]>('/documents', {
        params: projectId ? { project_id: projectId } : undefined,
      }),
  },

  roster: {
    get: () => apiClient.get<RosterDay[]>('/roster/my'),
  },

  reference: {
    get: () => apiClient.get('/reference'),
  },

  sync: {
    push: (data: unknown) => apiClient.post('/sync', data),
  },
}

export default apiClient
