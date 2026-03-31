import os
from datetime import date, datetime, timedelta
from itertools import groupby

from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_login import current_user, login_required

from blueprints.auth import require_role

from models import (
    db,
    Employee, Role, Project, Machine, MachineGroup,
    ProjectAssignment, ProjectBudgetedRole, ProjectNonWorkDate,
    EmployeeSwing, EmployeeLeave,
    ScheduleDayOverride,
    SwingPattern,
    PublicHoliday, CFMEUDate,
    ProjectEquipmentRequirement, ProjectEquipmentAssignment,
    ProjectMachine, MachineBreakdown,
    FlightBooking, AccommodationBooking, AccommodationProperty, AccommodationDocument, User,
)
from utils.schedule import build_schedule_grid, detect_travel_needs, build_swing_planner

scheduling_bp = Blueprint('scheduling', __name__)

# Per-project colour palette (bg, text) — cycled by project.id order
SCHED_PALETTE = [
    ('#cfe2ff', '#084298'),  # blue
    ('#d1e7dd', '#0a3622'),  # green
    ('#f8d7da', '#842029'),  # red
    ('#fff3cd', '#664d03'),  # yellow
    ('#d2f4ea', '#0b4c34'),  # teal
    ('#fde8d8', '#6c3a00'),  # orange
    ('#e2d9f3', '#3d1a78'),  # purple
    ('#dee2e6', '#343a40'),  # grey
]


@scheduling_bp.route('/scheduling')
@require_role('admin', 'supervisor', 'site')
def scheduling_overview():
    # Navigation: ?week=YYYY-MM-DD (Monday of start week), jumps in 4-week increments
    week_str = request.args.get('week')
    try:
        week_start = datetime.strptime(week_str, '%Y-%m-%d').date()
        week_start = week_start - timedelta(days=week_start.weekday())
    except (ValueError, TypeError):
        today = date.today()
        week_start = today - timedelta(days=today.weekday())

    # Show 12 weeks (84 days) — one full scroll covers 3 swing cycles
    date_list = [week_start + timedelta(days=i) for i in range(84)]
    week_end = date_list[-1]
    prev_period = (week_start - timedelta(weeks=4)).isoformat()
    next_period = (week_start + timedelta(weeks=4)).isoformat()

    no_employee_linked = False
    if current_user.role == 'admin':
        employees = Employee.query.filter_by(active=True).order_by(Employee.role, Employee.name).all()
    elif current_user.employee_id is None:
        employees = []
        no_employee_linked = True
        flash('Your account is not linked to an employee record — contact admin.', 'warning')
    else:
        employees = Employee.query.filter_by(id=current_user.employee_id, active=True).all()
    grid = build_schedule_grid(employees, date_list)

    # Group employees by role group (if set) then by role name
    roles_db = Role.query.all()
    role_group_map = {r.name: (r.group_name or r.name) for r in roles_db}

    # Sort employees so they group by their display group name, then role, then name
    def emp_sort_key(e):
        grp = role_group_map.get(e.role, e.role or 'ZZZ')
        return (grp, e.role or '', e.name)
    employees_sorted = sorted(employees, key=emp_sort_key)

    roles_grouped = []
    for role_name, emp_iter in groupby(employees_sorted, key=lambda e: e.role or 'No Role'):
        roles_grouped.append((role_name, list(emp_iter)))

    # Distinct scheduling groups for filter dropdown
    role_groups_distinct = sorted({(r.group_name or r.name) for r in roles_db if r.name})

    projects = Project.query.filter_by(active=True).order_by(Project.name).all()

    all_proj_ordered = Project.query.order_by(Project.id).all()
    project_colour_map = {
        p.id: SCHED_PALETTE[i % len(SCHED_PALETTE)]
        for i, p in enumerate(all_proj_ordered)
    }

    return render_template(
        'scheduling/overview.html',
        date_list=date_list,
        week_start=week_start,
        week_end=week_end,
        prev_period=prev_period,
        next_period=next_period,
        employees=employees_sorted,
        roles_grouped=roles_grouped,
        role_group_map=role_group_map,
        role_groups_distinct=role_groups_distinct,
        grid=grid,
        projects=projects,
        project_colour_map=project_colour_map,
        today=date.today()
    )


@scheduling_bp.route('/scheduling/grid.json')
@login_required
def scheduling_grid_json():
    """Return the schedule grid as JSON for live polling."""
    week_str = request.args.get('week')
    try:
        week_start = datetime.strptime(week_str, '%Y-%m-%d').date()
        week_start = week_start - timedelta(days=week_start.weekday())
    except (ValueError, TypeError):
        today = date.today()
        week_start = today - timedelta(days=today.weekday())

    date_list = [week_start + timedelta(days=i) for i in range(84)]

    if current_user.role == 'admin':
        employees = Employee.query.filter_by(active=True).order_by(Employee.role, Employee.name).all()
    elif current_user.employee_id is None:
        employees = []
    else:
        employees = Employee.query.filter_by(id=current_user.employee_id, active=True).all()

    grid = build_schedule_grid(employees, date_list)

    # Build colour map
    all_proj_ordered = Project.query.order_by(Project.id).all()
    project_colour_map = {
        p.id: SCHED_PALETTE[i % len(SCHED_PALETTE)]
        for i, p in enumerate(all_proj_ordered)
    }

    # Serialize grid — convert int keys to strings for JSON
    serialized = {}
    for emp_id, dates in grid.items():
        serialized[str(emp_id)] = dates

    return jsonify({
        'grid': serialized,
        'project_colours': {str(k): v for k, v in project_colour_map.items()},
        'timestamp': datetime.utcnow().isoformat(),
    })


