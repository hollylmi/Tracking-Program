import json
from models import DailyEntry, EntryProductionLine, PlannedData, Project
from utils.helpers import _natural_key


def _norm(s):
    """Normalize a string for matching: strip whitespace and uppercase."""
    return (s or '').strip().upper()


def compute_project_progress(project_id):
    """Return planned vs actual progress data for a project."""
    project = Project.query.get(project_id)
    if not project:
        return None

    planned = PlannedData.query.filter_by(project_id=project_id).all()
    if not planned:
        return None

    by_lot = project.track_by_lot if project.track_by_lot is not None else True

    entries = (DailyEntry.query
               .filter_by(project_id=project_id)
               .filter(DailyEntry.install_sqm > 0)
               .all())

    planned_by_task = {}
    for p in planned:
        key = (_norm(p.lot), _norm(p.material)) if by_lot else ('', _norm(p.material))
        if key not in planned_by_task:
            planned_by_task[key] = {
                'lot': (p.lot or '').strip() if by_lot else '',
                'location': p.location,
                'material': (p.material or '').strip(),
                'planned_sqm': 0, 'min_day': float('inf'), 'max_day': 0,
            }
        planned_by_task[key]['planned_sqm'] += p.planned_sqm or 0
        planned_by_task[key]['min_day'] = min(planned_by_task[key]['min_day'], p.day_number or 0)
        planned_by_task[key]['max_day'] = max(planned_by_task[key]['max_day'], p.day_number or 0)

    actual_by_task = {}
    total_install_hours = 0.0
    total_person_hours = 0.0
    for e in entries:
        if e.production_lines:
            for pl in e.production_lines:
                key = (_norm(pl.lot_number), _norm(pl.material)) if by_lot else ('', _norm(pl.material))
                actual_by_task[key] = actual_by_task.get(key, 0.0) + (pl.install_sqm or 0)
                total_install_hours += (pl.install_hours or 0)
                total_person_hours += pl.person_hours
        else:
            key = (_norm(e.lot_number), _norm(e.material)) if by_lot else ('', _norm(e.material))
            actual_by_task[key] = actual_by_task.get(key, 0.0) + (e.install_sqm or 0)
            total_install_hours += (e.install_hours or 0)
            total_person_hours += (e.install_hours or 0)

    tasks = []
    total_planned = 0.0
    total_actual = 0.0
    sorted_items = sorted(planned_by_task.items(),
                          key=lambda x: (_natural_key(x[1]['lot']), _natural_key(x[1]['material'])))
    for key, data in sorted_items:
        actual = actual_by_task.get(key, 0.0)
        planned_sqm = data['planned_sqm']
        pct = round(actual / planned_sqm * 100, 1) if planned_sqm > 0 else 0
        total_planned += planned_sqm
        total_actual += actual
        tasks.append({
            'lot': data['lot'],
            'location': data['location'],
            'material': data['material'],
            'planned_sqm': round(planned_sqm, 2),
            'actual_sqm': round(actual, 2),
            'remaining': round(max(0, planned_sqm - actual), 2),
            'pct_complete': min(pct, 100),
            'min_day': data['min_day'],
            'max_day': data['max_day'],
        })

    overall_pct = round(total_actual / total_planned * 100, 1) if total_planned > 0 else 0
    # Person-hours rate: m² per person-hour (normalised for crew size)
    install_rate = round(total_actual / total_person_hours, 2) if total_person_hours > 0 else None

    all_entries = DailyEntry.query.filter_by(project_id=project_id).order_by(DailyEntry.entry_date.desc()).first()
    current_crew = all_entries.num_people if all_entries and all_entries.num_people else None

    # Calculate "where should we be" — working days elapsed excluding delays
    from models import ProjectNonWorkDate, ProjectWorkedSunday, PublicHoliday, CFMEUDate
    from datetime import date as _date, timedelta as _td
    from collections import defaultdict

    all_entries = DailyEntry.query.filter_by(project_id=project_id).all()
    today = _date.today()
    total_planned_days = max((p.day_number or 0) for p in planned) if planned else 0

    hours_per_day = project.hours_per_day or 8

    planned_crew = project.planned_crew or 1

    should_be_pct = None
    total_delay_hours = 0.0
    total_variation_hours = 0.0
    total_variation_person_hours = 0.0
    total_own_delay_hours = 0.0
    delay_impact_days = 0.0
    total_available_hours = 0.0
    total_lost_hours = 0.0
    delay_events = []

    if project.start_date and total_planned_days > 0:
        # Build non-work date set
        non_work = {nwd.date for nwd in ProjectNonWorkDate.query.filter_by(project_id=project_id).all()}
        for h in PublicHoliday.query.all():
            if 'ALL' in h.states_list() or (project.state and project.state in h.states_list()):
                non_work.add(h.date)
        if project.is_cfmeu:
            for c in CFMEUDate.query.all():
                if 'ALL' in c.states_list() or (project.state and project.state in c.states_list()):
                    non_work.add(c.date)
        worked_sundays = {ws.date for ws in ProjectWorkedSunday.query.filter_by(project_id=project_id).all()}

        # Collect delay hours per date and build event list
        delay_hours_by_date = defaultdict(float)   # date → total delay hours
        variation_hours_by_date = defaultdict(float)
        own_delay_hours_by_date = defaultdict(float)
        delay_events = []
        for e in all_entries:
            # Track internal (own) delay hours
            if (e.own_delay_hours or 0) > 0:
                own_delay_hours_by_date[e.entry_date] += e.own_delay_hours
            if e.delay_lines:
                for dl in e.delay_lines:
                    if (dl.hours or 0) > 0 and dl.reason:
                        delay_hours_by_date[e.entry_date] += dl.hours
                        delay_events.append({
                            'date': e.entry_date.strftime('%d/%m/%Y'),
                            'day': e.entry_date.strftime('%a'),
                            'reason': dl.reason,
                            'hours': dl.hours,
                            'description': dl.description or '',
                            'type': 'delay',
                        })
            elif (e.delay_hours or 0) > 0 and e.delay_reason:
                delay_hours_by_date[e.entry_date] += e.delay_hours
                delay_events.append({
                    'date': e.entry_date.strftime('%d/%m/%Y'),
                    'day': e.entry_date.strftime('%a'),
                    'reason': e.delay_reason,
                    'hours': e.delay_hours,
                    'description': e.delay_description or '',
                    'type': 'delay',
                })
            if e.variation_lines and sum(vl.hours or 0 for vl in e.variation_lines) > 0:
                var_hrs = sum(vl.hours or 0 for vl in e.variation_lines)
                var_p_hrs = sum(vl.person_hours for vl in e.variation_lines)
                variation_hours_by_date[e.entry_date] += var_hrs
                total_variation_person_hours += var_p_hrs
                var_descs = [f"V{vl.variation_number}: {vl.description}" for vl in e.variation_lines if vl.variation_number or vl.description]
                delay_events.append({
                    'date': e.entry_date.strftime('%d/%m/%Y'),
                    'day': e.entry_date.strftime('%a'),
                    'reason': 'Client Variation',
                    'hours': var_hrs,
                    'description': '; '.join(var_descs),
                    'type': 'variation',
                })
        delay_events.sort(key=lambda x: x['date'])

        # Person-hours based "where should we be"
        # Planned deployment capacity = planned_crew × hours_per_day × working_days
        # Actual available for deployment is reduced by:
        #   - Delays: stop deployment crew from working (delay_hrs × planned_crew)
        #   - Variations: pull specific crew away from deployment (variation person-hours)
        # This means: if you pull 2 of 7 people to variations, you deploy with 5 — that's
        # fewer person-hours of deployment and the schedule slips accordingly.
        total_available_hours = 0.0
        total_lost_hours = 0.0
        d = project.start_date
        end = min(today, project.start_date + _td(days=total_planned_days * 2))  # safety cap
        while d <= end:
            is_sunday = d.weekday() == 6 and d not in worked_sundays
            is_nonwork = d in non_work
            if not is_sunday and not is_nonwork:
                total_available_hours += hours_per_day
                delay_hrs = delay_hours_by_date.get(d, 0.0)
                total_lost_hours += min(delay_hrs, hours_per_day)
            d += _td(days=1)

        # Person-hours view
        total_planned_person_hours = total_planned_days * hours_per_day * planned_crew
        available_person_hours = total_available_hours * planned_crew
        # Delays impact the full crew; variation person-hours are from entry data
        delay_person_hours = total_lost_hours * planned_crew
        # Productive deployment person-hours = available minus delays minus variation crew time
        productive_deploy_ph = available_person_hours - delay_person_hours - total_variation_person_hours
        productive_deploy_ph = max(0, productive_deploy_ph)
        should_be_pct = round(min(productive_deploy_ph / total_planned_person_hours * 100, 100), 1) if total_planned_person_hours > 0 else 0

        # Delay impact on deadline
        total_delay_hours = sum(delay_hours_by_date.values())
        total_variation_hours = sum(variation_hours_by_date.values())
        total_own_delay_hours = sum(own_delay_hours_by_date.values())
        delay_impact_days = round(total_delay_hours / hours_per_day, 1)

    return {
        'tasks': tasks,
        'total_planned': round(total_planned, 2),
        'total_actual': round(total_actual, 2),
        'total_remaining': round(max(0, total_planned - total_actual), 2),
        'overall_pct': min(overall_pct, 100),
        'should_be_pct': should_be_pct,
        'install_rate': install_rate,
        'planned_crew': project.planned_crew,
        'current_crew': current_crew,
        'total_planned_days': total_planned_days,
        'total_delay_hours': round(total_delay_hours, 1),
        'total_variation_hours': round(total_variation_hours, 1),
        'delay_impact_days': delay_impact_days,
        'total_available_hours': round(total_available_hours, 1),
        'total_lost_hours': round(total_lost_hours, 1),
        'total_own_delay_hours': round(total_own_delay_hours, 1),
        'total_install_hours': round(total_install_hours, 1),
        'non_deploy_hours': round(max(0, total_available_hours - total_install_hours - total_lost_hours - total_own_delay_hours - total_variation_hours), 1),
        'hours_per_day': hours_per_day,
        # Backward compat aliases
        'site_delay_days': round(total_delay_hours / hours_per_day, 1) if hours_per_day else 0,
        'variation_delay_days': round(total_variation_hours / hours_per_day, 1) if hours_per_day else 0,
        'weather_delay_days': round(total_delay_hours / hours_per_day, 1) if hours_per_day else 0,
        'weather_delay_impact': round(total_delay_hours / hours_per_day, 1) if hours_per_day else 0,
        'variation_delay_impact': round(total_variation_hours / hours_per_day, 1) if hours_per_day else 0,
        'delay_events': delay_events,
    }


