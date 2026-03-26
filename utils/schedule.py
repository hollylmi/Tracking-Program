from collections import defaultdict
from datetime import date, timedelta

from models import (db, ProjectAssignment, EmployeeLeave, EmployeeSwing,
                    ScheduleDayOverride, Project, PublicHoliday, CFMEUDate,
                    ProjectWorkedSunday)


def build_day_summary(hm, date_from, date_to):
    """Return a list of dicts for each day in range, plus summary counts.
    Public holidays and CFMEU dates for the machine's project are treated
    as non-working days (no hire charge)."""
    sd_map = {sd.stand_down_date: sd.reason for sd in hm.stand_downs}
    count_saturdays = hm.count_saturdays if hm.count_saturdays is not None else True

    # Build set of public holidays + CFMEU dates for the machine's project
    project = hm.project
    non_charge_dates = set()
    non_charge_reasons = {}
    if project:
        for h in PublicHoliday.query.filter(
                PublicHoliday.date >= date_from, PublicHoliday.date <= date_to).all():
            if 'ALL' in h.states_list() or (project.state and project.state in h.states_list()):
                non_charge_dates.add(h.date)
                non_charge_reasons[h.date] = f'PH: {h.name}'
        if project.is_cfmeu:
            for c in CFMEUDate.query.filter(
                    CFMEUDate.date >= date_from, CFMEUDate.date <= date_to).all():
                if 'ALL' in c.states_list() or (project.state and project.state in c.states_list()):
                    non_charge_dates.add(c.date)
                    non_charge_reasons[c.date] = f'CFMEU: {c.name}'

    days = []
    current = date_from
    while current <= date_to:
        weekday = current.weekday()
        is_sunday = weekday == 6
        is_saturday = weekday == 5

        if is_sunday or (is_saturday and not count_saturdays):
            status = 'non_working'
            reason = ''
        elif hm.delivery_date and current < hm.delivery_date:
            status = 'not_delivered'
            reason = ''
        elif hm.return_date and current > hm.return_date:
            status = 'returned'
            reason = ''
        elif current in non_charge_dates:
            status = 'non_working'
            reason = non_charge_reasons.get(current, 'Public Holiday / RDO')
        elif current in sd_map:
            status = 'stood_down'
            reason = sd_map[current]
        else:
            status = 'on_site'
            reason = ''

        days.append({
            'date': current,
            'day_name': current.strftime('%A'),
            'status': status,
            'reason': reason or sd_map.get(current, ''),
        })
        current += timedelta(days=1)

    on_site    = sum(1 for d in days if d['status'] == 'on_site')
    stood_down = sum(1 for d in days if d['status'] == 'stood_down')
    non_working = sum(1 for d in days if d['status'] == 'non_working')
    working_days = on_site + stood_down
    days_pw = 6 if count_saturdays else 5
    cost_per_day_derived = hm.cost_per_week / days_pw if hm.cost_per_week else None
    summary = {
        'on_site': on_site,
        'stood_down': stood_down,
        'non_working': non_working,
        'working_days': working_days,
        'total_days': len(days),
        'cost_day': round(on_site * cost_per_day_derived, 2) if cost_per_day_derived else None,
        'cost_per_day_derived': round(cost_per_day_derived, 2) if cost_per_day_derived else None,
        'cost_week': hm.cost_per_week,
        'count_saturdays': count_saturdays,
    }
    return days, summary