@scheduling_bp.route('/scheduling/project/<int:project_id>')
@require_role('admin', 'supervisor')
def scheduling_project(project_id):
    project = Project.query.get_or_404(project_id)

    week_str = request.args.get('week')
    try:
        week_start = datetime.strptime(week_str, '%Y-%m-%d').date()
        week_start = week_start - timedelta(days=week_start.weekday())
    except (ValueError, TypeError):
        today = date.today()
        week_start = today - timedelta(days=today.weekday())

    # Show 12 weeks, navigate in 4-week increments
    date_list = [week_start + timedelta(days=i) for i in range(84)]
    week_end = date_list[-1]
    prev_period = (week_start - timedelta(weeks=4)).isoformat()
    next_period = (week_start + timedelta(weeks=4)).isoformat()

    # Employees assigned to this project whose assignment overlaps the view window
    assignments = ProjectAssignment.query.filter(
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.date_from <= week_end,
        db.or_(ProjectAssignment.date_to.is_(None), ProjectAssignment.date_to >= week_start)
    ).order_by(ProjectAssignment.date_from).all()

    assigned_emp_ids = list({a.employee_id for a in assignments})
    assigned_employees = Employee.query.filter(Employee.id.in_(assigned_emp_ids)).order_by(Employee.role, Employee.name).all() if assigned_emp_ids else []

    grid = build_schedule_grid(assigned_employees, date_list)

    # Build role group mapping for coverage (roles in the same group count together)
    roles_db = Role.query.all()
    role_group_map = {r.name: (r.group_name or r.name) for r in roles_db}

    # Budgeted by role group name (ProjectBudgetedRole.role_name should match group names)
    budgeted = {br.role_name: br.budgeted_count for br in project.budgeted_roles}

    # Map employee → their scheduled role name for this project (from active assignments)
    emp_scheduled_role_name = {}
    for a in assignments:
        if a.scheduled_role:
            emp_scheduled_role_name[a.employee_id] = a.scheduled_role.name
        elif a.employee.role:
            emp_scheduled_role_name.setdefault(a.employee_id, a.employee.role)

    # Count employees on site (status='assigned') grouped by their role group per date
    role_coverage = {}   # group_name -> {date_str -> count}
    for emp in assigned_employees:
        role_name = emp_scheduled_role_name.get(emp.id) or emp.role or ''
        group = role_group_map.get(role_name, role_name or 'No Role')
        if group not in role_coverage:
            role_coverage[group] = {d.isoformat(): 0 for d in date_list}
        for d in date_list:
            ds = d.isoformat()
            cell = grid.get(emp.id, {}).get(ds, {})
            if cell.get('status') == 'assigned':
                role_coverage[group][ds] += 1

    all_employees = Employee.query.filter_by(active=True).order_by(Employee.role, Employee.name).all()
    # Build per-employee roles JSON for the assignment form's dynamic role dropdown
    emp_roles_data = {
        emp.id: [{'id': r.id, 'name': r.name, 'delay_rate': r.delay_rate} for r in emp.roles]
        for emp in all_employees
    }

    # Non-work dates including public holidays
    project_nwd = {nwd.date for nwd in ProjectNonWorkDate.query.filter_by(project_id=project_id).all()}
    if project.state:
        for h in PublicHoliday.query.all():
            if project.state in h.states_list():
                project_nwd.add(h.date)
        if project.is_cfmeu:
            for c in CFMEUDate.query.all():
                if 'ALL' in c.states_list() or project.state in c.states_list():
                    project_nwd.add(c.date)

    # Equipment requirements with coverage
    equip_reqs = (ProjectEquipmentRequirement.query
                  .filter_by(project_id=project_id)
                  .order_by(ProjectEquipmentRequirement.label)
                  .all())
    # Active breakdowns by machine id
    own_breakdowns = {b.machine_id: b for b in
                      MachineBreakdown.query.filter(
                          MachineBreakdown.machine_id.isnot(None),
                          MachineBreakdown.repair_status != 'completed').all()}
    hired_breakdowns = {b.hired_machine_id: b for b in
                        MachineBreakdown.query.filter(
                            MachineBreakdown.hired_machine_id.isnot(None),
                            MachineBreakdown.repair_status != 'completed').all()}
    equip_coverage = []
    for er in equip_reqs:
        assignments_for_req = er.assignments
        assigned = len(assignments_for_req)
        gap = max(0, er.required_count - assigned)
        machines = []
        for a in assignments_for_req:
            broken = (own_breakdowns.get(a.machine_id) if a.machine_id else
                      hired_breakdowns.get(a.hired_machine_id))
            machines.append({'assignment': a, 'broken': broken})
        equip_coverage.append({
            'req': er,
            'label': er.label,
            'required': er.required_count,
            'machines': machines,
            'assigned': assigned,
            'gap': gap,
        })

    all_projects = Project.query.filter_by(active=True).order_by(Project.name).all()
    machine_groups = MachineGroup.query.filter_by(active=True).order_by(MachineGroup.name).all()
    all_machines = Machine.query.filter_by(active=True).order_by(Machine.name).all()

    # All machines directly assigned to this project (ProjectMachine)
    project_machines = ProjectMachine.query.filter_by(project_id=project_id).all()
    assigned_machine_ids = {pm.machine_id for pm in project_machines}
    # IDs of machines that are in a requirement assignment (to exclude from "other" list)
    req_machine_ids = set()
    for er in equip_reqs:
        for a in er.assignments:
            if a.machine_id:
                req_machine_ids.add(a.machine_id)
    # "Other equipment" = assigned to project but not in any requirement
    other_machines = [pm for pm in project_machines if pm.machine_id not in req_machine_ids]

    all_proj_ordered = Project.query.order_by(Project.id).all()
    project_colour_map = {
        p.id: SCHED_PALETTE[i % len(SCHED_PALETTE)]
        for i, p in enumerate(all_proj_ordered)
    }

    return render_template(
        'scheduling/project.html',
        project=project,
        date_list=date_list,
        week_start=week_start,
        week_end=week_end,
        prev_period=prev_period,
        next_period=next_period,
        assignments=assignments,
        assigned_employees=assigned_employees,
        emp_scheduled_role_name=emp_scheduled_role_name,
        grid=grid,
        budgeted=budgeted,
        role_coverage=role_coverage,
        all_employees=all_employees,
        emp_roles_data=emp_roles_data,
        all_projects=all_projects,
        machine_groups=machine_groups,
        all_machines=all_machines,
        assigned_machine_ids=assigned_machine_ids,
        project_nwd=project_nwd,
        equip_coverage=equip_coverage,
        other_machines=other_machines,
        project_colour_map=project_colour_map,
        today=date.today()
    )


