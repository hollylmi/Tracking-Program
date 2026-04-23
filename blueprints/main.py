from datetime import date, timedelta

from flask import Blueprint, render_template
from flask_login import current_user
from sqlalchemy import func

from blueprints.auth import require_role
from models import (db, DailyEntry, Project, HiredMachine, User, ProjectMachine,
                    MachineDailyCheck, MachineBreakdown, ProjectDailyTaskAssignment,
                    EntryDelayLine, ScheduledEquipmentCheck, TransferBatch)
from utils.progress import compute_project_progress
from utils.gantt import compute_gantt_data

main_bp = Blueprint('main', __name__)


@main_bp.route('/')
@require_role('admin', 'supervisor', 'site')
def index():
    today = date.today()
    recent_entries = (
        DailyEntry.query
        .order_by(DailyEntry.entry_date.desc(), DailyEntry.created_at.desc())
        .limit(10).all()
    )
    total_entries = DailyEntry.query.count()
    entries_today = DailyEntry.query.filter_by(entry_date=today).count()
    all_active_projects = Project.query.filter_by(active=True).order_by(Project.name).all()
    # Only show operational projects (mobilised) on the dashboard
    projects = [p for p in all_active_projects if p.is_operational]
    active_hired = HiredMachine.query.filter_by(active=True).count()

    # Compute progress + gantt for each project
    project_data = []
    for p in projects:
        progress = compute_project_progress(p.id)
        gantt = compute_gantt_data(p.id)
        project_data.append({
            'project': p,
            'progress': progress,
            'target_finish': gantt.get('target_finish') if gantt else None,
            'est_finish': gantt.get('est_finish') if gantt else None,
            'variance_days': gantt.get('variance_days') if gantt else None,
        })

    # ── Admin task overview ─────────────────────────────────────────────
    task_overview = None
    if current_user.role == 'admin':
        task_projects = []
        supervisors = User.query.filter(User.active == True, User.role.in_(['admin', 'supervisor', 'site'])).order_by(User.display_name).all()

        for p in projects:
            assignments = ProjectDailyTaskAssignment.query.filter_by(
                project_id=p.id, active=True).all()
            entry_assignment = next((a for a in assignments if a.task_type == 'daily_entry'), None)
            startup_assignment = next((a for a in assignments if a.task_type == 'machine_startup'), None)

            entry_today = DailyEntry.query.filter_by(
                project_id=p.id).filter(
                func.date(DailyEntry.entry_date) == today).first()

            own_count = ProjectMachine.query.filter_by(project_id=p.id).count()
            hired_count = HiredMachine.query.filter_by(project_id=p.id, active=True).count()
            total_machines = own_count + hired_count
            checks_done = MachineDailyCheck.query.filter_by(
                project_id=p.id, check_date=today).count()

            # Standdown check
            standdown_needed = False
            if entry_today and hired_count > 0:
                has_delays = (entry_today.delay_hours or 0) > 0
                if not has_delays:
                    has_delays = EntryDelayLine.query.filter_by(entry_id=entry_today.id).count() > 0
                standdown_needed = has_delays

            own_machine_ids = {pm.machine_id for pm in ProjectMachine.query.filter_by(project_id=p.id).all()}
            hired_ids = {hm.id for hm in HiredMachine.query.filter_by(project_id=p.id).all()}
            open_bds = MachineBreakdown.query.filter(
                MachineBreakdown.repair_status != 'completed',
                db.or_(
                    MachineBreakdown.machine_id.in_(own_machine_ids) if own_machine_ids else db.false(),
                    MachineBreakdown.hired_machine_id.in_(hired_ids) if hired_ids else db.false(),
                )
            ).count()

            task_projects.append({
                'project': p,
                'entry_assigned': entry_assignment,
                'startup_assigned': startup_assignment,
                'entry_done': entry_today is not None,
                'checks_done': checks_done,
                'total_machines': total_machines,
                'startup_complete': checks_done > 0,
                'standdown_needed': standdown_needed,
                'open_breakdowns': open_bds,
            })

        task_overview = {
            'projects': task_projects,
            'supervisors': supervisors,
        }

    # ── Personal to-do (any role) ─────────────────────────────────────
    # Admins also get this panel so they see transfers / scheduled checks
    # that have been explicitly assigned to them (filtering below is by
    # user.id so admins only see their own assignments).
    my_todos = None
    if True:
        todos = []
        my_assignments = ProjectDailyTaskAssignment.query.filter_by(
            assigned_user_id=current_user.id, active=True).all()
        for a in my_assignments:
            p = a.project
            if not p or not p.active:
                continue
            if a.task_type == 'daily_entry':
                entry_exists = DailyEntry.query.filter_by(
                    project_id=p.id).filter(
                    func.date(DailyEntry.entry_date) == today).first()
                todos.append({
                    'project': p,
                    'task_type': 'daily_entry',
                    'label': 'Submit daily entry',
                    'completed': entry_exists is not None,
                })
            elif a.task_type == 'machine_startup':
                # Machine startup = record machines you're using today
                # Completed when at least one machine has been checked
                done = MachineDailyCheck.query.filter_by(
                    project_id=p.id, check_date=today).count()
                todos.append({
                    'project': p,
                    'task_type': 'machine_startup',
                    'label': 'Start machines for the day',
                    'completed': done > 0,
                    'done': done,
                })

        # Scheduled equipment checks assigned to this user
        my_scheduled = ScheduledEquipmentCheck.query.filter(
            ScheduledEquipmentCheck.assigned_user_id == current_user.id,
            ScheduledEquipmentCheck.active == True,
            ScheduledEquipmentCheck.next_due_date <= today,
        ).all()
        for sc in my_scheduled:
            # Check if already completed today
            already_done = any(c.completed_date == today for c in sc.completions)
            todos.append({
                'project': sc.project,
                'task_type': 'scheduled_check',
                'label': sc.name,
                'completed': already_done,
                'check_id': sc.id,
                'machine_count': len(sc.machines),
            })

        # Transfer todos — one query, split into outbound/inbound per-user.
        # Dual-access users (admins with no explicit assignment) only see one
        # todo at a time based on where the outstanding work is. Completed
        # batches stay visible for the rest of the day so users can see their
        # activity on the list.
        from datetime import datetime as _dt
        from models import MachineDailyCheck
        accessible_pids = {p.id for p in (current_user.accessible_projects() or [])}
        is_admin = current_user.role == 'admin'
        site_filter_to = (TransferBatch.to_project_id.in_(accessible_pids)
                          if accessible_pids else db.false())
        site_filter_from = (TransferBatch.from_project_id.in_(accessible_pids)
                            if accessible_pids else db.false())
        today_start = _dt.combine(today, _dt.min.time())
        active_batches = TransferBatch.query.filter(
            db.or_(
                TransferBatch.status.in_(('scheduled', 'in_transit')),
                db.and_(
                    TransferBatch.status == 'completed',
                    TransferBatch.completed_at >= today_start,
                ),
            ),
            db.or_(
                TransferBatch.pre_check_user_id == current_user.id,
                TransferBatch.arrival_user_id == current_user.id,
                site_filter_from,
                site_filter_to,
            ),
        ).all()
        for batch in active_batches:
            items = batch.items
            total = len(items)
            checked = sum(1 for t in items if t.pre_check_id)
            arrived = sum(1 for t in items if t.arrival_check_id)

            def _user_acted_today(check_attr):
                for it in items:
                    cid = getattr(it, check_attr, None)
                    if not cid:
                        continue
                    c = MachineDailyCheck.query.get(cid)
                    if c and c.checked_by_user_id == current_user.id and c.check_date == today:
                        return True
                return False

            user_did_source_today = _user_acted_today('pre_check_id')
            user_did_dest_today = _user_acted_today('arrival_check_id')

            is_source_side = (
                current_user.id == batch.pre_check_user_id or is_admin or
                (accessible_pids and batch.from_project_id in accessible_pids)
            )
            is_dest_side = (
                current_user.id == batch.arrival_user_id or is_admin or
                (accessible_pids and batch.to_project_id in accessible_pids)
            )
            # Sequential rule for dual-access users: source todo while pre-check
            # pending, then destination todo once pre-checks done.
            if is_source_side and is_dest_side:
                if checked < total:
                    is_dest_side = False
                else:
                    is_source_side = False

            if is_source_side and (checked < total or user_did_source_today):
                todos.append({
                    'project': batch.from_project,
                    'task_type': 'pre_check_transfer',
                    'label': f'Outbound transfer — {total} machine{"s" if total != 1 else ""} to {batch.to_project.name if batch.to_project else "—"}',
                    'completed': checked >= total,
                    'done': checked,
                    'total': total,
                    'batch_id': batch.id,
                })
            if is_dest_side and checked > 0 and (arrived < total or user_did_dest_today):
                todos.append({
                    'project': batch.to_project,
                    'task_type': 'incoming_transfer',
                    'label': f'Inbound transfer — {total} machine{"s" if total != 1 else ""} from {batch.from_project.name if batch.from_project else "—"}',
                    'completed': arrived >= total,
                    'done': arrived,
                    'total': total,
                    'batch_id': batch.id,
                })

        my_todos = todos

    # ── Scheduled checks for admin overview ───────────────────────────
    scheduled_checks = None
    if current_user.role == 'admin':
        scheduled_checks = ScheduledEquipmentCheck.query.filter_by(active=True).order_by(
            ScheduledEquipmentCheck.next_due_date).all()

    return render_template('index.html', recent_entries=recent_entries,
                           total_entries=total_entries, entries_today=entries_today,
                           active_projects=len(projects), active_hired=active_hired,
                           project_data=project_data, today=today,
                           task_overview=task_overview, my_todos=my_todos,
                           scheduled_checks=scheduled_checks)