def compute_material_productivity(project_id):
    """Return m²/person-hour productivity by material: planned rate vs actual rate.

    Planned rate = (planned_sqm / planned_days) / (hours_per_day * planned_crew) → m²/person-hr
    Actual rate  = actual_sqm / actual_person_hours                               → m²/person-hr
    """
    project = Project.query.get(project_id)
    if not project:
        return []

    hours_per_day = project.hours_per_day or 8

    planned = PlannedData.query.filter_by(project_id=project_id).all()
    if not planned:
        return []

    # Group planned by material (normalized)
    mat_planned = {}
    for p in planned:
        mat = _norm(p.material) or 'UNKNOWN'
        if mat not in mat_planned:
            mat_planned[mat] = {'sqm': 0.0, 'day_numbers': set()}
        mat_planned[mat]['sqm'] += p.planned_sqm or 0
        if p.day_number:
            mat_planned[mat]['day_numbers'].add(p.day_number)

    entries = DailyEntry.query.filter_by(project_id=project_id).all()

    # Group actuals by material — use production lines for accurate per-material hours
    mat_actual = {}
    total_variation_hours = 0.0
    total_weather_hours = 0.0
    planned_crew = project.planned_crew or 1
    for e in entries:
        # Track delay hours
        total_variation_hours += e.total_variation_hours
        total_weather_hours += (e.delay_hours or 0)

        if e.production_lines:
            for pl in e.production_lines:
                mat = _norm(pl.material) or 'UNKNOWN'
                if mat not in mat_actual:
                    mat_actual[mat] = {'sqm': 0.0, 'hours': 0.0, 'person_hours': 0.0, 'dates': set()}
                mat_actual[mat]['sqm'] += pl.install_sqm or 0
                mat_actual[mat]['hours'] += pl.install_hours or 0
                mat_actual[mat]['person_hours'] += pl.person_hours
                if e.entry_date:
                    mat_actual[mat]['dates'].add(e.entry_date)
        else:
            mat = _norm(e.material) or 'UNKNOWN'
            if mat not in mat_actual:
                mat_actual[mat] = {'sqm': 0.0, 'hours': 0.0, 'person_hours': 0.0, 'dates': set()}
            mat_actual[mat]['sqm'] += e.install_sqm or 0
            mat_actual[mat]['hours'] += e.install_hours or 0
            mat_actual[mat]['person_hours'] += e.install_hours or 0
            if e.entry_date:
                mat_actual[mat]['dates'].add(e.entry_date)

    # Overall totals — rates in m²/person-hr
    # Count total person-hours planned: for each day, the full crew works regardless
    # of how many materials are scheduled. So total planned person-hours = unique_days × hpd × crew.
    total_planned_sqm = sum(v['sqm'] for v in mat_planned.values())
    all_planned_days = len({dn for v in mat_planned.values() for dn in v['day_numbers']})
    total_planned_person_hours = all_planned_days * hours_per_day * planned_crew
    # Overall planned rate: total sqm / total person-hours
    overall_planned_rate = round(total_planned_sqm / total_planned_person_hours, 1) if total_planned_person_hours > 0 else None

    total_actual_sqm = sum(v['sqm'] for v in mat_actual.values())
    total_actual_hours = sum(v['hours'] for v in mat_actual.values())
    total_actual_person_hours = sum(v['person_hours'] for v in mat_actual.values())
    # Actual rate: sqm / person-hours
    overall_actual_rate = round(total_actual_sqm / total_actual_person_hours, 1) if total_actual_person_hours > 0 else None

    overall_pct = None
    if overall_planned_rate and overall_actual_rate:
        overall_pct = round(overall_actual_rate / overall_planned_rate * 100, 0)

    overall = {
        'planned_sqm': round(total_planned_sqm, 0),
        'actual_sqm': round(total_actual_sqm, 0),
        'planned_days': all_planned_days,
        'actual_days': len({d for v in mat_actual.values() for d in v['dates']}),
        'actual_hours': round(total_actual_hours, 1),
        'actual_person_hours': round(total_actual_person_hours, 1),
        'planned_crew': planned_crew,
        'planned_rate': overall_planned_rate,
        'actual_rate': overall_actual_rate,
        'pct_of_target': overall_pct,
        'hours_per_day': hours_per_day,
        'variation_hours': round(total_variation_hours, 1),
        'weather_hours': round(total_weather_hours, 1),
    }

    # Calculate per-material planned person-hours.
    # Each material gets a per-material rate based on its own planned SQM and its own
    # number of scheduled days. When multiple materials share the same day, the crew
    # works on both — but the planned RATE per material should reflect the expected
    # output for that material alone (sqm / (days × hpd × crew)).
    # This avoids diluting the rate when two materials happen to be on the same day.
    day_person_hours = hours_per_day * planned_crew  # person-hours available per day
    mat_planned_person_hours = {}
    for mat, info in mat_planned.items():
        mat_planned_person_hours[mat] = len(info['day_numbers']) * day_person_hours

    materials = []
    for mat in sorted(mat_planned.keys(), key=_natural_key):
        plan = mat_planned[mat]
        planned_sqm = plan['sqm']
        # Planned rate uses proportional person-hours (shared across materials on the same day)
        mat_p_hrs = mat_planned_person_hours.get(mat, 0.0)
        planned_rate = round(planned_sqm / mat_p_hrs, 1) if mat_p_hrs > 0 else None

        act = mat_actual.get(mat, {'sqm': 0.0, 'hours': 0.0, 'person_hours': 0.0, 'dates': set()})
        actual_sqm = act['sqm']
        actual_person_hours = act['person_hours']
        # Actual rate: sqm / person-hours = m²/person-hr
        actual_rate = round(actual_sqm / actual_person_hours, 1) if actual_person_hours > 0 else None

        pct_of_target = None
        if planned_rate and actual_rate:
            pct_of_target = round(actual_rate / planned_rate * 100, 0)

        materials.append({
            'material': mat,
            'planned_sqm': round(planned_sqm, 0),
            'actual_sqm': round(actual_sqm, 0),
            'planned_days': len(plan['day_numbers']),
            'actual_days': len(act['dates']),
            'actual_hours': round(act['hours'], 1),
            'actual_person_hours': round(actual_person_hours, 1),
            'planned_rate': planned_rate,
            'actual_rate': actual_rate,
            'pct_of_target': pct_of_target,
        })

    return {'overall': overall, 'materials': materials}