# ---------------------------------------------------------------------------
# Scheduling — assignment management
# ---------------------------------------------------------------------------

@scheduling_bp.route('/scheduling/assign/add', methods=['POST'])
@require_role('admin')
def scheduling_assign_add():
    employee_id = request.form.get('employee_id', type=int)
    project_id = request.form.get('project_id', type=int)
    date_from_str = request.form.get('date_from', '').strip()
    date_to_str = request.form.get('date_to', '').strip()
    notes = request.form.get('notes', '').strip()
    redirect_to = request.form.get('redirect_to', 'scheduling_overview')
    redirect_project = request.form.get('redirect_project_id', type=int)

    try:
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date() if date_to_str else None
    except ValueError:
        flash('Invalid date format.', 'danger')
        return redirect(url_for('scheduling.scheduling_overview'))

    if not employee_id or not project_id:
        flash('Employee and project are required.', 'danger')
        return redirect(url_for('scheduling.scheduling_overview'))

    scheduled_role_id = request.form.get('scheduled_role_id', type=int) or None
    pa = ProjectAssignment(
        employee_id=employee_id,
        project_id=project_id,
        date_from=date_from,
        date_to=date_to,
        notes=notes or None,
        scheduled_role_id=scheduled_role_id,
    )
    db.session.add(pa)
    db.session.commit()
    flash('Assignment added.', 'success')

    if redirect_to == 'scheduling_project' and redirect_project:
        return redirect(url_for('scheduling.scheduling_project', project_id=redirect_project))
    return redirect(url_for('scheduling.scheduling_overview'))


@scheduling_bp.route('/scheduling/assign/<int:pa_id>/edit', methods=['POST'])
@require_role('admin', 'supervisor')
def scheduling_assign_edit(pa_id):
    pa = ProjectAssignment.query.get_or_404(pa_id)
    is_ajax = request.headers.get('X-Requested-With') == 'XMLHttpRequest'

    date_from_str = request.form.get('date_from', '').strip()
    date_to_str = request.form.get('date_to', '').strip()
    try:
        if date_from_str:
            pa.date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        if date_to_str:
            pa.date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
        elif 'clear_end_date' in request.form:
            pa.date_to = None
    except ValueError:
        pass

    notes = request.form.get('notes', '').strip()
    pa.notes = notes or pa.notes

    project_id_str = request.form.get('project_id', '').strip()
    if project_id_str:
        pa.project_id = int(project_id_str)

    db.session.commit()

    if is_ajax:
        return jsonify({'ok': True})
    flash('Assignment updated.', 'success')
    redirect_to = request.form.get('redirect_to', '')
    if redirect_to == 'travel':
        return redirect(url_for('scheduling.travel_overview'))
    return redirect(url_for('scheduling.scheduling_overview'))


@scheduling_bp.route('/scheduling/assign/<int:pa_id>/delete', methods=['POST'])
@require_role('admin')
def scheduling_assign_delete(pa_id):
    pa = ProjectAssignment.query.get_or_404(pa_id)
    project_id = pa.project_id
    redirect_to = request.form.get('redirect_to', 'scheduling_overview')
    db.session.delete(pa)
    db.session.commit()
    flash('Assignment removed.', 'success')
    if redirect_to == 'scheduling_project':
        return redirect(url_for('scheduling.scheduling_project', project_id=project_id))
    if redirect_to == 'travel':
        return redirect(url_for('scheduling.travel_overview'))
    return redirect(url_for('scheduling.scheduling_overview'))


# ---------------------------------------------------------------------------
# Scheduling — leave management
# ---------------------------------------------------------------------------

@scheduling_bp.route('/scheduling/leave/add', methods=['POST'])
@require_role('admin')
def scheduling_leave_add():
    employee_id = request.form.get('employee_id', type=int)
    date_from_str = request.form.get('date_from', '').strip()
    date_to_str = request.form.get('date_to', '').strip()
    leave_type = request.form.get('leave_type', 'annual').strip()
    notes = request.form.get('notes', '').strip()
    redirect_project = request.form.get('redirect_project_id', type=int)

    try:
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
    except ValueError:
        flash('Invalid date format.', 'danger')
        return redirect(url_for('scheduling.scheduling_overview'))

    if not employee_id:
        flash('Employee is required.', 'danger')
        return redirect(url_for('scheduling.scheduling_overview'))

    lv = EmployeeLeave(
        employee_id=employee_id,
        date_from=date_from,
        date_to=date_to,
        leave_type=leave_type,
        notes=notes or None
    )
    db.session.add(lv)
    db.session.commit()
    flash('Leave recorded.', 'success')

    if redirect_project:
        return redirect(url_for('scheduling.scheduling_project', project_id=redirect_project))
    return redirect(url_for('scheduling.scheduling_overview'))


