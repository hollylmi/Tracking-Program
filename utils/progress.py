from models import DailyEntry, EntryProductionLine, PlannedData, Project
from utils.helpers import _natural_key


def compute_project_progress(project_id):
    """Return planned vs actual progress data for a project."""
    planned = PlannedData.query.filter_by(project_id=project_id).all()
    if not planned:
        return None

    entries = (DailyEntry.query
               .filter_by(project_id=project_id)
               .filter(DailyEntry.install_sqm > 0)
               .all())

    planned_by_task = {}
    for p in planned:
        key = (p.lot or '', p.material or '')
        if key not in planned_by_task:
            planned_by_task[key] = {
                'lot': p.lot, 'location': p.location, 'material': p.material,
                'planned_sqm': 0, 'min_day': float('inf'), 'max_day': 0,
            }
        planned_by_task[key]['planned_sqm'] += p.planned_sqm or 0
        planned_by_task[key]['min_day'] = min(planned_by_task[key]['min_day'], p.day_number or 0)
        planned_by_task[key]['max_day'] = max(planned_by_task[key]['max_day'], p.day_number or 0)

    actual_by_task = {}
    total_install_hours = 0.0
    for e in entries:
        # Use production lines if available, else fall back to legacy fields
        if e.production_lines:
            for pl in e.production_lines:
                key = (pl.lot_number or '', pl.material or '')
                actual_by_task[key] = actual_by_task.get(key, 0.0) + (pl.install_sqm or 0)
                total_install_hours += (pl.install_hours or 0)
        else:
            key = (e.lot_number or '', e.material or '')
            actual_by_task[key] = actual_by_task.get(key, 0.0) + (e.install_sqm or 0)
            total_install_hours += (e.install_hours or 0)

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
    install_rate = round(total_actual / total_install_hours, 2) if total_install_hours > 0 else None

    all_entries = DailyEntry.query.filter_by(project_id=project_id).order_by(DailyEntry.entry_date.desc()).first()
    current_crew = all_entries.num_people if all_entries and all_entries.num_people else None

    project = Project.query.get(project_id)
    return {
        'tasks': tasks,
        'total_planned': round(total_planned, 2),
        'total_actual': round(total_actual, 2),
        'total_remaining': round(max(0, total_planned - total_actual), 2),
        'overall_pct': min(overall_pct, 100),
        'install_rate': install_rate,
        'planned_crew': project.planned_crew,
        'current_crew': current_crew,
    }