def compute_delay_summary(project_id):
    """Return a delay summary grouped by (reason, billable) for the project dashboard."""
    entries = (DailyEntry.query
               .filter_by(project_id=project_id)
               .filter(DailyEntry.delay_hours > 0)
               .all())
    if not entries:
        return []

    categories = {}
    for e in entries:
        reason = e.delay_reason or 'Unspecified'
        is_billable = e.delay_billable if e.delay_billable is not None else True
        key = (reason, is_billable)
        if key not in categories:
            categories[key] = {'reason': reason, 'billable': is_billable, 'hours': 0.0, 'events': 0}
        categories[key]['hours'] += e.delay_hours or 0
        categories[key]['events'] += 1

    result = sorted(categories.values(), key=lambda x: (-x['hours'], x['reason']))
    for cat in result:
        cat['hours'] = round(cat['hours'], 1)
    return result


def _best_role_for_employee(emp):
    """Return (label, rate) using the employee's highest-paying assigned role.
    Falls back to emp.delay_rate / emp.role if no role-based rate is set.
    Returns (None, None) if no chargeable rate exists.
    """
    best_label = None
    best_rate = None
    for r in (emp.roles or []):
        if r.delay_rate and (best_rate is None or r.delay_rate > best_rate):
            best_rate = r.delay_rate
            best_label = r.name
    if best_rate is None and emp.delay_rate:
        best_rate = emp.delay_rate
        best_label = emp.role or emp.name
    return best_label, best_rate