@scheduling_bp.route('/scheduling/leave/<int:leave_id>/delete', methods=['POST'])
@require_role('admin')
def scheduling_leave_delete(leave_id):
    lv = EmployeeLeave.query.get_or_404(leave_id)
    redirect_project = request.form.get('redirect_project_id', type=int)
    db.session.delete(lv)
    db.session.commit()
    flash('Leave removed.', 'success')
    if redirect_project:
        return redirect(url_for('scheduling.scheduling_project', project_id=redirect_project))
    return redirect(url_for('scheduling.scheduling_overview'))


# ---------------------------------------------------------------------------
# Scheduling — single-day override
# ---------------------------------------------------------------------------

@scheduling_bp.route('/scheduling/override', methods=['POST'])
@require_role('admin', 'supervisor')
def schedule_override():
    is_ajax = request.headers.get('X-Requested-With') == 'XMLHttpRequest'

    employee_id = request.form.get('employee_id', type=int)
    date_str = request.form.get('date', '').strip()
    action = request.form.get('action', 'set')
    week = request.form.get('week', '')
    redirect_project = request.form.get('redirect_project_id', type=int)

    try:
        override_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        if is_ajax:
            return jsonify({'ok': False, 'error': 'Invalid date'}), 400
        flash('Invalid date.', 'danger')
        if redirect_project:
            return redirect(url_for('scheduling.scheduling_project', project_id=redirect_project, week=week))
        return redirect(url_for('scheduling.scheduling_overview', week=week))

    existing = ScheduleDayOverride.query.filter_by(
        employee_id=employee_id, date=override_date
    ).first()

    if action == 'clear':
        if existing:
            db.session.delete(existing)
            db.session.commit()
    else:
        status = request.form.get('status', 'available')
        project_id = request.form.get('project_id', type=int)
        notes = request.form.get('notes', '').strip() or None
        is_half_day = request.form.get('is_half_day') == '1'
        if existing:
            existing.status = status
            existing.project_id = project_id if status in ('project', 'travel') else None
            existing.is_half_day = is_half_day if status == 'travel' else False
            existing.notes = notes
        else:
            db.session.add(ScheduleDayOverride(
                employee_id=employee_id,
                date=override_date,
                status=status,
                project_id=project_id if status in ('project', 'travel') else None,
                is_half_day=is_half_day if status == 'travel' else False,
                notes=notes,
            ))
        db.session.commit()

    if is_ajax:
        return jsonify({'ok': True})

    if redirect_project:
        return redirect(url_for('scheduling.scheduling_project', project_id=redirect_project, week=week))
    return redirect(url_for('scheduling.scheduling_overview', week=week))


# ---------------------------------------------------------------------------
# Admin — swing patterns
# ---------------------------------------------------------------------------

@scheduling_bp.route('/admin/swings', methods=['GET', 'POST'])
@require_role('admin')
def admin_swings():
    if request.method == 'POST':
        action = request.form.get('action')

        if action == 'add_pattern':
            name = request.form.get('name', '').strip()
            work_weeks = request.form.get('work_weeks', type=int)
            off_days = request.form.get('off_days', type=int)
            description = request.form.get('description', '').strip()
            if not name or not work_weeks or not off_days:
                flash('Name, work weeks, and off days are required.', 'danger')
            else:
                sp = SwingPattern(name=name, work_weeks=work_weeks, off_days=off_days,
                                  description=description or None)
                db.session.add(sp)
                db.session.commit()
                flash(f'Pattern "{name}" added.', 'success')

        elif action == 'delete_pattern':
            pattern_id = request.form.get('pattern_id', type=int)
            sp = SwingPattern.query.get(pattern_id)
            if sp:
                EmployeeSwing.query.filter_by(pattern_id=sp.id).delete()
                db.session.delete(sp)
                db.session.commit()
                flash('Pattern deleted.', 'success')

        elif action == 'assign_swing':
            employee_id = request.form.get('employee_id', type=int)
            pattern_id = request.form.get('pattern_id', type=int)
            start_date_str = request.form.get('start_date', '').strip()
            day_offset = request.form.get('day_offset', 0, type=int)
            notes = request.form.get('notes', '').strip()
            try:
                start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
            except ValueError:
                flash('Invalid start date.', 'danger')
                return redirect(url_for('scheduling.admin_swings'))
            if not employee_id or not pattern_id:
                flash('Employee and pattern are required.', 'danger')
            else:
                es = EmployeeSwing(employee_id=employee_id, pattern_id=pattern_id,
                                   start_date=start_date, day_offset=day_offset,
                                   notes=notes or None)
                db.session.add(es)
                db.session.commit()
                flash('Swing pattern assigned.', 'success')

        elif action == 'delete_swing':
            swing_id = request.form.get('swing_id', type=int)
            es = EmployeeSwing.query.get(swing_id)
            if es:
                db.session.delete(es)
                db.session.commit()
                flash('Swing assignment removed.', 'success')

        return redirect(url_for('scheduling.admin_swings'))

    patterns = SwingPattern.query.order_by(SwingPattern.name).all()
    employees = Employee.query.filter_by(active=True).order_by(Employee.role, Employee.name).all()
    # Load all swing assignments with employee + pattern eager
    swing_assignments = EmployeeSwing.query.order_by(EmployeeSwing.employee_id, EmployeeSwing.start_date).all()

    return render_template('admin/swings.html',
                           patterns=patterns,
                           employees=employees,
                           swing_assignments=swing_assignments)


# ---------------------------------------------------------------------------
# Day details — AJAX endpoint for the enhanced modal
# ---------------------------------------------------------------------------