def build_schedule_grid(employees, date_list):
    """
    Build a status grid for the given employees over the given dates.
    Returns: grid[employee_id][date_iso_str] = {status, label, project_name}
    Status priority: leave > rdo > assigned > available
    """
    if not employees or not date_list:
        return {}

    emp_ids = [e.id for e in employees]
    min_date = min(date_list)
    max_date = max(date_list)

    assignments = ProjectAssignment.query.filter(
        ProjectAssignment.employee_id.in_(emp_ids),
        ProjectAssignment.date_from <= max_date,
        db.or_(ProjectAssignment.date_to.is_(None), ProjectAssignment.date_to >= min_date)
    ).all()

    leaves = EmployeeLeave.query.filter(
        EmployeeLeave.employee_id.in_(emp_ids),
        EmployeeLeave.date_from <= max_date,
        EmployeeLeave.date_to >= min_date
    ).all()

    swings = EmployeeSwing.query.filter(
        EmployeeSwing.employee_id.in_(emp_ids),
        EmployeeSwing.start_date <= max_date
    ).order_by(EmployeeSwing.employee_id, EmployeeSwing.start_date).all()

    assign_by_emp = defaultdict(list)
    for a in assignments:
        assign_by_emp[a.employee_id].append(a)

    leave_by_emp = defaultdict(list)
    for lv in leaves:
        leave_by_emp[lv.employee_id].append(lv)

    swing_by_emp = defaultdict(list)
    for s in swings:
        swing_by_emp[s.employee_id].append(s)

    overrides = ScheduleDayOverride.query.filter(
        ScheduleDayOverride.employee_id.in_(emp_ids),
        ScheduleDayOverride.date >= min_date,
        ScheduleDayOverride.date <= max_date
    ).all()
    override_by_emp = defaultdict(dict)
    for o in overrides:
        override_by_emp[o.employee_id][o.date] = o

    proj_ids = {a.project_id for a in assignments}
    project_info = {}
    if proj_ids:
        for p in Project.query.filter(Project.id.in_(proj_ids)).all():
            project_info[p.id] = p

    holidays_by_state = defaultdict(set)
    for h in PublicHoliday.query.filter(
            PublicHoliday.date >= min_date, PublicHoliday.date <= max_date).all():
        for s in h.states_list():
            holidays_by_state[s].add(h.date)
    cfmeu_by_state = defaultdict(set)
    for c in CFMEUDate.query.filter(
            CFMEUDate.date >= min_date, CFMEUDate.date <= max_date).all():
        for s in c.states_list():
            cfmeu_by_state[s].add(c.date)

    # Worked Sundays by project
    worked_sundays_by_project = defaultdict(set)
    for ws in ProjectWorkedSunday.query.filter(
            ProjectWorkedSunday.date >= min_date,
            ProjectWorkedSunday.date <= max_date).all():
        worked_sundays_by_project[ws.project_id].add(ws.date)

    grid = {}
    for emp in employees:
        grid[emp.id] = {}
        emp_swings = swing_by_emp.get(emp.id, [])
        emp_leaves = leave_by_emp.get(emp.id, [])
        emp_assigns = assign_by_emp.get(emp.id, [])

        for d in date_list:
            date_str = d.isoformat()

            # Priority 1: Single-day override (explicit manual entry)
            override = override_by_emp.get(emp.id, {}).get(d)
            if override:
                _OV_LABELS = {
                    'available': 'Available', 'annual': 'Annual Leave', 'sick': 'Sick',
                    'personal': 'Personal', 'r_and_r': 'R&R', 'travel': 'Travel',
                    'rdo': 'RDO', 'other': 'Leave',
                }
                if override.status == 'project' and override.project:
                    grid[emp.id][date_str] = {
                        'status': 'assigned',
                        'label': override.project.name[:16],
                        'project_name': override.project.name,
                        'override_id': override.id,
                        'override_status': override.status,
                        'override_project_id': override.project_id or '',
                    }
                else:
                    css = override.status if override.status in (
                        'r_and_r', 'travel', 'rdo', 'available') else 'leave'
                    grid[emp.id][date_str] = {
                        'status': css,
                        'label': _OV_LABELS.get(override.status, override.status.replace('_', ' ').title()),
                        'project_name': '',
                        'override_id': override.id,
                        'override_status': override.status,
                        'override_project_id': '',
                    }
                continue

            # Priority 2: Leave (r_and_r and travel get distinct visual status)
            _LEAVE_LABELS = {
                'annual': 'Annual Leave', 'sick': 'Sick', 'personal': 'Personal',
                'r_and_r': 'R&R', 'travel': 'Travel', 'other': 'Leave'
            }
            leave = next((lv for lv in emp_leaves if lv.date_from <= d <= lv.date_to), None)
            if leave:
                lt = leave.leave_type
                grid[emp.id][date_str] = {
                    'status': lt if lt in ('r_and_r', 'travel') else 'leave',
                    'label': _LEAVE_LABELS.get(lt, lt.title()),
                    'project_name': ''
                }
                continue

            # Priority 3: RDO — find the most recent swing whose start_date <= d
            applicable_swing = None
            for s in emp_swings:
                if s.start_date <= d:
                    applicable_swing = s
                # swings are ordered ASC so keep going to find latest
            if applicable_swing and applicable_swing.is_rdo(d):
                grid[emp.id][date_str] = {
                    'status': 'r_and_r',
                    'label': 'R&R',
                    'project_name': ''
                }
                continue

            # Priority 4: Project-based non-work day (public holiday or CFMEU date)
            active_assign = next(
                (a for a in emp_assigns
                 if a.date_from <= d and (a.date_to is None or a.date_to >= d)),
                None
            )
            if active_assign:
                proj = project_info.get(active_assign.project_id)
                if proj:
                    is_pub_holiday = bool(
                        d in holidays_by_state.get('ALL', set()) or
                        (proj.state and d in holidays_by_state.get(proj.state, set())))
                    is_cfmeu_day = bool(proj.is_cfmeu and (
                        d in cfmeu_by_state.get('ALL', set()) or
                        (proj.state and d in cfmeu_by_state.get(proj.state, set()))))
                    if is_pub_holiday or is_cfmeu_day:
                        grid[emp.id][date_str] = {
                            'status': 'rdo',
                            'label': 'PH' if is_pub_holiday else 'CFMEU',
                            'project_name': '',
                            'nwd_reason': 'Public Holiday' if is_pub_holiday else 'CFMEU RDO',
                        }
                        continue

            # Priority 5: Sunday check — off unless it's a worked Sunday for that project
            if d.weekday() == 6:
                is_worked_sunday = (
                    active_assign and
                    d in worked_sundays_by_project.get(active_assign.project_id, set())
                )
                if not is_worked_sunday:
                    grid[emp.id][date_str] = {
                        'status': 'sunday',
                        'label': 'Sun',
                        'project_name': ''
                    }
                    continue

            # Priority 6: Project assignment
            if active_assign:
                grid[emp.id][date_str] = {
                    'status': 'assigned',
                    'label': active_assign.project.name[:16],
                    'project_name': active_assign.project.name,
                    'project_id': active_assign.project_id,
                }
                continue

            # Default: available
            if d.weekday() == 6:
                grid[emp.id][date_str] = {
                    'status': 'sunday',
                    'label': 'Sun',
                    'project_name': ''
                }
            else:
                grid[emp.id][date_str] = {
                    'status': 'available',
                    'label': 'Available',
                    'project_name': ''
                }

    return grid
