import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios'
import { API_BASE_URL } from '../constants/api'
import { useAuthStore } from '../store/auth'
import { User, Project, Entry, Machine, Breakdown, BreakdownDetail, MachineDetail, Document, RosterDay, LocalEntry, ProjectCosts, HiredMachine, DailyChecksResponse, EquipmentChecklist, MachineDocumentInfo, MachineHoursLogEntry, TodoItem, AdminProjectTask, ScheduledCheckDetail, NFCTagInfo } from '../types'

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
    forgotPassword: (email: string) =>
      apiClient.post<{ message: string }>('/auth/forgot-password', { email }),
    verifyAdmin: (password: string) =>
      apiClient.post<{ ok: boolean }>('/auth/verify-admin', { password }),
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
    create: (data: {
      name: string
      plant_id?: string
      machine_type?: string
      manufacturer?: string
      model_number?: string
      serial_number?: string
      description?: string
    }) =>
      apiClient.post<{
        id: number; name: string; plant_id?: string | null; machine_type?: string | null
        manufacturer?: string | null; model_number?: string | null; serial_number?: string | null
      }>('/equipment', data),
    detail: (id: number) => apiClient.get<MachineDetail>(`/equipment/${id}`),
    scanInfo: (id: number) => apiClient.get<{
      id: number; name: string; plant_id: string | null; type: string | null
      manufacturer: string | null; model_number: string | null
      serial_number: string | null; engine_number: string | null
      description: string | null
      photo_url: string | null
      acquired_date: string | null; build_date: string | null
      warranty_expiry: string | null
      next_inspection_date: string | null; inspection_interval_days: number | null
      dispose_by_date: string | null
      service_instructions: string | null; storage_instructions: string | null
      spare_parts_notes: string | null
      active_tag_uid: string | null
      project_id: number | null; project_name: string | null
      is_storage_location: boolean
      compliance_items: Array<{
        kind: string; label: string
        interval_days: number | null; interval_unit: string | null
        last_done_date: string | null; next_due_date: string | null
        days_until_due: number | null
      }>
      breakdowns: Array<{ id: number; description: string | null; repair_status: string }>
      pending_transfer: null | {
        id: number; batch_id: number | null
        from_project: string | null; to_project: string | null
        scheduled_date: string | null; anticipated_arrival_date: string | null
        status: string; pre_checked: boolean; arrived: boolean
      }
    }>(`/equipment/${id}/scan-info`),
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
    uploadMachinePhoto: async (machineId: number, uri: string, filename: string) => {
      const token = useAuthStore.getState().accessToken
      const formData = new FormData()
      formData.append('photo', { uri, name: filename, type: 'image/jpeg' } as any)
      const res = await fetch(`${API_BASE_URL}/api/equipment/${machineId}/photo`, {
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
      hours_reading?: string
      tag_uid?: string
      photo_uri?: string
      photo_filename?: string
      photos?: { uri: string; filename: string }[]
    }) => {
      const token = useAuthStore.getState().accessToken
      const formData = new FormData()
      if (data.machine_id) formData.append('machine_id', String(data.machine_id))
      if (data.hired_machine_id) formData.append('hired_machine_id', String(data.hired_machine_id))
      formData.append('project_id', String(data.project_id))
      formData.append('condition', data.condition)
      if (data.notes) formData.append('notes', data.notes)
      if (data.hours_reading) formData.append('hours_reading', data.hours_reading)
      if (data.tag_uid) formData.append('tag_uid', data.tag_uid)
      if (data.photo_uri && data.photo_filename) {
        formData.append('photo', { uri: data.photo_uri, name: data.photo_filename, type: 'image/jpeg' } as any)
      }
      for (const p of data.photos || []) {
        formData.append('photos', { uri: p.uri, name: p.filename, type: 'image/jpeg' } as any)
      }
      const res = await fetch(`${API_BASE_URL}/api/equipment/daily-check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw Object.assign(new Error('Daily check failed'), { status: res.status, body })
      return body
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

    // Daily check edit/delete
    editDailyCheck: (checkId: number, data: { condition?: string; notes?: string; hours_reading?: number | null }) =>
      apiClient.patch(`/equipment/daily-check/${checkId}`, data),
    deleteDailyCheck: (checkId: number) =>
      apiClient.delete(`/equipment/daily-check/${checkId}`),

    // Machine documents
    machineDocuments: (machineId: number) =>
      apiClient.get<{ documents: MachineDocumentInfo[] }>(`/equipment/machine/${machineId}/documents`),

    uploadMachineDocument: async (machineId: number, uri: string, filename: string, docType: string, title?: string) => {
      const token = useAuthStore.getState().accessToken
      const formData = new FormData()
      formData.append('file', { uri, name: filename, type: 'application/octet-stream' } as any)
      formData.append('doc_type', docType)
      if (title) formData.append('title', title)
      const res = await fetch(`${API_BASE_URL}/api/equipment/machine/${machineId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) throw new Error(`Document upload failed: ${res.status}`)
      return res.json()
    },

    // Machine hours
    machineHours: (machineId: number) =>
      apiClient.get<{ hours_logs: MachineHoursLogEntry[] }>(`/equipment/machine/${machineId}/hours`),

    // NFC scan location
    recordScanLocation: (machineId: number, data: { lat?: number; lng?: number; address?: string; tag_uid?: string }) =>
      apiClient.post(`/equipment/${machineId}/scan-location`, data),

    // Transfer batches (mobile)
    getTransferBatch: (batchId: number) =>
      apiClient.get<{
        id: number
        status: string
        scheduled_date: string | null
        anticipated_arrival_date: string | null
        from_project: { id: number; name: string | null }
        to_project: { id: number; name: string | null }
        pickup_location: string | null
        dropoff_location: string | null
        travel_notes: string | null
        transport_contact: string | null
        can_pre_check: boolean
        can_arrive: boolean
        items: Array<{
          id: number
          machine_id: number
          machine_name: string | null
          plant_id: string | null
          status: string
          pre_checked: boolean
          arrived: boolean
          active_tag_uid: string | null
          pre_check_condition: string | null
          arrival_check_condition: string | null
        }>
      }>(`/transfer-batches/${batchId}`),

    submitTransferPreCheck: async (transferId: number, data: {
      condition: string
      hours_reading?: string
      notes?: string
      tag_uid?: string
      photos?: { uri: string; filename: string }[]
    }) => {
      const token = useAuthStore.getState().accessToken
      const formData = new FormData()
      formData.append('condition', data.condition)
      if (data.hours_reading) formData.append('hours_reading', data.hours_reading)
      if (data.notes) formData.append('notes', data.notes)
      if (data.tag_uid) formData.append('tag_uid', data.tag_uid)
      for (const p of data.photos || []) {
        formData.append('photos', { uri: p.uri, name: p.filename, type: 'image/jpeg' } as any)
      }
      const res = await fetch(`${API_BASE_URL}/api/transfer/${transferId}/pre-check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw Object.assign(new Error('Pre-check failed'), { status: res.status, body })
      return body
    },

    submitTransferArrival: async (transferId: number, data: {
      condition: string
      hours_reading?: string
      notes?: string
      tag_uid?: string
      photos?: { uri: string; filename: string }[]
    }) => {
      const token = useAuthStore.getState().accessToken
      const formData = new FormData()
      formData.append('condition', data.condition)
      if (data.hours_reading) formData.append('hours_reading', data.hours_reading)
      if (data.notes) formData.append('notes', data.notes)
      if (data.tag_uid) formData.append('tag_uid', data.tag_uid)
      for (const p of data.photos || []) {
        formData.append('photos', { uri: p.uri, name: p.filename, type: 'image/jpeg' } as any)
      }
      const res = await fetch(`${API_BASE_URL}/api/transfer/${transferId}/arrive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw Object.assign(new Error('Arrival check failed'), { status: res.status, body })
      return body
    },

    // NFC tags
    listTags: (machineId: number) =>
      apiClient.get<{ tags: NFCTagInfo[] }>(`/equipment/${machineId}/nfc-tags`),
    registerTag: (machineId: number, data: { uid: string; label?: string }) =>
      apiClient.post<{ ok: boolean; tag: NFCTagInfo; already_assigned?: boolean }>(
        `/equipment/${machineId}/nfc-tags`, data),
    retireTag: (tagId: number, reason?: string) =>
      apiClient.post<{ ok: boolean; tag: NFCTagInfo }>(`/nfc-tags/${tagId}/retire`, { reason }),
    lookupTag: (uid: string) =>
      apiClient.get<{ found: boolean; tag?: NFCTagInfo; machine?: { id: number; name: string; plant_id?: string } }>(
        `/nfc-tags/lookup`, { params: { uid } }),
  },

  tasks: {
    myTodos: () => apiClient.get<{ date: string; todos: TodoItem[] }>('/tasks/my-todos'),
    adminOverview: () => apiClient.get<{ date: string; projects: AdminProjectTask[] }>('/tasks/admin-overview'),
    assignments: () => apiClient.get<{ assignments: { id: number; project_id: number; project_name: string; task_type: string; assigned_user_id: number; assigned_user_name: string }[] }>('/tasks/assignments'),
    saveAssignment: (data: { project_id: number; task_type: string; assigned_user_id: number }) =>
      apiClient.post('/tasks/assignments', data),
    scheduledChecks: (projectId?: number) =>
      apiClient.get<{ checks: any[] }>(`/tasks/scheduled-checks${projectId ? `?project_id=${projectId}` : ''}`),
    checkHistory: (projectId?: number, limit?: number) =>
      apiClient.get<{ completions: any[] }>(`/tasks/check-history?${projectId ? `project_id=${projectId}&` : ''}limit=${limit ?? 50}`),
    scheduledCheck: (checkId: number) =>
      apiClient.get<ScheduledCheckDetail>(`/tasks/scheduled-check/${checkId}`),
    completeScheduledCheck: (checkId: number, notes?: string) =>
      apiClient.post(`/tasks/scheduled-check/${checkId}/complete`, { notes }),
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

  travel: {
    my: () => apiClient.get<{
      flights: Array<{
        id: number
        date: string
        direction: 'inbound' | 'outbound'
        airline: string | null
        flight_number: string | null
        departure_airport: string | null
        departure_time: string | null
        arrival_airport: string | null
        arrival_time: string | null
        booking_reference: string | null
        notes: string | null
      }>
      accommodations: Array<{
        id: number
        date_from: string
        date_to: string
        property_name: string | null
        address: string | null
        phone: string | null
        room_info: string | null
        booking_reference: string | null
        check_in_time: string | null
        check_out_time: string | null
        notes: string | null
        housemates: Array<{ name: string; room_info: string | null; date_from: string; date_to: string }>
        instructions: string | null
        documents: Array<{ id: number; title: string; original_name: string; doc_type: string; url: string }>
      }>
      no_employee?: boolean
    }>('/my-travel'),
  },

  sync: {
    push: (data: unknown) => apiClient.post('/sync', data),
  },
}

export default apiClient