@scheduling_bp.route('/scheduling/day-details/<int:emp_id>/<string:date_str>')
@login_required
def day_details(emp_id, date_str):
    """Return flight bookings, accommodation, and override info for one employee + date."""
    try:
        d = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'ok': False, 'error': 'Invalid date'}), 400

    # Site users can only view their own details
    if current_user.role == 'site':
        emp = Employee.query.get(emp_id)
        if not emp or current_user.employee_id != emp_id:
            return jsonify({'ok': False, 'error': 'Access denied'}), 403

    employee = Employee.query.get_or_404(emp_id)

    # Flights for this date
    flights = FlightBooking.query.filter_by(employee_id=emp_id, date=d).order_by(FlightBooking.direction).all()

    # Active accommodation covering this date
    accommodations = AccommodationBooking.query.filter(
        AccommodationBooking.employee_id == emp_id,
        AccommodationBooking.date_from <= d,
        AccommodationBooking.date_to >= d
    ).all()

    # Override for this date (for half-day info)
    override = ScheduleDayOverride.query.filter_by(employee_id=emp_id, date=d).first()

    return jsonify({
        'ok': True,
        'employee_name': employee.name,
        'requires_accommodation': employee.requires_accommodation if employee.requires_accommodation is not None else True,
        'flights': [{
            'id': f.id,
            'direction': f.direction,
            'airline': f.airline,
            'flight_number': f.flight_number,
            'departure_airport': f.departure_airport,
            'departure_time': f.departure_time,
            'arrival_airport': f.arrival_airport,
            'arrival_time': f.arrival_time,
            'booking_reference': f.booking_reference,
            'notes': f.notes,
        } for f in flights],
        'accommodations': [{
            'id': a.id,
            'date_from': a.date_from.isoformat(),
            'date_to': a.date_to.isoformat(),
            'property_name': a.property_name,
            'address': a.address,
            'phone': a.phone,
            'room_info': a.room_info,
            'booking_reference': a.booking_reference,
            'check_in_time': a.check_in_time,
            'check_out_time': a.check_out_time,
            'notes': a.notes,
        } for a in accommodations],
        'override': {
            'id': override.id,
            'status': override.status,
            'project_id': override.project_id,
            'is_half_day': override.is_half_day if override.is_half_day is not None else False,
            'notes': override.notes,
        } if override else None,
    })


# ---------------------------------------------------------------------------
# Travel & Accommodation overview page
# ---------------------------------------------------------------------------

@scheduling_bp.route('/scheduling/travel')
@require_role('admin', 'supervisor')
def travel_overview():
    """Shows upcoming travel, accommodation, and travel groupings."""
    today = date.today()
    look_ahead = today + timedelta(days=90)

    # Upcoming flights (next 90 days)
    upcoming_flights = (FlightBooking.query
        .filter(FlightBooking.date >= today, FlightBooking.date <= look_ahead)
        .order_by(FlightBooking.date, FlightBooking.departure_time)
        .all())

    # Group flights by (date, departure_airport, arrival_airport) to find travel buddies
    flight_groups = {}
    for f in upcoming_flights:
        key = (f.date, f.departure_airport or '', f.arrival_airport or '')
        flight_groups.setdefault(key, []).append(f)

    travel_groups = []
    solo_flights = []
    for (fdate, dep, arr), flights in sorted(flight_groups.items()):
        if len(flights) > 1:
            travel_groups.append({
                'date': fdate,
                'departure': dep,
                'arrival': arr,
                'flights': flights,
                'employees': [f.employee for f in flights],
            })
        else:
            solo_flights.append(flights[0])

    # People who need accommodation (requires_accommodation=True, active, assigned to a project)
    active_assignments = (ProjectAssignment.query
        .filter(
            db.or_(ProjectAssignment.date_to.is_(None), ProjectAssignment.date_to >= today),
            ProjectAssignment.date_from <= look_ahead,
        ).all())
    assigned_emp_ids = {a.employee_id for a in active_assignments}
    need_accom_emps = (Employee.query
        .filter(Employee.active == True, Employee.requires_accommodation == True,
                Employee.id.in_(assigned_emp_ids))
        .order_by(Employee.name).all())

    # Current accommodation bookings
    current_bookings = (AccommodationBooking.query
        .filter(AccommodationBooking.date_to >= today)
        .order_by(AccommodationBooking.date_from)
        .all())
    booked_emp_ids = {b.employee_id for b in current_bookings if b.date_from <= look_ahead}

    # Employees needing accommodation but not booked
    unbooked = [e for e in need_accom_emps if e.id not in booked_emp_ids]

    # Accommodation properties
    properties = (AccommodationProperty.query
        .filter_by(active=True)
        .order_by(AccommodationProperty.name)
        .all())

    employees = Employee.query.filter_by(active=True).order_by(Employee.name).all()
    projects = Project.query.filter_by(active=True).order_by(Project.name).all()

    # Build swing planner from project assignments
    planner = build_swing_planner(employees, look_ahead_days=90)
    swings = planner['swings']
    expiring_properties = planner['expiring_properties']

    # Group swings by project
    swings_by_project = {}
    for s in swings:
        swings_by_project.setdefault(s['project_id'], []).append(s)

    # Build project sections with accommodation info
    project_sections = []
    for proj in projects:
        proj_swings = swings_by_project.get(proj.id, [])
        if not proj_swings:
            continue
        # Properties linked to this project
        proj_properties = [p for p in properties if p.project_id == proj.id]
        # Issues count
        issues_count = sum(1 for s in proj_swings if s['has_issues'])
        project_sections.append({
            'project': proj,
            'swings': sorted(proj_swings, key=lambda s: s['employee_name']),
            'properties': proj_properties,
            'issues_count': issues_count,
        })
    project_sections.sort(key=lambda ps: ps['project'].name)

    # Carpool groups
    carpool_groups = []
    travel_groups_map = {}
    for s in swings:
        for direction in ('to', 'from'):
            transport = s[f'transport_{direction}']
            if transport not in ('fly', 'drive'):
                continue
            if direction == 'to':
                key = (s['travel_to_date'], s.get('home_location', ''), s.get('project_city', ''))
            else:
                key = (s['travel_from_date'], s.get('project_city', ''), s.get('home_location', ''))
            if key[1] and key[2]:
                travel_groups_map.setdefault(key, []).append(s)
    for (d, frm, to), members in sorted(travel_groups_map.items()):
        if len(members) > 1:
            carpool_groups.append({'date': d, 'from': frm, 'to': to, 'members': members})

    return render_template(
        'scheduling/travel.html',
        today=today,
        expiry_warn_date=today + timedelta(days=30),
        travel_groups=travel_groups,
        solo_flights=solo_flights,
        upcoming_flights=upcoming_flights,
        unbooked=unbooked,
        current_bookings=current_bookings,
        properties=properties,
        employees=employees,
        projects=projects,
        project_sections=project_sections,
        swings=swings,
        expiring_properties=expiring_properties,
        carpool_groups=carpool_groups,
    )


