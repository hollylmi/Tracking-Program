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
  actual_person_hours: number | null
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
  track_by_lot: boolean
  progress?: ProjectProgress
  productivity?: Productivity
  gantt?: GanttData
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

export interface DelayEvent {
  date: string
  day: string
  reason: string
  hours: number
  description: string | null
  type: string | null
}

export interface ProjectProgress {
  overall_pct: number
  should_be_pct: number | null
  total_planned: number
  total_actual: number
  total_remaining: number
  planned_crew: number | null
  current_crew: number | null
  total_delay_hours: number | null
  total_variation_hours: number | null
  delay_impact_days: number | null
  total_available_hours: number | null
  total_lost_hours: number | null
  total_install_hours: number | null
  non_deploy_hours: number | null
  hours_per_day: number | null
  delay_events: DelayEvent[]
  tasks: ProgressTask[]
}

export interface ProgressTask {
  lot: string
  material: string
  planned_sqm: number
  actual_sqm: number
  pct_complete: number
  remaining?: number
}

export interface GanttTask {
  label: string
  pct_complete: number
  variance_days: number | null
}

export interface GanttData {
  target_finish: string | null
  est_finish: string | null
  variance_days: number | null
  tasks: GanttTask[]
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
  production_lines?: { lot_number: string | null; material: string | null; install_hours: number; install_sqm: number; activity_type?: 'deploy' | 'weld'; weld_metres?: number; employee_ids_json?: string }[]
  delay_lines?: { reason: string; hours: number; description?: string }[]
  other_activity_lines?: { description: string; hours: number; employee_ids_json?: string }[]
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
  plant_id: string | null
  group_id: number | null
  group_name: string | null
  photo_url: string | null
  project_id: number | null
  project_name: string | null
  is_storage_location: boolean
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

export interface NFCTagInfo {
  id: number
  uid: string
  machine_id: number
  status: 'active' | 'retired'
  label: string | null
  notes: string | null
  assigned_at: string | null
  retired_at: string | null
}

export interface MachineDetail {
  id: number
  name: string
  plant_id: string | null
  type: string | null
  description: string | null
  delay_rate: number | null
  active: boolean
  serial_number: string | null
  manufacturer: string | null
  model_number: string | null
  acquired_date: string | null
  dispose_by_date: string | null
  next_inspection_date: string | null
  inspection_interval_days: number | null
  storage_instructions: string | null
  service_instructions: string | null
  spare_parts_notes: string | null
  disposal_procedure: string | null
  photo_url: string | null
  breakdowns: BreakdownDetail[]
  daily_checks: DailyCheckRecord[]
  open_checklists: ChecklistItemRef[]
  pending_transfer: TransferInfo | null
}

export interface DailyCheckRecord {
  id: number
  check_date: string
  condition: 'good' | 'fair' | 'poor' | 'broken_down'
  hours_reading: number | null
  notes: string | null
  checked_by: string | null
  checked_at: string | null
  photo_url: string | null
}

export interface ChecklistItemRef {
  checklist_id: number
  checklist_name: string | null
  item_id: number
  machine_label: string
}

export interface TransferInfo {
  id: number
  from_project: string | null
  to_project: string | null
  scheduled_date: string
  status: 'scheduled' | 'in_transit' | 'completed' | 'cancelled'
  travel_notes: string | null
  transport_contact: string | null
}

export interface MachineAlert {
  type: 'inspection' | 'disposal' | 'interval'
  message: string
  days?: number
  urgency?: 'warning' | 'danger'
}

export interface MachineTransferBrief {
  to_project: string
  scheduled_date: string
  status: string
}

export interface DailyCheckMachine {
  machine_id: number | null
  hired_machine_id: number | null
  name: string
  plant_id: string | null
  type: string | null
  source: 'fleet' | 'hired'
  alerts: MachineAlert[]
  pending_transfer: MachineTransferBrief | null
  check: {
    id: number
    condition: string
    hours_reading: number | null
    notes: string | null
    checked_by: string | null
    photo_url: string | null
  } | null
}

export interface DailyChecksResponse {
  project_id: number
  date: string
  total: number
  checked: number
  machines: DailyCheckMachine[]
}

export interface EquipmentChecklist {
  id: number
  checklist_name: string
  project_id: number
  project_name: string | null
  due_date: string
  completed_at: string | null
  notes: string | null
  total: number
  checked: number
  items: EquipmentChecklistItem[]
}

export interface EquipmentChecklistItem {
  id: number
  machine_id: number | null
  hired_machine_id: number | null
  machine_label: string
  checked: boolean
  checked_by: string | null
  checked_at: string | null
  condition: string | null
  notes: string | null
  photo_url: string | null
}

export interface MachineDocumentInfo {
  id: number
  filename: string
  original_name: string
  doc_type: string
  title: string | null
  notes: string | null
  uploaded_by: string | null
  uploaded_at: string | null
  url: string
}

export interface MachineHoursLogEntry {
  id: number
  log_date: string
  hours_reading: number
  recorded_by: string | null
  project_name: string | null
}

export interface TodoItem {
  project_id: number
  project_name: string
  task_type: 'daily_entry' | 'machine_startup' | 'scheduled_check'
  label: string
  completed: boolean
  progress?: { done: number; total: number }
  check_id?: number
  machine_count?: number
}

export interface ScheduledCheckDetail {
  id: number
  name: string
  project_id: number
  project_name: string | null
  frequency: string
  next_due_date: string
  notes: string | null
  total: number
  checked: number
  completed_today: boolean
  machines: ScheduledCheckMachine[]
}

export interface ScheduledCheckMachine {
  machine_id: number
  name: string
  plant_id: string | null
  type: string | null
  alerts: MachineAlert[]
  pending_transfer: MachineTransferBrief | null
  check: {
    id: number
    condition: string
    hours_reading: number | null
    notes: string | null
    checked_by: string | null
    checked_at: string | null
    photo_url: string | null
  } | null
}

export interface AdminProjectTask {
  project_id: number
  project_name: string
  site_manager: string | null
  daily_entry: {
    assigned_to: string | null
    completed: boolean
  }
  machine_startup: {
    assigned_to: string | null
    done: number
    total: number
    completed: boolean
  }
  standdown_email_needed: boolean
  open_breakdowns: number
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
  employee_ids?: number[]
  machine_ids?: number[]
  standdown_machine_ids?: number[]
  production_lines_json?: string
  delay_lines_json?: string
  other_activity_lines_json?: string
  synced?: number
  created_at?: string
}

export interface DelayLine {
  reason: string
  hours: number
  description?: string
}

export interface OtherActivityLine {
  description: string
  hours: number
  employee_ids_json?: string
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

export interface HiredMachine {
  id: number
  machine_name: string
  machine_type: string | null
  hire_company: string | null
  plant_id: string | null
  delivery_date: string | null
  return_date: string | null
  cost_per_day: number | null
  cost_per_week: number | null
  project_id: number
  project_name: string | null
  active: boolean
  stand_downs: { id: number; date: string; reason: string }[]
}

export interface ReferenceData {
  lots: string[]
  materials: string[]
  lot_materials: Record<string, string[]>
  lot_progress: Record<string, Record<string, LotMaterialProgress>>
  roles: string[]
  projects: { id: number; name: string }[]
  employees: { id: number; name: string; role: string }[]
  machines: { id: number; name: string; type: string; group_id: number | null; group_name: string | null }[]
  hired_machines: { id: number; machine_name: string; hire_company: string }[]
}