def compute_material_productivity(project_id):
    """Return m²/hour productivity by material: planned rate vs actual rate.

    Planned rate = (planned_sqm / planned_days) / hours_per_day  → m²/hr
    Actual rate  = actual_sqm / actual_install_hours              → m²/hr
    """
    project = Project.query.get(project_id)
    if not project:
        return []

    hours_per_day = project.hours_per_day or 8

    planned = PlannedData.query.filter_by(project_id=project_id).all()
    if not planned:
        return []

    # Group planned by material
    mat_planned = {}
    for p in planned:
        mat = p.material or 'Unknown'
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
    for e in entries:
        # Track delay hours
        total_variation_hours += e.total_variation_hours
        total_weather_hours += (e.delay_hours or 0)

        if e.production_lines:
            for pl in e.production_lines:
                mat = pl.material or 'Unknown'
                if mat not in mat_actual:
                    mat_actual[mat] = {'sqm': 0.0, 'hours': 0.0, 'dates': set()}
                mat_actual[mat]['sqm'] += pl.install_sqm or 0
                mat_actual[mat]['hours'] += pl.install_hours or 0
                if e.entry_date:
                    mat_actual[mat]['dates'].add(e.entry_date)
        else:
            mat = e.material or 'Unknown'
            if mat not in mat_actual:
                mat_actual[mat] = {'sqm': 0.0, 'hours': 0.0, 'dates': set()}
            mat_actual[mat]['sqm'] += e.install_sqm or 0
            mat_actual[mat]['hours'] += e.install_hours or 0
            if e.entry_date:
                mat_actual[mat]['dates'].add(e.entry_date)

    # Overall totals
    total_planned_sqm = sum(v['sqm'] for v in mat_planned.values())
    all_planned_days = len({dn for v in mat_planned.values() for dn in v['day_numbers']})
    overall_planned_rate = round(total_planned_sqm / (all_planned_days * hours_per_day), 1) if all_planned_days > 0 else None

    total_actual_sqm = sum(v['sqm'] for v in mat_actual.values())
    total_actual_hours = sum(v['hours'] for v in mat_actual.values())
    overall_actual_rate = round(total_actual_sqm / total_actual_hours, 1) if total_actual_hours > 0 else None

    overall_pct = None
    if overall_planned_rate and overall_actual_rate:
        overall_pct = round(overall_actual_rate / overall_planned_rate * 100, 0)

    overall = {
        'planned_sqm': round(total_planned_sqm, 0),
        'actual_sqm': round(total_actual_sqm, 0),
        'planned_days': all_planned_days,
        'actual_days': len({d for v in mat_actual.values() for d in v['dates']}),
        'actual_hours': round(total_actual_hours, 1),
        'planned_rate': overall_planned_rate,
        'actual_rate': overall_actual_rate,
        'pct_of_target': overall_pct,
        'hours_per_day': hours_per_day,
        'variation_hours': round(total_variation_hours, 1),
        'weather_hours': round(total_weather_hours, 1),
    }

    materials = []
    for mat in sorted(mat_planned.keys(), key=_natural_key):
        plan = mat_planned[mat]
        planned_sqm = plan['sqm']
        planned_days = len(plan['day_numbers'])
        # Planned rate: sqm per day ÷ hours per day = m²/hr
        planned_rate = round((planned_sqm / planned_days) / hours_per_day, 1) if planned_days > 0 else None

        act = mat_actual.get(mat, {'sqm': 0.0, 'hours': 0.0, 'dates': set()})
        actual_sqm = act['sqm']
        actual_hours = act['hours']
        # Actual rate: sqm ÷ hours = m²/hr
        actual_rate = round(actual_sqm / actual_hours, 1) if actual_hours > 0 else None

        pct_of_target = None
        if planned_rate and actual_rate:
            pct_of_target = round(actual_rate / planned_rate * 100, 0)

        materials.append({
            'material': mat,
            'planned_sqm': round(planned_sqm, 0),
            'actual_sqm': round(actual_sqm, 0),
            'planned_days': planned_days,
            'actual_days': len(act['dates']),
            'actual_hours': round(actual_hours, 1),
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
            if emp.delay_rate:
                label = emp.role if emp.role else emp.name
                rate = emp.delay_rate
                key = (label, rate)
                role_counts[key] = role_counts.get(key, 0) + 1

        emp_lines = []
        for (label, rate), count in sorted(role_counts.items()):
            cost = round(entry.delay_hours * rate * count, 2)
            people_str = f"{count} {'person' if count == 1 else 'people'}"
            emp_lines.append({
                'name': f"{label} ({people_str})",
                'rate': rate, 'count': count,
                'hours': entry.delay_hours, 'cost': cost,
            })

        # Equipment costs — group machines by MachineGroup
        machine_lines = []
        seen_groups = {}
        for m in entry.machines:
            if m.group and m.group.delay_rate:
                # Charge the group rate once per group, not per machine
                if m.group.id not in seen_groups:
                    cost = round(entry.delay_hours * m.group.delay_rate, 2)
                    machine_lines.append({
                        'name': m.group.name,
                        'rate': m.group.delay_rate,
                        'hours': entry.delay_hours, 'cost': cost,
                        'is_group': True,
                    })
                    seen_groups[m.group.id] = True
            elif m.delay_rate:
                # Individual machine (not in a group or group has no rate)
                cost = round(entry.delay_hours * m.delay_rate, 2)
                machine_lines.append({
                    'name': f"{m.name}{' (' + m.plant_id + ')' if m.plant_id else ''}",
                    'rate': m.delay_rate,
                    'hours': entry.delay_hours, 'cost': cost,
                    'is_group': False,
                })

        # Variation lines for this entry (if any)
        var_lines = []
        for vl in (entry.variation_lines or []):
            if vl.hours and vl.hours > 0:
                var_lines.append({
                    'variation_number': vl.variation_number or '—',
                    'description': vl.description or '',
                    'hours': vl.hours,
                })

        is_billable = entry.delay_billable if entry.delay_billable is not None else True
        entry_cost = sum(r['cost'] for r in emp_lines) + sum(r['cost'] for r in machine_lines)

        if is_billable:
            total_cost += entry_cost
            total_hours_billable += entry.delay_hours
        else:
            total_hours_non_billable += entry.delay_hours

        rows.append({
            'entry': entry,
            'emp_lines': emp_lines,
            'machine_lines': machine_lines,
            'var_lines': var_lines,
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

            var_lines = [{
                'variation_number': vl.variation_number or '—',
                'description': vl.description or '',
                'hours': vl.hours,
            } for vl in entry.variation_lines if (vl.hours or 0) > 0]

            # Variation entries — equipment costs based on machines on the entry
            machine_lines = []
            seen_groups = {}
            for m in entry.machines:
                if m.group and m.group.delay_rate:
                    if m.group.id not in seen_groups:
                        cost = round(var_hours * m.group.delay_rate, 2)
                        machine_lines.append({
                            'name': m.group.name,
                            'rate': m.group.delay_rate,
                            'hours': var_hours, 'cost': cost,
                            'is_group': True,
                        })
                        seen_groups[m.group.id] = True
                elif m.delay_rate:
                    cost = round(var_hours * m.delay_rate, 2)
                    machine_lines.append({
                        'name': f"{m.name}{' (' + m.plant_id + ')' if m.plant_id else ''}",
                        'rate': m.delay_rate,
                        'hours': var_hours, 'cost': cost,
                        'is_group': False,
                    })

            entry_cost = sum(r['cost'] for r in machine_lines)
            total_variation_cost += entry_cost
            total_variation_hours += var_hours

            rows.append({
                'entry': entry,
                'emp_lines': [],
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