# ---------------------------------------------------------------------------
# Accommodation Property CRUD
# ---------------------------------------------------------------------------

@scheduling_bp.route('/scheduling/property/add', methods=['POST'])
@require_role('admin', 'supervisor')
def property_add():
    prop = AccommodationProperty(
        name=request.form.get('prop_name', '').strip(),
        property_type=request.form.get('property_type', 'house').strip(),
        address=request.form.get('prop_address', '').strip() or None,
        phone=request.form.get('prop_phone', '').strip() or None,
        bedrooms=int(request.form.get('bedrooms', 1) or 1),
        project_id=int(request.form.get('project_id')) if request.form.get('project_id') else None,
        booking_reference=request.form.get('prop_booking_ref', '').strip() or None,
        check_in_time=request.form.get('prop_check_in', '').strip() or None,
        check_out_time=request.form.get('prop_check_out', '').strip() or None,
        instructions=request.form.get('prop_instructions', '').strip() or None,
        notes=request.form.get('prop_notes', '').strip() or None,
        created_by_id=current_user.id,
    )
    date_from_str = request.form.get('prop_date_from', '').strip()
    date_to_str = request.form.get('prop_date_to', '').strip()
    try:
        if date_from_str:
            prop.date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        if date_to_str:
            prop.date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
    except ValueError:
        pass
    db.session.add(prop)
    db.session.commit()
    flash(f'Property "{prop.name}" added.', 'success')
    return redirect(url_for('scheduling.travel_overview'))


@scheduling_bp.route('/scheduling/property/<int:prop_id>/edit', methods=['POST'])
@require_role('admin', 'supervisor')
def property_edit(prop_id):
    prop = AccommodationProperty.query.get_or_404(prop_id)
    prop.name = request.form.get('prop_name', '').strip() or prop.name
    prop.property_type = request.form.get('property_type', prop.property_type).strip()
    prop.address = request.form.get('prop_address', '').strip() or None
    prop.phone = request.form.get('prop_phone', '').strip() or None
    prop.bedrooms = int(request.form.get('bedrooms', prop.bedrooms) or prop.bedrooms)
    prop.project_id = int(request.form.get('project_id')) if request.form.get('project_id') else None
    prop.booking_reference = request.form.get('prop_booking_ref', '').strip() or None
    prop.check_in_time = request.form.get('prop_check_in', '').strip() or None
    prop.check_out_time = request.form.get('prop_check_out', '').strip() or None
    prop.instructions = request.form.get('prop_instructions', '').strip() or None
    prop.notes = request.form.get('prop_notes', '').strip() or None
    date_from_str = request.form.get('prop_date_from', '').strip()
    date_to_str = request.form.get('prop_date_to', '').strip()
    try:
        prop.date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date() if date_from_str else None
        prop.date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date() if date_to_str else None
    except ValueError:
        pass
    db.session.commit()
    flash('Property updated.', 'success')
    return redirect(url_for('scheduling.travel_overview'))


@scheduling_bp.route('/scheduling/property/<int:prop_id>/delete', methods=['POST'])
@require_role('admin')
def property_delete(prop_id):
    prop = AccommodationProperty.query.get_or_404(prop_id)
    db.session.delete(prop)
    db.session.commit()
    flash(f'Property "{prop.name}" deleted.', 'success')
    return redirect(url_for('scheduling.travel_overview'))


@scheduling_bp.route('/scheduling/property/<int:prop_id>/assign', methods=['POST'])
@require_role('admin', 'supervisor')
def property_assign(prop_id):
    """Assign an employee to an accommodation property."""
    prop = AccommodationProperty.query.get_or_404(prop_id)
    employee_id = request.form.get('employee_id', type=int)
    date_from_str = request.form.get('assign_date_from', '').strip()
    date_to_str = request.form.get('assign_date_to', '').strip()
    try:
        d_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        d_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
    except ValueError:
        flash('Invalid dates.', 'danger')
        return redirect(url_for('scheduling.travel_overview'))

    booking = AccommodationBooking(
        employee_id=employee_id,
        property_id=prop.id,
        date_from=d_from,
        date_to=d_to,
        room_info=request.form.get('room_info', '').strip() or None,
        notes=request.form.get('assign_notes', '').strip() or None,
        created_by_id=current_user.id,
    )
    db.session.add(booking)
    db.session.commit()
    flash(f'Employee assigned to "{prop.name}".', 'success')
    _notify_travel_change(employee_id, d_from, 'accommodation', 'added')
    return redirect(url_for('scheduling.travel_overview'))


