export interface User {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'supervisor' | 'site'
  employee_id: number | null
  accessible_projects: Project[]
}

export interface Project {
  id: number
  name: string
  start_date: string | null
  active: boolean
  quoted_days: number | null
  hours_per_day: number | null
  progress?: ProjectProgress
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
  material: string | null
  install_hours: number
  install_sqm: number
  num_people: number
  delay_hours: number
  delay_reason: string | null
  delay_billable: boolean | null
  notes: string | null
  submitted_by: string | null
  photo_count: number
  created_at: string
  photos?: Photo[]
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

export interface Document {
  id: number
  project_id: number
  project_name: string
  filename: string
  uploaded_at: string
  download_url: string
}

export interface RosterDay {
  date: string
  status: string
  project_name: string | null
  label: string
}
