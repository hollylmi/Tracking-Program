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
    FlightBooking, AccommodationBooking, User,
)
from utils.schedule import build_schedule_grid

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