@scheduling_bp.route('/scheduling/property/<int:prop_id>/document/upload', methods=['POST'])
@require_role('admin', 'supervisor')
def property_document_upload(prop_id):
    """Upload a document to an accommodation property."""
    import uuid
    prop = AccommodationProperty.query.get_or_404(prop_id)
    file = request.files.get('document')
    if not file or not file.filename:
        flash('No file selected.', 'danger')
        return redirect(url_for('scheduling.travel_overview'))

    ext = os.path.splitext(file.filename)[1].lower()
    stored_name = f"accom_{uuid.uuid4().hex}{ext}"

    upload_dir = os.path.join(current_app.root_path, 'uploads', 'accommodation')
    os.makedirs(upload_dir, exist_ok=True)
    file.save(os.path.join(upload_dir, stored_name))

    doc = AccommodationDocument(
        property_id=prop.id,
        filename=stored_name,
        original_name=file.filename,
        doc_type=request.form.get('doc_type', 'other').strip(),
        title=request.form.get('doc_title', '').strip() or file.filename,
        notes=request.form.get('doc_notes', '').strip() or None,
        uploaded_by_user_id=current_user.id,
    )
    db.session.add(doc)
    db.session.commit()
    flash(f'Document uploaded to "{prop.name}".', 'success')
    return redirect(url_for('scheduling.travel_overview'))


@scheduling_bp.route('/scheduling/accommodation-doc/<filename>')
@login_required
def accommodation_document(filename):
    """Serve an accommodation document."""
    upload_dir = os.path.join(current_app.root_path, 'uploads', 'accommodation')
    from flask import send_from_directory
    return send_from_directory(upload_dir, filename)


@scheduling_bp.route('/scheduling/property/<int:prop_id>/document/<int:doc_id>/delete', methods=['POST'])
@require_role('admin', 'supervisor')
def property_document_delete(prop_id, doc_id):
    doc = AccommodationDocument.query.get_or_404(doc_id)
    upload_dir = os.path.join(current_app.root_path, 'uploads', 'accommodation')
    try:
        os.remove(os.path.join(upload_dir, doc.filename))
    except OSError:
        pass
    db.session.delete(doc)
    db.session.commit()
    flash('Document deleted.', 'success')
    return redirect(url_for('scheduling.travel_overview'))


# ---------------------------------------------------------------------------
# Flight booking CRUD
# ---------------------------------------------------------------------------

@scheduling_bp.route('/scheduling/flight/add', methods=['POST'])
@require_role('admin', 'supervisor')
def flight_add():
    is_ajax = request.headers.get('X-Requested-With') == 'XMLHttpRequest'
    employee_id = request.form.get('employee_id', type=int)
    date_str = request.form.get('date', '').strip()

    try:
        flight_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        if is_ajax:
            return jsonify({'ok': False, 'error': 'Invalid date'}), 400
        flash('Invalid date.', 'danger')
        return redirect(url_for('scheduling.scheduling_overview'))

    fb = FlightBooking(
        employee_id=employee_id,
        date=flight_date,
        direction=request.form.get('direction', 'outbound').strip(),
        airline=request.form.get('airline', '').strip() or None,
        flight_number=request.form.get('flight_number', '').strip() or None,
        departure_airport=request.form.get('departure_airport', '').strip() or None,
        departure_time=request.form.get('departure_time', '').strip() or None,
        arrival_airport=request.form.get('arrival_airport', '').strip() or None,
        arrival_time=request.form.get('arrival_time', '').strip() or None,
        booking_reference=request.form.get('booking_reference', '').strip() or None,
        notes=request.form.get('flight_notes', '').strip() or None,
        created_by_id=current_user.id,
    )
    db.session.add(fb)
    db.session.commit()

    # Send push notification to the employee
    _notify_travel_change(employee_id, flight_date, 'flight', 'added')

    if is_ajax:
        return jsonify({'ok': True, 'flight_id': fb.id})
    flash('Flight booking added.', 'success')
    if request.form.get('redirect_to') == 'travel':
        return redirect(url_for('scheduling.travel_overview'))
    return redirect(url_for('scheduling.scheduling_overview'))


@scheduling_bp.route('/scheduling/flight/<int:flight_id>/edit', methods=['POST'])
@require_role('admin', 'supervisor')
def flight_edit(flight_id):
    is_ajax = request.headers.get('X-Requested-With') == 'XMLHttpRequest'
    fb = FlightBooking.query.get_or_404(flight_id)

    fb.direction = request.form.get('direction', fb.direction).strip()
    fb.airline = request.form.get('airline', '').strip() or None
    fb.flight_number = request.form.get('flight_number', '').strip() or None
    fb.departure_airport = request.form.get('departure_airport', '').strip() or None
    fb.departure_time = request.form.get('departure_time', '').strip() or None
    fb.arrival_airport = request.form.get('arrival_airport', '').strip() or None
    fb.arrival_time = request.form.get('arrival_time', '').strip() or None
    fb.booking_reference = request.form.get('booking_reference', '').strip() or None
    fb.notes = request.form.get('flight_notes', '').strip() or None
    db.session.commit()

    _notify_travel_change(fb.employee_id, fb.date, 'flight', 'updated')

    if is_ajax:
        return jsonify({'ok': True})
    flash('Flight booking updated.', 'success')
    return redirect(url_for('scheduling.scheduling_overview'))


