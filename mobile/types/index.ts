export interface User {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'supervisor' | 'site'
  employee_id: number | null
  accessible_projects: { id: number; name: string }[]
}

export interface ProductivityRow {
  planned_sqm: number
  actual_sqm: number
  planned_days: number
  actual_days: number
  planned_rate: number | null
  actual_rate: number | null
  pct_of_target: number | null
}

export interface MaterialProductivity extends ProductivityRow {
  material: string
}

export interface Productivity {
  overall: ProductivityRow
  materials: MaterialProductivity[]
}

export interface Project {
  id: number
  name: string
  start_date: string | null
  active: boolean
  quoted_days: number | null
  hours_per_day: number | null
  site_address: string | null
  site_contact: string | null
  progress?: ProjectProgress
  productivity?: Productivity
}

export interface ProjectCosts {
  has_rates: boolean
  daily_cost: number
  target_cost: number | null
  forecast_cost: number | null
  cost_variance: number | null
  forecast_working_days: number | null
  variance_days: number | null
  est_finish: string | null    // 'DD/MM/YYYY'
  target_finish: string | null // 'DD/MM/YYYY'
}

export interface ProjectProgress {
  overall_pct: number
  total_planned: number
  total_actual: number
  total_remaining: number
  tasks: ProgressTask[]
}

export interface ProgressTask {
  lot: string
  material: string
  planned_sqm: number
  actual_sqm: number
  pct_complete: number
}

export interface Entry {
  id: number
  date: string
  project_id: number
  project_name: string
  lot_number: string | null
  location: string | null
  material: string | null
  weather: string | null
  install_hours: number
  install_sqm: number
  num_people: number
  delay_hours: number
  delay_reason: string | null
  delay_billable: boolean | null
  delay_description: string | null
  notes: string | null
  other_work_description: string | null
  submitted_by: string | null
  submitted_by_user_id: number | null
  photo_count: number
  created_at: string
  photos?: Photo[]
  // detail-only fields
  employees?: { id: number; name: string; role: string }[]
  machines?: { id: number; name: string; type: string }[]
  standdown_machines?: { id: number; machine_name: string }[]
}

export interface Photo {
  id: number
  url: string
  filename: string
}

export interface Machine {
  id: number
  name: string
  type: string
  active: boolean
}

export interface Breakdown {
  id: number
  machine_id: number
  machine_name: string
  date: string
  description: string
  resolved: boolean
}

export interface BreakdownDetail {
  id: number
  machine_id: number
  date: string | null
  incident_time: string | null
  description: string
  repair_status: 'pending' | 'in_progress' | 'completed'
  repairing_by: string | null
  anticipated_return: string | null
  resolved_date: string | null
  photos?: { id: number; url: string; filename: string }[]
}

export interface MachineDetail {
  id: number
  name: string
  plant_id: string | null
  type: string | null
  description: string | null
  delay_rate: number | null
  active: boolean
  breakdowns: BreakdownDetail[]
}

export interface Document {
  id: number
  project_id: number
  project_name: string
  filename: string
  doc_type?: string
  uploaded_at: string
  download_url: string
}

export interface RosterDay {
  date: string
  status: string
  project_name: string | null
  label: string
}

export interface LocalEntry {
  local_id: string
  server_id?: number
  project_id: number
  entry_date: string
  lot_number?: string
  location?: string
  material?: string
  num_people?: number
  install_hours?: number
  install_sqm?: number
  delay_hours?: number
  delay_billable?: boolean
  delay_reason?: string
  delay_description?: string
  notes?: string
  other_work_description?: string
  machines_stood_down?: boolean
  weather?: string
  form_opened_at?: string
  synced?: number
  created_at?: string
}

export interface LocalBreakdown {
  local_id: string
  server_id?: number
  machine_id: number
  breakdown_date: string
  description: string
  resolved?: boolean
  resolution_notes?: string
  synced?: number
  created_at?: string
}

export interface CachedProject {
  id: number
  name: string
  start_date?: string
  active?: number
  quoted_days?: number
  hours_per_day?: number
}

export interface LotMaterialProgress {
  planned_sqm: number
  actual_sqm: number
  remaining_sqm: number
  pct_complete: number
}

export interface ReferenceData {
  lots: string[]
  materials: string[]
  lot_materials: Record<string, string[]>
  lot_progress: Record<string, Record<string, LotMaterialProgress>>
  roles: string[]
  projects: { id: number; name: string }[]
  employees: { id: number; name: string; role: string }[]
  machines: { id: number; name: string; type: string }[]
  hired_machines: { id: number; machine_name: string; hire_company: string }[]
}