def _build_variation_billing(entry):
    """Build billing lines from per-variation employee/machine selections."""
    from models import Employee, Machine

    var_lines = []
    all_emp_ids = set()
    all_mach_ids = set()

    for vl in (entry.variation_lines or []):
        if not vl.hours or vl.hours <= 0:
            continue
        var_lines.append({
            'variation_number': vl.variation_number or '—',
            'description': vl.description or '',
            'hours': vl.hours,
        })
        for eid in vl.billed_employee_ids:
            all_emp_ids.add(eid)
        for mid in vl.billed_machine_ids:
            all_mach_ids.add(mid)

    total_var_hours = sum(v['hours'] for v in var_lines)

    # If no specific billing selections, fall back to entry's full crew
    if not all_emp_ids and not all_mach_ids:
        all_emp_ids = {e.id for e in entry.employees}
        all_mach_ids = {m.id for m in entry.machines}

    # Build employee cost lines — pick highest-rate role per emp, group by (role, rate)
    emp_lines = []
    if all_emp_ids:
        role_counts = {}
        for emp in Employee.query.filter(Employee.id.in_(all_emp_ids)).all():
            label, rate = _best_role_for_employee(emp)
            if rate is None:
                continue
            key = (label, rate)
            role_counts[key] = role_counts.get(key, 0) + 1
        for (label, rate), count in sorted(role_counts.items(), key=lambda x: (-x[0][1], x[0][0])):
            cost = round(total_var_hours * rate * count, 2)
            people_str = f"{count} {'person' if count == 1 else 'people'}"
            emp_lines.append({
                'name': f"{label} ({people_str})",
                'rate': rate, 'count': count,
                'hours': total_var_hours, 'cost': cost,
            })

    # Build machine cost lines — MachineGroups charge a single fleet rate
    # regardless of how many machines from the group are present. Ungrouped
    # individual machines with matching type+rate are merged into a qty line.
    machine_lines = []
    if all_mach_ids:
        seen_groups = {}     # group_id -> {'name', 'rate'}
        indiv_counts = {}    # (label, rate) -> qty
        for m in Machine.query.filter(Machine.id.in_(all_mach_ids)).all():
            if m.group and m.group.delay_rate:
                if m.group.id not in seen_groups:
                    seen_groups[m.group.id] = {'name': m.group.name, 'rate': m.group.delay_rate}
            elif m.delay_rate:
                label = m.machine_type or m.name
                key = (label, m.delay_rate)
                indiv_counts[key] = indiv_counts.get(key, 0) + 1
        for info in sorted(seen_groups.values(), key=lambda i: (-i['rate'], i['name'])):
            cost = round(total_var_hours * info['rate'], 2)
            machine_lines.append({
                'name': info['name'],
                'rate': info['rate'],
                'hours': total_var_hours, 'cost': cost,
                'is_group': True,
            })
        for (label, rate), qty in sorted(indiv_counts.items(), key=lambda x: (-x[1] * x[0][1], x[0][0])):
            qty_label = f" x{qty}" if qty > 1 else ""
            line_rate = rate * qty
            cost = round(total_var_hours * line_rate, 2)
            machine_lines.append({
                'name': f"{label}{qty_label}",
                'rate': line_rate,
                'hours': total_var_hours, 'cost': cost,
                'is_group': False,
            })

    return var_lines, emp_lines, machine_lines