@scheduling_bp.route('/scheduling/flight/<int:flight_id>/delete', methods=['POST'])
@require_role('admin', 'supervisor')
def flight_delete(flight_id):
    is_ajax = request.headers.get('X-Requested-With') == 'XMLHttpRequest'
    fb = FlightBooking.query.get_or_404(flight_id)
    emp_id, flight_date = fb.employee_id, fb.date
    db.session.delete(fb)
    db.session.commit()

    _notify_travel_change(emp_id, flight_date, 'flight', 'removed')

    if is_ajax:
        return jsonify({'ok': True})
    flash('Flight booking deleted.', 'success')
    return redirect(url_for('scheduling.scheduling_overview'))


# ---------------------------------------------------------------------------
# Accommodation booking CRUD
# ---------------------------------------------------------------------------

@scheduling_bp.route('/scheduling/accommodation/add', methods=['POST'])
@require_role('admin', 'supervisor')
def accommodation_add():
    is_ajax = request.headers.get('X-Requested-With') == 'XMLHttpRequest'
    employee_id = request.form.get('employee_id', type=int)
    date_from_str = request.form.get('accom_date_from', '').strip()
    date_to_str = request.form.get('accom_date_to', '').strip()

    try:
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
    except ValueError:
        if is_ajax:
            return jsonify({'ok': False, 'error': 'Invalid dates'}), 400
        flash('Invalid dates.', 'danger')
        return redirect(url_for('scheduling.scheduling_overview'))

    ab = AccommodationBooking(
        employee_id=employee_id,
        date_from=date_from,
        date_to=date_to,
        property_name=request.form.get('property_name', '').strip() or None,
        address=request.form.get('accom_address', '').strip() or None,
        phone=request.form.get('accom_phone', '').strip() or None,
        room_info=request.form.get('room_info', '').strip() or None,
        booking_reference=request.form.get('accom_booking_ref', '').strip() or None,
        check_in_time=request.form.get('check_in_time', '').strip() or None,
        check_out_time=request.form.get('check_out_time', '').strip() or None,
        notes=request.form.get('accom_notes', '').strip() or None,
        created_by_id=current_user.id,
    )
    db.session.add(ab)
    db.session.commit()

    _notify_travel_change(employee_id, date_from, 'accommodation', 'added')

    if is_ajax:
        return jsonify({'ok': True, 'accommodation_id': ab.id})
    flash('Accommodation booking added.', 'success')
    return redirect(url_for('scheduling.scheduling_overview'))


@scheduling_bp.route('/scheduling/accommodation/<int:accom_id>/edit', methods=['POST'])
@require_role('admin', 'supervisor')
def accommodation_edit(accom_id):
    is_ajax = request.headers.get('X-Requested-With') == 'XMLHttpRequest'
    ab = AccommodationBooking.query.get_or_404(accom_id)

    date_from_str = request.form.get('accom_date_from', '').strip()
    date_to_str = request.form.get('accom_date_to', '').strip()
    try:
        if date_from_str:
            ab.date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        if date_to_str:
            ab.date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
    except ValueError:
        pass

    ab.property_name = request.form.get('property_name', '').strip() or None
    ab.address = request.form.get('accom_address', '').strip() or None
    ab.phone = request.form.get('accom_phone', '').strip() or None
    ab.room_info = request.form.get('room_info', '').strip() or None
    ab.booking_reference = request.form.get('accom_booking_ref', '').strip() or None
    ab.check_in_time = request.form.get('check_in_time', '').strip() or None
    ab.check_out_time = request.form.get('check_out_time', '').strip() or None
    ab.notes = request.form.get('accom_notes', '').strip() or None
    db.session.commit()

    _notify_travel_change(ab.employee_id, ab.date_from, 'accommodation', 'updated')

    if is_ajax:
        return jsonify({'ok': True})
    flash('Accommodation booking updated.', 'success')
    return redirect(url_for('scheduling.scheduling_overview'))


@scheduling_bp.route('/scheduling/accommodation/<int:accom_id>/delete', methods=['POST'])
@require_role('admin', 'supervisor')
def accommodation_delete(accom_id):
    is_ajax = request.headers.get('X-Requested-With') == 'XMLHttpRequest'
    ab = AccommodationBooking.query.get_or_404(accom_id)
    emp_id, d_from = ab.employee_id, ab.date_from
    db.session.delete(ab)
    db.session.commit()

    _notify_travel_change(emp_id, d_from, 'accommodation', 'removed')

    if is_ajax:
        return jsonify({'ok': True})
    flash('Accommodation booking deleted.', 'success')
    return redirect(url_for('scheduling.scheduling_overview'))


# ---------------------------------------------------------------------------
# Helper: send push notification when travel details change
# ---------------------------------------------------------------------------

def _notify_travel_change(employee_id, travel_date, detail_type, action):
    """Send push notification to the affected employee when flight/accommodation changes."""
    from utils.notifications import send_notification
    from models import DeviceToken

    employee = Employee.query.get(employee_id)
    if not employee:
        return

    # Find the User linked to this employee
    user = User.query.filter_by(employee_id=employee_id, active=True).first()
    if not user:
        return

    tokens = DeviceToken.query.filter_by(user_id=user.id).all()
    if not tokens:
        return

    date_display = travel_date.strftime('%a %d %b %Y')
    if detail_type == 'flight':
        title = 'Flight details updated'
        body = f'Your flight details for {date_display} have been {action}.'
    else:
        title = 'Accommodation details updated'
        body = f'Your accommodation details for {date_display} have been {action}.'

    for device in tokens:
        send_notification(
            token=device.token,
            title=title,
            body=body,
            data={'type': f'travel_{detail_type}_{action}', 'date': travel_date.isoformat(),
                  'employee_id': str(employee_id)},
        )
