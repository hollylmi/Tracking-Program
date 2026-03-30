import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios'
import { API_BASE_URL } from '../constants/api'
import { useAuthStore } from '../store/auth'
import { User, Project, Entry, Machine, Breakdown, BreakdownDetail, MachineDetail, Document, RosterDay, LocalEntry, ProjectCosts, HiredMachine, DailyChecksResponse, EquipmentChecklist } from '../types'

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

// Endpoints that should never trigger a token refresh cycle
const SKIP_REFRESH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout', '/device-token']

// Call this when explicitly logging out to prevent interceptor deadlocks
export function resetRefreshState() {
  isRefreshing = false
  refreshQueue = []
}

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const originalRequest = error.config

    // Never attempt refresh for auth-related endpoints or if already retried
    const requestPath = originalRequest?.url ?? ''
    const skipRefresh = SKIP_REFRESH_PATHS.some((p) => requestPath.includes(p))

    if (error.response?.status === 401 && !originalRequest._retry && !skipRefresh) {
      if (isRefreshing) {
        // Queue requests while a refresh is in progress
        return new Promise((resolve, reject) => {
          refreshQueue.push((token: string) => {
            if (!token) {
              reject(error)
              return
            }
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
        // Clear refresh state before calling logout to prevent deadlocks
        isRefreshing = false
        const pendingQueue = [...refreshQueue]
        refreshQueue = []
        // Reject all queued requests
        pendingQueue.forEach((cb) => cb(''))
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
    list: () => apiClient.get<{ projects: Project[] }>('/projects'),
    detail: (id: number) => apiClient.get<Project>(`/projects/${id}`),
    costs: (id: number) => apiClient.get<ProjectCosts>(`/projects/${id}/costs`),
  },

  entries: {
    list: (params?: Record<string, string | number | undefined>) =>
      apiClient.get<{ entries: Entry[]; total: number; page: number; pages: number }>(
        '/entries',
        { params }
      ),
    detail: (id: number) => apiClient.get<Entry>(`/entries/${id}`),
    create: (data: LocalEntry) => apiClient.post<Entry>('/entries', data),
    update: (id: number, data: Partial<Entry>) => apiClient.patch<Entry>(`/entries/${id}`, data),
    delete: (id: number) => apiClient.delete(`/entries/${id}`),
  },

  equipment: {
    list: (projectId?: number) =>
      apiClient.get<{ machines: Machine[] }>('/equipment', projectId ? { params: { project_id: projectId } } : undefined),
    detail: (id: number) => apiClient.get<MachineDetail>(`/equipment/${id}`),
    update: (id: number, data: Partial<MachineDetail>) =>
      apiClient.patch<MachineDetail>(`/equipment/${id}`, data),
    breakdowns: (projectId?: number) =>
      apiClient.get<{ breakdowns: Breakdown[] }>('/equipment/breakdowns', projectId ? { params: { project_id: projectId } } : undefined),
    createBreakdown: (data: {
      machine_id: number
      breakdown_date: string
      description: string
      incident_time?: string
      repairing_by?: string
      repair_status?: 'pending' | 'in_progress'
      anticipated_return?: string
    }) => apiClient.post<Breakdown>('/equipment/breakdowns', data),
    updateBreakdown: (id: number, data: Partial<BreakdownDetail>) =>
      apiClient.patch<BreakdownDetail>(`/equipment/breakdowns/${id}`, data),
    deleteBreakdown: (id: number) =>
      apiClient.delete(`/equipment/breakdowns/${id}`),
    uploadBreakdownPhoto: async (breakdownId: number, uri: string, filename: string) => {
      const token = useAuthStore.getState().accessToken
      const formData = new FormData()
      formData.append('photo', { uri, name: filename, type: 'image/jpeg' } as any)
      const res = await fetch(`${API_BASE_URL}/api/equipment/breakdowns/${breakdownId}/photos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) throw new Error(`Photo upload failed: ${res.status}`)
      return res.json()
    },

    // Daily checks
    projectDailyChecks: (projectId: number, date?: string) =>
      apiClient.get<DailyChecksResponse>(`/equipment/project/${projectId}/daily-checks`, date ? { params: { date } } : undefined),

    submitDailyCheck: async (data: {
      machine_id?: number
      hired_machine_id?: number
      project_id: number
      condition: string
      notes?: string
      photo_uri?: string
      photo_filename?: string
    }) => {
      const token = useAuthStore.getState().accessToken
      const formData = new FormData()
      if (data.machine_id) formData.append('machine_id', String(data.machine_id))
      if (data.hired_machine_id) formData.append('hired_machine_id', String(data.hired_machine_id))
      formData.append('project_id', String(data.project_id))
      formData.append('condition', data.condition)
      if (data.notes) formData.append('notes', data.notes)
      if (data.photo_uri && data.photo_filename) {
        formData.append('photo', { uri: data.photo_uri, name: data.photo_filename, type: 'image/jpeg' } as any)
      }
      const res = await fetch(`${API_BASE_URL}/api/equipment/daily-check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) throw new Error(`Daily check failed: ${res.status}`)
      return res.json()
    },

    // Checklists
    checklist: (checklistId: number) =>
      apiClient.get<EquipmentChecklist>(`/equipment/checklist/${checklistId}`),

    checkChecklistItem: async (checklistId: number, itemId: number, data: {
      condition: string
      notes?: string
      photo_uri?: string
      photo_filename?: string
    }) => {
      const token = useAuthStore.getState().accessToken
      const formData = new FormData()
      formData.append('condition', data.condition)
      if (data.notes) formData.append('notes', data.notes)
      if (data.photo_uri && data.photo_filename) {
        formData.append('photo', { uri: data.photo_uri, name: data.photo_filename, type: 'image/jpeg' } as any)
      }
      const res = await fetch(`${API_BASE_URL}/api/equipment/checklist/${checklistId}/item/${itemId}/check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) throw new Error(`Checklist check failed: ${res.status}`)
      return res.json()
    },

    // Machine detail (extended)
    machineDetail: (machineId: number) =>
      apiClient.get<MachineDetail>(`/equipment/machine/${machineId}`),

    updateMachine: (machineId: number, data: Partial<MachineDetail>) =>
      apiClient.patch<{ id: number; name: string }>(`/equipment/machine/${machineId}`, data),
  },

  hire: {
    list: (projectId?: number) =>
      apiClient.get<{ hired_machines: HiredMachine[] }>('/hire', projectId ? { params: { project_id: projectId } } : undefined),
  },

  documents: {
    list: (projectId?: number) =>
      apiClient.get<{ documents: Document[] }>('/documents', {
        params: projectId ? { project_id: projectId } : undefined,
      }),
  },

  roster: {
    my: () => apiClient.get<{
      employee: { id: number; name: string } | null
      schedule: RosterDay[]
      no_employee?: boolean
    }>('/roster/my'),
  },

  scheduling: {
    grid: (startDate?: string) => apiClient.get<{
      employees: { id: number; name: string; role: string }[]
      dates: string[]
      grid: Record<string, Record<string, {
        status: string
        label: string
        project_name: string
        override_id: number | null
        override_status: string
        project_id: number | null
      }>>
      projects: { id: number; name: string }[]
    }>('/roster/team', { params: { days: 120, ...(startDate ? { start: startDate } : {}) } }),

    setOverride: (data: {
      employee_id: number
      date: string
      action: 'set' | 'clear'
      status?: string
      project_id?: number | null
      notes?: string
    }) => apiClient.post('/scheduling/override', data),

    addAssignment: (data: {
      employee_id: number
      project_id: number
      date_from: string
      date_to?: string
      notes?: string
    }) => apiClient.post<{ id: number }>('/scheduling/assign', data),

    deleteAssignment: (id: number) => apiClient.delete(`/scheduling/assign/${id}`),

    addLeave: (data: {
      employee_id: number
      date_from: string
      date_to: string
      leave_type: string
      notes?: string
    }) => apiClient.post<{ id: number }>('/scheduling/leave', data),

    deleteLeave: (id: number) => apiClient.delete(`/scheduling/leave/${id}`),
  },

  reference: {
    get: (projectId?: number) =>
      apiClient.get('/reference', projectId ? { params: { project_id: projectId } } : undefined),
  },

  photos: {
    // Uses native fetch — axios strips the multipart boundary when Content-Type is overridden
    upload: async (entryId: number, uri: string, filename: string) => {
      const token = useAuthStore.getState().accessToken
      const formData = new FormData()
      formData.append('photo', { uri, name: filename, type: 'image/jpeg' } as any)
      const res = await fetch(`${API_BASE_URL}/api/entries/${entryId}/photos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) throw new Error(`Photo upload failed: ${res.status}`)
      return res.json()
    },
  },

  reports: {
    progress: (projectId: number) =>
      apiClient.get(`/reports/project/${projectId}/progress`, { responseType: 'arraybuffer' }),
    weekly: (projectId: number, weekStart: string, weekEnd: string) =>
      apiClient.get(`/reports/project/${projectId}/weekly`, {
        params: { week_start: weekStart, week_end: weekEnd },
        responseType: 'arraybuffer',
      }),
    delays: (projectId: number, dateFrom: string, dateTo: string) =>
      apiClient.get('/reports/delays', {
        params: { project_id: projectId, date_from: dateFrom, date_to: dateTo },
        responseType: 'arraybuffer',
      }),
    hire: (hiredMachineId: number, dateFrom: string, dateTo: string) =>
      apiClient.get(`/reports/hire/${hiredMachineId}`, {
        params: { date_from: dateFrom, date_to: dateTo },
        responseType: 'arraybuffer',
      }),
  },

  sync: {
    push: (data: unknown) => apiClient.post('/sync', data),
  },
}

export default apiClient