def build_delay_report(project_id, date_from, date_to, billable_filter='all'):
    """Return per-entry delay breakdown grouped by role, with billable split.
    Includes weather delays, equipment costs (grouped by MachineGroup), and
    client variations as separate billable line items."""

    # Weather/standard delays
    delay_query = (DailyEntry.query
                   .filter(DailyEntry.delay_hours > 0)
                   .filter(DailyEntry.entry_date >= date_from)
                   .filter(DailyEntry.entry_date <= date_to)
                   .order_by(DailyEntry.entry_date))
    if project_id:
        delay_query = delay_query.filter_by(project_id=int(project_id))
    if billable_filter == 'billable':
        delay_query = delay_query.filter(DailyEntry.delay_billable == True)
    elif billable_filter == 'non_billable':
        delay_query = delay_query.filter(DailyEntry.delay_billable == False)

    # Also find entries with variations (always billable)
    var_query = (DailyEntry.query
                 .filter(DailyEntry.entry_date >= date_from)
                 .filter(DailyEntry.entry_date <= date_to)
                 .order_by(DailyEntry.entry_date))
    if project_id:
        var_query = var_query.filter_by(project_id=int(project_id))

    rows = []
    total_cost = 0.0
    total_hours_billable = 0.0
    total_hours_non_billable = 0.0
    total_variation_cost = 0.0
    total_variation_hours = 0.0
    seen_entry_ids = set()

    # Process delay entries
    for entry in delay_query.all():
        seen_entry_ids.add(entry.id)

        role_counts = {}
        for emp in entry.employees:
            label, rate = _best_role_for_employee(emp)
            if rate is None:
                continue
            key = (label, rate)
            role_counts[key] = role_counts.get(key, 0) + 1

        emp_lines = []
        # Sort by rate desc, then label — highest charge appears first
        for (label, rate), count in sorted(role_counts.items(), key=lambda x: (-x[0][1], x[0][0])):
            cost = round(entry.delay_hours * rate * count, 2)
            people_str = f"{count} {'person' if count == 1 else 'people'}"
            emp_lines.append({
                'name': f"{label} ({people_str})",
                'rate': rate, 'count': count,
                'hours': entry.delay_hours, 'cost': cost,
            })

        # Equipment costs — from site rate card items, grouped by (item, rate)
        equip_groups = {}
        for cl in (entry.site_cost_lines or []):
            key = (cl.item_name, cl.rate)
            equip_groups[key] = equip_groups.get(key, 0) + (cl.quantity or 1)
        machine_lines = []
        for (item_name, rate), qty in sorted(equip_groups.items(), key=lambda x: (-x[1] * x[0][1], x[0][0])):
            qty_int = int(qty) if qty == int(qty) else qty
            qty_label = f" x{qty_int}" if qty > 1 else ""
            line_rate = rate * qty
            cost = round(entry.delay_hours * line_rate, 2)
            machine_lines.append({
                'name': f"{item_name}{qty_label}",
                'rate': line_rate,
                'hours': entry.delay_hours, 'cost': cost,
                'is_group': False,
            })

        # Variation lines for this entry (if any) — with their own billing
        if entry.variation_lines:
            var_lines_data, var_emp_lines, var_machine_lines = _build_variation_billing(entry)
            var_lines = var_lines_data
            # Add variation-specific costs to the entry total
            var_cost = sum(r['cost'] for r in var_emp_lines) + sum(r['cost'] for r in var_machine_lines)
        else:
            var_lines = []
            var_emp_lines = []
            var_machine_lines = []
            var_cost = 0

        # Accommodation costs (if ticked and project has a rate)
        accom_lines = []
        if getattr(entry, 'include_accommodation', False) and entry.project and entry.project.accommodation_cost_per_person:
            headcount = len(entry.employees) if entry.employees else 0
            if headcount > 0:
                accom_rate = entry.project.accommodation_cost_per_person
                accom_cost = round(accom_rate * headcount, 2)
                accom_lines.append({
                    'name': f"Accommodation ({headcount} {'person' if headcount == 1 else 'people'} × ${accom_rate:.2f})",
                    'rate': accom_rate, 'count': headcount,
                    'hours': 1, 'cost': accom_cost,
                })

        # Day rate override — replaces all other delay costs.
        # Hourly rate = day_rate / day_rate_hours (defaults to 8 hrs/day).
        # Bill the delay hours capped at the full-day length so the breakdown
        # always reads as: hours × hourly rate = cost.
        is_billable = entry.delay_billable if entry.delay_billable is not None else True
        if getattr(entry, 'charge_day_rate', False) and entry.project and entry.project.day_rate:
            day_rate_val = entry.project.day_rate
            full_day_hours = entry.project.day_rate_hours or 8
            hourly_rate = day_rate_val / full_day_hours if full_day_hours else 0
            delay_hrs = entry.delay_hours or 0
            billed_hrs = min(delay_hrs, full_day_hours)
            charge = hourly_rate * billed_hrs
            if delay_hrs >= full_day_hours:
                label = f"Day Rate (${day_rate_val:,.2f}/day / {full_day_hours:g} hrs)"
            else:
                label = f"Day Rate pro-rata (${day_rate_val:,.2f}/day / {full_day_hours:g} hrs)"
            emp_lines = []
            machine_lines = []
            accom_lines = [{
                'name': label,
                'rate': round(hourly_rate, 2),
                'hours': billed_hrs, 'cost': round(charge, 2),
            }]

        delay_cost = (sum(r['cost'] for r in emp_lines)
                      + sum(r['cost'] for r in machine_lines)
                      + sum(r['cost'] for r in accom_lines))
        entry_cost = delay_cost + var_cost

        if is_billable:
            total_cost += entry_cost
            total_hours_billable += entry.delay_hours
        else:
            total_hours_non_billable += entry.delay_hours
        # Variations are always billable
        total_variation_cost += var_cost
        total_variation_hours += sum(v['hours'] for v in var_lines)

        rows.append({
            'entry': entry,
            'emp_lines': emp_lines,
            'machine_lines': machine_lines,
            'accom_lines': accom_lines,
            'var_lines': var_lines,
            'var_emp_lines': var_emp_lines,
            'var_machine_lines': var_machine_lines,
            'entry_cost': entry_cost,
            'billable': is_billable,
            'type': 'delay',
        })

    # Process entries with variations that don't have weather delays
    if billable_filter != 'non_billable':
        for entry in var_query.all():
            if entry.id in seen_entry_ids:
                continue  # already included above
            if not entry.variation_lines:
                continue
            var_hours = sum(vl.hours or 0 for vl in entry.variation_lines)
            if var_hours <= 0:
                continue

            var_lines, emp_lines, machine_lines = _build_variation_billing(entry)

            entry_cost = sum(r['cost'] for r in emp_lines) + sum(r['cost'] for r in machine_lines)
            total_variation_cost += entry_cost
            total_variation_hours += var_hours

            rows.append({
                'entry': entry,
                'emp_lines': emp_lines,
                'machine_lines': machine_lines,
                'var_lines': var_lines,
                'entry_cost': entry_cost,
                'billable': True,
                'type': 'variation',
            })

    # Sort all rows by date
    rows.sort(key=lambda r: r['entry'].entry_date)

    billable_count = sum(1 for r in rows if r['billable'])
    summary = {
        'total_cost': round(total_cost + total_variation_cost, 2),
        'total_hours': total_hours_billable + total_hours_non_billable,
        'total_hours_billable': total_hours_billable,
        'total_hours_non_billable': total_hours_non_billable,
        'total_variation_hours': total_variation_hours,
        'total_variation_cost': round(total_variation_cost, 2),
        'entry_count': len(rows),
        'billable_count': billable_count,
        'non_billable_count': len(rows) - billable_count,
    }
    return rows, summary
