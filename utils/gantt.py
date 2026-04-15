import math
from datetime import date, timedelta

from models import PlannedData, DailyEntry, ProjectWorkedSunday, Project, PublicHoliday, CFMEUDate
from utils.helpers import _natural_key


def compute_gantt_data(project_id, mode='internal'):
    """Build day-by-day Gantt data matching the matplotlib approach.

    mode='internal': forecast uses actual productivity rates (m²/person-hr)
    mode='client':   forecast uses planned rates from PlannedData (planned sqm/day)

    Each planned/actual/forecast entry produces individual 1-day-wide bars
    (not spans), shading is applied per-day for Sundays and non-work dates,
    and per-task variance labels are computed.
    """
    project = Project.query.get(project_id)
    if not project or not project.start_date:
        return None

    planned = PlannedData.query.filter_by(project_id=project_id).order_by(PlannedData.day_number).all()
    if not planned:
        return None

    entries = (DailyEntry.query
               .filter_by(project_id=project_id)
               .filter(DailyEntry.install_sqm > 0)
               .order_by(DailyEntry.entry_date)
               .all())

    # Non-work dates: manual + public holidays + CFMEU dates
    non_work_set = {nwd.date for nwd in project.non_work_dates}
    all_public = PublicHoliday.query.all()
    if project.state:
        non_work_set |= {h.date for h in all_public
                         if 'ALL' in h.states_list() or project.state in h.states_list()}
        if project.is_cfmeu:
            non_work_set |= {c.date for c in CFMEUDate.query.all()
                             if 'ALL' in c.states_list() or project.state in c.states_list()}
    else:
        non_work_set |= {h.date for h in all_public if 'ALL' in h.states_list()}
    worked_sundays_set = {ws.date for ws in ProjectWorkedSunday.query.filter_by(project_id=project_id).all()}

    # Map day number → calendar date (skip Sundays unless worked, and non-work dates)
    max_day = max((p.day_number or 0) for p in planned)
    day_to_date = {}
    current = project.start_date
    for d in range(1, max_day + 1):
        while (current.weekday() == 6 and current not in worked_sundays_set) or current in non_work_set:
            current += timedelta(days=1)
        day_to_date[d] = current
        current += timedelta(days=1)

    # Task info: planned_dates is a set of calendar dates (one per planned row)
    # When track_by_lot is off, group by material only
    by_lot = project.track_by_lot if project.track_by_lot is not None else True
    def _norm(s):
        return (s or '').strip().upper()

    task_info = {}
    task_order_keys = []
    for p in planned:
        if by_lot:
            key = (_norm(p.lot), _norm(p.material))
            label = (f"{(p.lot or '').strip()} — {(p.material or '').strip()}" if p.lot and p.material
                     else ((p.lot or p.material or 'Unknown').strip()))
        else:
            key = ('', _norm(p.material))
            label = (p.material or 'Unknown').strip()
        if key not in task_info:
            task_info[key] = {
                'label': label,
                'planned_dates': set(),
                'planned_sqm': 0,
            }
            task_order_keys.append(key)
        d_date = day_to_date.get(p.day_number)
        if d_date:
            task_info[key]['planned_dates'].add(d_date)
        task_info[key]['planned_sqm'] += p.planned_sqm or 0

    task_order_keys.sort(key=lambda k: (_natural_key(k[0]), _natural_key(k[1])))

    # Actuals by (lot_number, material) — use production lines if available
    # Normalize keys to avoid case/whitespace mismatches with planned data
    def _norm(s):
        return (s or '').strip().upper()

    actuals_by_task = {}
    for e in entries:
        if e.production_lines:
            for pl in e.production_lines:
                key = (_norm(pl.lot_number) if by_lot else '', _norm(pl.material))
                if key not in actuals_by_task:
                    actuals_by_task[key] = {'sqm': 0.0, 'hrs': 0.0, 'p_hrs': 0.0, 'dates': set()}
                actuals_by_task[key]['sqm'] += pl.install_sqm or 0
                actuals_by_task[key]['hrs'] += pl.install_hours or 0
                actuals_by_task[key]['p_hrs'] += pl.person_hours
                actuals_by_task[key]['dates'].add(e.entry_date)
        else:
            key = (_norm(e.lot_number) if by_lot else '', _norm(e.material))
            if key not in actuals_by_task:
                actuals_by_task[key] = {'sqm': 0.0, 'hrs': 0.0, 'p_hrs': 0.0, 'dates': set()}
            actuals_by_task[key]['sqm'] += e.install_sqm or 0
            actuals_by_task[key]['hrs'] += e.install_hours or 0
            actuals_by_task[key]['p_hrs'] += e.install_hours or 0  # legacy fallback
            actuals_by_task[key]['dates'].add(e.entry_date)

    # Install rates per task (m²/person-hr) + global fallback
    task_rates = {}
    for key, data in actuals_by_task.items():
        if data['p_hrs'] > 0 and data['sqm'] > 0:
            task_rates[key] = data['sqm'] / data['p_hrs']
    total_sqm = sum(d['sqm'] for d in actuals_by_task.values())
    total_p_hrs = sum(d['p_hrs'] for d in actuals_by_task.values())
    global_rate = (total_sqm / total_p_hrs) if total_p_hrs > 0 else 87.5  # m²/person-hr

    # Current crew for forecast
    latest_entry = (DailyEntry.query.filter_by(project_id=project_id)
                    .order_by(DailyEntry.entry_date.desc()).first())
    hours_per_day = project.hours_per_day or 8
    curr_crew = (latest_entry.num_people if latest_entry and latest_entry.num_people
                 else project.planned_crew or 10)
    # Daily capacity in m² = rate(m²/p-hr) × crew × hours_per_day
    daily_cap_hrs = curr_crew * hours_per_day

    today = date.today()
    target_finish = max(day_to_date.values()) if day_to_date else None

    # Standdown dates — split by cause for Gantt shading, combined for forecast skip
    # Weather-type reasons (shown with weather shading)
    WEATHER_REASONS = {'wet weather', 'wind', 'extreme heat'}
    _all_entries = DailyEntry.query.filter_by(project_id=project_id).all()

    # Weather delay dates — check delay_lines first, fall back to legacy
    weather_delay_dates = set()
    client_delay_dates = set()
    for e in _all_entries:
        if e.delay_lines:
            for dl in e.delay_lines:
                if (dl.hours or 0) > 0 and dl.reason:
                    if dl.reason.lower() in WEATHER_REASONS:
                        weather_delay_dates.add(e.entry_date)
                    else:
                        client_delay_dates.add(e.entry_date)
        elif (e.delay_hours or 0) > 0 and e.delay_reason:
            if e.delay_reason.lower() in WEATHER_REASONS:
                weather_delay_dates.add(e.entry_date)
            else:
                client_delay_dates.add(e.entry_date)
    # Variation dates (entries with variation lines)
    variation_dates = {
        e.entry_date for e in _all_entries
        if e.variation_lines and sum(vl.hours or 0 for vl in e.variation_lines) > 0
    }
    client_delay_dates = client_delay_dates | variation_dates
    # Combined delay dates for forecast skip (all site delays, NOT own delays)
    delay_entry_dates = weather_delay_dates | client_delay_dates

    def next_work_day(d):
        # Advance d past Sundays (unless worked), non-work dates, and standdown dates
        while (d.weekday() == 6 and d not in worked_sundays_set) or d in non_work_set or d in delay_entry_dates:
            d += timedelta(days=1)
        return d

    # Sort tasks: by lot (natural), then by planned start date within each lot
    task_order_keys.sort(key=lambda k: (
        _natural_key(k[0]),
        min(task_info[k]['planned_dates']) if task_info[k]['planned_dates'] else date.max,
    ))

    # Compute forecast — all tasks are globally sequential
    forecast_by_task = {}
    est_finish_by_task = {}

    # Initialize global_last_date to the latest actual work done on ANY task.
    max_global_actual = None
    for act_data in actuals_by_task.values():
        if act_data['dates']:
            t_max = max(act_data['dates'])
            if max_global_actual is None or t_max > max_global_actual:
                max_global_actual = t_max
    global_last_date = max_global_actual

    for key in task_order_keys:
        info = task_info[key]
        act = actuals_by_task.get(key)
        planned_sqm = info['planned_sqm']
        actual_sqm = act['sqm'] if act else 0.0
        remaining = planned_sqm - actual_sqm

        t_last_act = max(act['dates']) if act and act['dates'] else None

        # Base forecast start
        if t_last_act:
            candidate = max(t_last_act + timedelta(days=1), today)
        else:
            planned_start = min(info['planned_dates']) if info['planned_dates'] else today
            candidate = max(planned_start, today)

        # Don't start before the previous task has finished
        if global_last_date is not None:
            candidate = max(candidate, global_last_date + timedelta(days=1))

        start_f = next_work_day(candidate)

        if remaining > planned_sqm * 0.005 and daily_cap_hrs > 0:
            if mode == 'client':
                # Client mode: use planned rate (planned sqm / planned days)
                planned_day_count = len(info['planned_dates']) if info['planned_dates'] else 1
                planned_daily_sqm = planned_sqm / planned_day_count if planned_day_count > 0 else planned_sqm
                days_req = max(1, math.ceil(remaining / planned_daily_sqm - 0.001))
            else:
                # Internal mode: use actual productivity rate
                actual_p_hrs = act['p_hrs'] if act else 0.0
                actual_sqm_val = act['sqm'] if act else 0.0
                if actual_p_hrs > 0 and actual_sqm_val > 0:
                    sqm_per_person_hr = actual_sqm_val / actual_p_hrs
                    effective_daily_sqm = sqm_per_person_hr * curr_crew * hours_per_day
                    days_req = max(1, math.ceil(remaining / effective_daily_sqm - 0.001))
                else:
                    days_req = max(1, len(info['planned_dates']))
            forecast_dates = []
            temp = start_f
            for _ in range(days_req):
                temp = next_work_day(temp)
                forecast_dates.append(temp)
                temp += timedelta(days=1)
            forecast_by_task[key] = forecast_dates
            est_finish = forecast_dates[-1] if forecast_dates else start_f
            est_finish_by_task[key] = est_finish
            global_last_date = est_finish
        else:
            forecast_by_task[key] = []
            planned_finish = max(info['planned_dates']) if info['planned_dates'] else None
            est_end = t_last_act if t_last_act else planned_finish
            est_finish_by_task[key] = est_end
            if est_end:
                if global_last_date is None or est_end > global_last_date:
                    global_last_date = est_end

    est_finish_overall = max((v for v in est_finish_by_task.values() if v), default=target_finish)

    # Gantt date range
    gantt_start = project.start_date
    candidates = [d for d in [target_finish, est_finish_overall, today] if d]
    gantt_end = max(candidates) + timedelta(days=7) if candidates else gantt_start + timedelta(days=30)
    total_span = max((gantt_end - gantt_start).days, 1)
    day_width_pct = round(100.0 / total_span, 4)

    def pct(d):
        if d is None:
            return None
        return round((d - gantt_start).days / total_span * 100, 3)

    # Shade stripes: Sunday=pink (unless worked Sunday), non-work=blue, standdown=orange
    shade_stripes = []
    d = gantt_start
    while d <= gantt_end:
        if d.weekday() == 6 and d not in worked_sundays_set:
            shade_stripes.append({'left': pct(d), 'w': day_width_pct, 'type': 'sun'})
        elif d in non_work_set:
            shade_stripes.append({'left': pct(d), 'w': day_width_pct, 'type': 'nwd'})
        if d in weather_delay_dates:
            shade_stripes.append({'left': pct(d), 'w': day_width_pct, 'type': 'wwd'})
        if d in client_delay_dates:
            shade_stripes.append({'left': pct(d), 'w': day_width_pct, 'type': 'cld'})
        d += timedelta(days=1)

    # Week markers (Mondays)
    week_markers = []
    wk = gantt_start - timedelta(days=gantt_start.weekday())
    while wk <= gantt_end:
        p = pct(wk)
        if p is not None and -1 <= p <= 101:
            week_markers.append({'date': wk.strftime('%d/%m'), 'left_pct': p})
        wk += timedelta(days=7)

    # Month markers
    month_markers = []
    mo = gantt_start.replace(day=1)
    while mo <= gantt_end:
        p = pct(mo)
        if p is not None and 0 <= p <= 100:
            month_markers.append({'label': mo.strftime('%b %Y'), 'left_pct': p})
        mo = mo.replace(month=mo.month + 1) if mo.month < 12 else mo.replace(year=mo.year + 1, month=1)

    # Build rows: individual day pct positions
    rows = []
    for key in task_order_keys:
        info = task_info[key]
        act = actuals_by_task.get(key)
        planned_finish = max(info['planned_dates']) if info['planned_dates'] else None
        est_finish = est_finish_by_task.get(key)
        variance = (est_finish - planned_finish).days if planned_finish and est_finish else None

        rows.append({
            'label': info['label'],
            'planned_days': sorted([pct(d) for d in info['planned_dates']]),
            'actual_days': sorted([pct(d) for d in (act['dates'] if act else set())]),
            'forecast_days': [pct(d) for d in forecast_by_task.get(key, [])],
            'variance_days': variance,
        })

    variance_overall = (est_finish_overall - target_finish).days if target_finish and est_finish_overall else None

    return {
        'rows': rows,
        'shade_stripes': shade_stripes,
        'day_width_pct': day_width_pct,
        'today_pct': pct(today),
        'target_finish_pct': pct(target_finish),
        'target_finish': target_finish.strftime('%d/%m/%Y') if target_finish else None,
        'est_finish': est_finish_overall.strftime('%d/%m/%Y') if est_finish_overall else None,
        'est_finish_date': est_finish_overall,  # raw date for travel planner
        'variance_days': variance_overall,
        'week_markers': week_markers,
        'month_markers': month_markers,
    }
