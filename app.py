from flask import (Flask, render_template, request, redirect, url_for,
                   flash, send_from_directory, send_file, Response, jsonify)
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from models import (db, User, Project, Employee, Machine, DailyEntry, HiredMachine,
                    StandDown, Role, EntryPhoto, PlannedData, ProjectNonWorkDate,
                    ProjectBudgetedRole, ProjectMachine, ProjectWorkedSunday,
                    ProjectDocument, SwingPattern, EmployeeSwing, EmployeeLeave,
                    ProjectAssignment, ProjectEquipmentRequirement, ProjectEquipmentAssignment,
                    MachineBreakdown, BreakdownPhoto, PublicHoliday, CFMEUDate, AUSTRALIAN_STATES,
                    ScheduleDayOverride, DiagramLayer, PanelInstallRecord)
from datetime import date, datetime, timedelta
from fpdf import FPDF, XPos, YPos
import os, json, uuid, smtplib, math, re
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from email.mime.image import MIMEImage
from werkzeug.utils import secure_filename
import storage
try:
    import openpyxl
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-key-change-in-production')
_db_url = os.environ.get('DATABASE_URL', 'sqlite:///tracking.db')
# Railway provides postgres:// — SQLAlchemy requires postgresql://
if _db_url.startswith('postgres://'):
    _db_url = _db_url.replace('postgres://', 'postgresql://', 1)
app.config['SQLALCHEMY_DATABASE_URI'] = _db_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # 32 MB upload limit

ALLOWED_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx', 'xls', 'xlsx', 'dwg', 'dxf'}
DOC_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'dwg', 'dxf', 'doc', 'docx', 'xls', 'xlsx'}
PHOTO_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'instance', 'uploads')
SETTINGS_FILE = os.path.join(os.path.dirname(__file__), 'instance', 'settings.json')

db.init_app(app)

from blueprints.auth import auth_bp
app.register_blueprint(auth_bp)

from blueprints.entries import entries_bp
app.register_blueprint(entries_bp)

from blueprints.hire import hire_bp
app.register_blueprint(hire_bp)

from blueprints.equipment import equipment_bp
app.register_blueprint(equipment_bp)

from blueprints.documents import documents_bp
app.register_blueprint(documents_bp)

from blueprints.delays import delays_bp
app.register_blueprint(delays_bp)

from blueprints.panels import panels_bp
app.register_blueprint(panels_bp)

from blueprints.projects import projects_bp
app.register_blueprint(projects_bp)

from blueprints.scheduling import scheduling_bp
app.register_blueprint(scheduling_bp)

login_manager = LoginManager(app)
login_manager.login_view = 'auth.login'
login_manager.login_message = 'Please log in to access this page.'
login_manager.login_message_category = 'warning'


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


with app.app_context():
    db.create_all()
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    # Fix entries with delay_reason set but delay_hours = 0
    try:
        from sqlalchemy import text
        with db.engine.connect() as conn:
            conn.execute(text("UPDATE daily_entry SET delay_reason = NULL WHERE delay_hours = 0 OR delay_hours IS NULL"))
            conn.commit()
    except Exception:
        pass
    # Add group_name column to role table if it doesn't exist yet
    try:
        from sqlalchemy import text
        with db.engine.connect() as conn:
            conn.execute(text("ALTER TABLE role ADD COLUMN group_name VARCHAR(100)"))
            conn.commit()
    except Exception:
        pass  # Column already exists
    for stmt in [
        "ALTER TABLE project ADD COLUMN state VARCHAR(10)",
        "ALTER TABLE project ADD COLUMN is_cfmeu BOOLEAN DEFAULT 0",
        "ALTER TABLE swing_pattern RENAME COLUMN work_days TO work_weeks",
        "ALTER TABLE employee_swing ADD COLUMN day_offset INTEGER DEFAULT 0",
        "ALTER TABLE machine ADD COLUMN plant_id VARCHAR(100)",
        "ALTER TABLE machine ADD COLUMN description TEXT",
        "ALTER TABLE hired_machine ADD COLUMN plant_id VARCHAR(100)",
        "ALTER TABLE hired_machine ADD COLUMN description TEXT",
        "ALTER TABLE user ADD COLUMN email VARCHAR(200)",
        "ALTER TABLE daily_entry ADD COLUMN weather VARCHAR(200)",
        "ALTER TABLE diagram_layer ADD COLUMN canvas_bg_filename VARCHAR(500)",
        "ALTER TABLE diagram_layer ADD COLUMN canvas_bg_original_name VARCHAR(500)",
        "ALTER TABLE panel_install_record ADD COLUMN source VARCHAR(20)",
    ]:
        try:
            db.session.execute(db.text(stmt))
            db.session.commit()
        except Exception:
            db.session.rollback()
    # Seed default admin user if none exist (guard against race condition with multiple workers)
    try:
        if User.query.count() == 0:
            from werkzeug.security import generate_password_hash
            admin = User(
                username='admin',
                display_name='Administrator',
                password_hash=generate_password_hash('admin123'),
                is_admin=True,
                active=True,
            )
            db.session.add(admin)
            db.session.commit()
            print("Created default admin user: admin / admin123 — please change the password!")
    except Exception:
        db.session.rollback()


@app.context_processor
def inject_active_projects():
    """Make active projects available in all templates for the Progress nav dropdown."""
    try:
        projects = Project.query.filter_by(active=True).order_by(Project.name).all()
    except Exception:
        projects = []
    return {'_active_projects': projects}


@app.before_request
def require_login():
    """Redirect unauthenticated users to login for all routes except login/static."""
    public_endpoints = {'auth.login', 'auth.logout', 'static'}
    if request.endpoint not in public_endpoints and not current_user.is_authenticated:
        return redirect(url_for('auth.login', next=request.url))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def allowed_photo(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in PHOTO_EXTENSIONS


def allowed_doc(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in DOC_EXTENSIONS


def load_settings():
    if os.path.exists(SETTINGS_FILE):
        with open(SETTINGS_FILE, 'r') as f:
            return json.load(f)
    return {
        'company_name': '',
        'smtp_server': 'smtp.gmail.com',
        'smtp_port': 587,
        'smtp_username': '',
        'smtp_password': '',
        'from_name': '',
        'from_email': '',
    }


def save_settings(data):
    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def safe(s):
    """Sanitize text for fpdf2 core fonts (Latin-1 only)."""
    if s is None:
        return ''
    s = str(s)
    for old, new in {
        '\u2018': "'", '\u2019': "'",
        '\u201c': '"', '\u201d': '"',
        '\u2013': '-', '\u2014': '--',
        '\u2026': '...',
        '\u00a0': ' ',
        '\u2022': '*',
    }.items():
        s = s.replace(old, new)
    return s.encode('latin-1', errors='replace').decode('latin-1')


def build_day_summary(hm, date_from, date_to):
    """Return a list of dicts for each day in range, plus summary counts."""
    sd_map = {sd.stand_down_date: sd.reason for sd in hm.stand_downs}
    count_saturdays = hm.count_saturdays if hm.count_saturdays is not None else True
    days = []
    current = date_from
    while current <= date_to:
        weekday = current.weekday()
        is_sunday = weekday == 6
        is_saturday = weekday == 5

        if is_sunday or (is_saturday and not count_saturdays):
            status = 'non_working'
        elif hm.delivery_date and current < hm.delivery_date:
            status = 'not_delivered'
        elif hm.return_date and current > hm.return_date:
            status = 'returned'
        elif current in sd_map:
            status = 'stood_down'
        else:
            status = 'on_site'

        days.append({
            'date': current,
            'day_name': current.strftime('%A'),
            'status': status,
            'reason': sd_map.get(current, ''),
        })
        current += timedelta(days=1)

    on_site    = sum(1 for d in days if d['status'] == 'on_site')
    stood_down = sum(1 for d in days if d['status'] == 'stood_down')
    working_days = on_site + stood_down
    days_pw = 6 if count_saturdays else 5
    cost_per_day_derived = hm.cost_per_week / days_pw if hm.cost_per_week else None
    summary = {
        'on_site': on_site,
        'stood_down': stood_down,
        'working_days': working_days,
        'total_days': len(days),
        'cost_day': round(on_site * cost_per_day_derived, 2) if cost_per_day_derived else None,
        'cost_per_day_derived': round(cost_per_day_derived, 2) if cost_per_day_derived else None,
        'cost_week': hm.cost_per_week,
        'count_saturdays': count_saturdays,
    }
    return days, summary


def _natural_key(s):
    """Sort key for natural ordering: LOT 1, LOT 2, LOT 10 (not LOT 1, LOT 10, LOT 2)."""
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', s or '')]


def compute_project_progress(project_id):
    """Return planned vs actual progress data for a project."""
    planned = PlannedData.query.filter_by(project_id=project_id).all()
    if not planned:
        return None

    entries = (DailyEntry.query
               .filter_by(project_id=project_id)
               .filter(DailyEntry.install_sqm > 0)
               .all())

    # Aggregate planned by (lot, material)
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

    # Aggregate actuals by (lot_number, material)
    actual_by_task = {}
    total_install_hours = 0.0
    for e in entries:
        key = (e.lot_number or '', e.material or '')
        actual_by_task[key] = actual_by_task.get(key, 0.0) + (e.install_sqm or 0)
        total_install_hours += (e.install_hours or 0)

    tasks = []
    total_planned = 0.0
    total_actual = 0.0
    # Natural sort by lot then material
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

    # Latest crew count
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


def compute_gantt_data(project_id):
    """Build day-by-day Gantt data matching the matplotlib approach.

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

    non_work_set = {nwd.date for nwd in project.non_work_dates}
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
    task_info = {}
    task_order_keys = []
    for p in planned:
        key = (p.lot or '', p.material or '')
        if key not in task_info:
            label = (f"{p.lot} — {p.material}" if p.lot and p.material
                     else (p.lot or p.material or 'Unknown'))
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

    # Actuals by (lot_number, material) — deduplicate dates per task
    actuals_by_task = {}
    for e in entries:
        key = (e.lot_number or '', e.material or '')
        if key not in actuals_by_task:
            actuals_by_task[key] = {'sqm': 0.0, 'hrs': 0.0, 'dates': set()}
        actuals_by_task[key]['sqm'] += e.install_sqm or 0
        actuals_by_task[key]['hrs'] += e.install_hours or 0
        actuals_by_task[key]['dates'].add(e.entry_date)

    # Install rates per task + global fallback
    task_rates = {}
    for key, data in actuals_by_task.items():
        if data['hrs'] > 0 and data['sqm'] > 0:
            task_rates[key] = data['sqm'] / data['hrs']
    total_sqm = sum(d['sqm'] for d in actuals_by_task.values())
    total_hrs = sum(d['hrs'] for d in actuals_by_task.values())
    global_rate = (total_sqm / total_hrs) if total_hrs > 0 else 87.5

    # Current crew for forecast
    latest_entry = (DailyEntry.query.filter_by(project_id=project_id)
                    .order_by(DailyEntry.entry_date.desc()).first())
    hours_per_day = project.hours_per_day or 8
    curr_crew = (latest_entry.num_people if latest_entry and latest_entry.num_people
                 else project.planned_crew or 10)
    daily_cap_hrs = curr_crew * hours_per_day

    today = date.today()
    target_finish = max(day_to_date.values()) if day_to_date else None

    # Standdown dates — split by cause for Gantt shading, combined for forecast skip
    _delay_entries = (DailyEntry.query.filter_by(project_id=project_id)
                      .filter(DailyEntry.delay_hours > 0).all())
    delay_entry_dates = {e.entry_date for e in _delay_entries}
    weather_delay_dates = {
        e.entry_date for e in _delay_entries
        if e.delay_reason and 'weather' in e.delay_reason.lower()
    }
    client_delay_dates = delay_entry_dates - weather_delay_dates

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
    # (sorted by lot then planned start, each task starts after the previous finishes)
    forecast_by_task = {}
    est_finish_by_task = {}

    # Initialize global_last_date to the latest actual work done on ANY task.
    # This ensures out-of-order actual work pushes all subsequent forecasts forward.
    max_global_actual = None
    for act_data in actuals_by_task.values():
        if act_data['dates']:
            t_max = max(act_data['dates'])
            if max_global_actual is None or t_max > max_global_actual:
                max_global_actual = t_max
    global_last_date = max_global_actual  # replaces "global_last_date = None"

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
            actual_work_days = len(act['dates']) if act and act['dates'] else 0
            if actual_work_days > 0 and act and act['sqm'] > 0:
                # Use effective daily sqm — naturally accounts for partial standdowns
                effective_daily_sqm = act['sqm'] / actual_work_days
                days_req = max(1, math.ceil(remaining / effective_daily_sqm - 0.001))
            else:
                # No actuals yet — use planned number of days
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
        'variance_days': variance_overall,
        'week_markers': week_markers,
        'month_markers': month_markers,
    }


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
    """Return per-entry delay breakdown grouped by role, with billable split."""
    query = (DailyEntry.query
             .filter(DailyEntry.delay_hours > 0)
             .filter(DailyEntry.entry_date >= date_from)
             .filter(DailyEntry.entry_date <= date_to)
             .order_by(DailyEntry.entry_date))
    if project_id:
        query = query.filter_by(project_id=int(project_id))
    if billable_filter == 'billable':
        query = query.filter(DailyEntry.delay_billable == True)
    elif billable_filter == 'non_billable':
        query = query.filter(DailyEntry.delay_billable == False)

    rows = []
    total_cost = 0.0
    total_hours_billable = 0.0
    total_hours_non_billable = 0.0

    for entry in query.all():
        # Group employees by (role_title, rate) — show role not individual name
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

        machine_lines = []
        for m in entry.machines:
            if m.delay_rate:
                cost = round(entry.delay_hours * m.delay_rate, 2)
                machine_lines.append({'name': m.name, 'rate': m.delay_rate,
                                      'hours': entry.delay_hours, 'cost': cost})

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
            'entry_cost': entry_cost,
            'billable': is_billable,
        })

    billable_count = sum(1 for r in rows if r['billable'])
    summary = {
        'total_cost': round(total_cost, 2),
        'total_hours': total_hours_billable + total_hours_non_billable,
        'total_hours_billable': total_hours_billable,
        'total_hours_non_billable': total_hours_non_billable,
        'entry_count': len(rows),
        'billable_count': billable_count,
        'non_billable_count': len(rows) - billable_count,
    }
    return rows, summary


def generate_pdf(hm, date_from, date_to, days, summary, settings):
    """Build a stand-down report PDF and return bytes."""
    pdf = FPDF()
    pdf.set_margins(15, 15, 15)
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    company = safe(settings.get('company_name', '') or 'Project Tracker')

    pdf.set_font('Helvetica', 'B', 18)
    pdf.cell(0, 10, company, new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.set_font('Helvetica', 'B', 13)
    pdf.cell(0, 8, 'MACHINE HIRE STAND-DOWN REPORT', new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.set_font('Helvetica', '', 9)
    pdf.cell(0, 5, f'Generated: {date.today().strftime("%d/%m/%Y")}', new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.ln(6)

    pdf.set_fill_color(240, 244, 255)
    pdf.set_font('Helvetica', 'B', 10)
    pdf.cell(0, 7, 'MACHINE DETAILS', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
    pdf.set_font('Helvetica', '', 10)

    def detail_row(label, value):
        pdf.set_font('Helvetica', 'B', 9)
        pdf.cell(45, 6, label + ':')
        pdf.set_font('Helvetica', '', 9)
        pdf.cell(0, 6, safe(value) if value else '-', new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    detail_row('Machine', hm.machine_name)
    detail_row('Type', hm.machine_type)
    detail_row('Hire Company', hm.hire_company)
    detail_row('Company Email', hm.hire_company_email)
    detail_row('Delivery Date', hm.delivery_date.strftime('%d/%m/%Y') if hm.delivery_date else None)
    detail_row('Return Date', hm.return_date.strftime('%d/%m/%Y') if hm.return_date else None)
    detail_row('Project', hm.project.name)
    sat_billing = 'Yes (Saturdays billable)' if (hm.count_saturdays is not False) else 'No (Saturdays excluded)'
    detail_row('Saturday Billing', sat_billing)
    pdf.ln(4)

    pdf.set_fill_color(240, 244, 255)
    pdf.set_font('Helvetica', 'B', 10)
    pdf.cell(0, 7, 'REPORT PERIOD', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
    pdf.set_font('Helvetica', '', 9)
    pdf.cell(0, 6, f'{date_from.strftime("%d/%m/%Y")}  to  {date_to.strftime("%d/%m/%Y")}', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(4)

    pdf.set_fill_color(240, 244, 255)
    pdf.set_font('Helvetica', 'B', 10)
    pdf.cell(0, 7, 'DAILY SUMMARY', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)

    col_w = [28, 26, 30, 96]
    pdf.set_font('Helvetica', 'B', 8)
    pdf.set_fill_color(220, 230, 255)
    for i, (header, w) in enumerate(zip(['Date', 'Day', 'Status', 'Notes / Reason'], col_w)):
        is_last = (i == 3)
        pdf.cell(w, 6, header, border=1, fill=True,
                 new_x=XPos.LMARGIN if is_last else XPos.RIGHT,
                 new_y=YPos.NEXT if is_last else YPos.TOP)

    status_labels = {
        'on_site': 'On Site', 'stood_down': 'Stood Down',
        'not_delivered': 'Not Yet Delivered', 'returned': 'Returned',
        'non_working': 'Non-Working Day',
    }
    for d in days:
        is_sd = d['status'] == 'stood_down'
        is_nw = d['status'] == 'non_working'
        pdf.set_text_color(180, 30, 30) if is_sd else (
            pdf.set_text_color(160, 160, 160) if is_nw else pdf.set_text_color(0, 0, 0))
        pdf.set_font('Helvetica', 'B' if is_sd else '', 8)
        pdf.cell(col_w[0], 6, d['date'].strftime('%d/%m/%Y'), border=1)
        pdf.cell(col_w[1], 6, d['day_name'], border=1)
        pdf.cell(col_w[2], 6, status_labels.get(d['status'], d['status']), border=1)
        pdf.set_font('Helvetica', '', 8)
        pdf.cell(col_w[3], 6, safe(d['reason'])[:60], border=1, new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_text_color(0, 0, 0)
    pdf.ln(5)

    pdf.set_fill_color(240, 244, 255)
    pdf.set_font('Helvetica', 'B', 10)
    pdf.cell(0, 7, 'SUMMARY', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
    pdf.set_font('Helvetica', '', 9)
    detail_row('Total Calendar Days', summary['total_days'])
    detail_row('Working Days in Period', summary['working_days'])
    detail_row('Days On Site (Billable)', summary['on_site'])
    detail_row('Days Stood Down', summary['stood_down'])
    detail_row('Saturday Billing', 'Included' if summary.get('count_saturdays', True) else 'Excluded')
    if summary['cost_week']:
        detail_row('Rate (per week)', f"${hm.cost_per_week:,.2f}")
    if summary.get('cost_per_day_derived') is not None:
        detail_row('Rate (per day, derived)', f"${summary['cost_per_day_derived']:,.2f}")
    if summary['cost_day'] is not None:
        detail_row('Estimated Cost (on-site days)', f"${summary['cost_day']:,.2f}")
    pdf.ln(4)

    sd_days = [d for d in days if d['status'] == 'stood_down']
    if sd_days:
        pdf.set_fill_color(255, 240, 240)
        pdf.set_font('Helvetica', 'B', 10)
        pdf.cell(0, 7, 'STAND-DOWN DAYS (NOT CHARGED)', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
        pdf.set_font('Helvetica', '', 9)
        for d in sd_days:
            pdf.set_font('Helvetica', 'B', 9)
            pdf.cell(35, 6, d['date'].strftime('%d/%m/%Y') + ' ' + d['day_name'][:3] + ':')
            pdf.set_font('Helvetica', '', 9)
            pdf.cell(0, 6, safe(d['reason']) or '-', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(4)

    pdf.ln(6)
    pdf.set_font('Helvetica', '', 9)
    pdf.cell(90, 6, 'Prepared by: ________________________________')
    pdf.cell(0, 6, 'Date: ____________________', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(3)
    pdf.cell(90, 6, 'Signature: ___________________________________', new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    return bytes(pdf.output())


def generate_delay_pdf(rows, summary, date_from, date_to, project_name, settings):
    """Build a client delay charge report PDF and return bytes."""
    pdf = FPDF()
    pdf.set_margins(15, 15, 15)
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    company = safe(settings.get('company_name', '') or 'Project Tracker')

    pdf.set_font('Helvetica', 'B', 18)
    pdf.cell(0, 10, company, new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.set_font('Helvetica', 'B', 13)
    pdf.cell(0, 8, 'DELAY CHARGE REPORT', new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.set_font('Helvetica', '', 9)
    pdf.cell(0, 5, f'Generated: {date.today().strftime("%d/%m/%Y")}', new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.ln(5)

    pdf.set_fill_color(240, 244, 255)
    pdf.set_font('Helvetica', 'B', 10)
    pdf.cell(0, 7, 'REPORT DETAILS', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)

    def detail_row(label, value):
        pdf.set_font('Helvetica', 'B', 9)
        pdf.cell(45, 6, label + ':')
        pdf.set_font('Helvetica', '', 9)
        pdf.cell(0, 6, safe(value) if value else '-', new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    detail_row('Period', f'{date_from.strftime("%d/%m/%Y")} to {date_to.strftime("%d/%m/%Y")}')
    detail_row('Project', project_name or 'All Projects')
    detail_row('Billable Delay Events', str(summary['billable_count']))
    detail_row('Total Billable Hours', f'{summary["total_hours_billable"]} hrs')
    detail_row('Non-Billable Events', str(summary['non_billable_count']))
    pdf.ln(4)

    billable_rows = [r for r in rows if r['billable']]
    non_billable_rows = [r for r in rows if not r['billable']]

    def render_rows(rows_list, title, fill_color):
        if not rows_list:
            return
        pdf.set_fill_color(*fill_color)
        pdf.set_font('Helvetica', 'B', 11)
        pdf.cell(0, 7, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
        pdf.ln(1)

        col_w = [70, 30, 30, 50]
        for row in rows_list:
            entry = row['entry']
            pdf.set_fill_color(230, 235, 255)
            pdf.set_font('Helvetica', 'B', 10)
            label = safe(f'{entry.entry_date.strftime("%d/%m/%Y")} ({entry.day_name})  -  '
                         f'{entry.project.name}  -  {entry.delay_hours} hrs delay')
            pdf.cell(0, 7, label, new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)

            pdf.set_font('Helvetica', 'I', 9)
            pdf.cell(0, 5, safe(f'Reason: {entry.delay_reason or "Not specified"}'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            if entry.delay_description:
                pdf.multi_cell(0, 5, safe(entry.delay_description))
            pdf.ln(1)

            pdf.set_font('Helvetica', 'B', 8)
            pdf.set_fill_color(210, 218, 255)
            for header, w in zip(['Role / Equipment', 'Rate ($/hr)', 'Hours', 'Cost ($)'], col_w):
                pdf.cell(w, 6, header, border=1, fill=True)
            pdf.ln()

            pdf.set_font('Helvetica', '', 8)
            if row['emp_lines']:
                for line in row['emp_lines']:
                    pdf.cell(col_w[0], 5, safe('  ' + line['name']), border=1)
                    pdf.cell(col_w[1], 5, f'${line["rate"]:.2f}', border=1)
                    pdf.cell(col_w[2], 5, str(line['hours']), border=1)
                    pdf.cell(col_w[3], 5, f'${line["cost"]:.2f}', border=1)
                    pdf.ln()
            if row['machine_lines']:
                for line in row['machine_lines']:
                    pdf.cell(col_w[0], 5, safe('  ' + line['name']), border=1)
                    pdf.cell(col_w[1], 5, f'${line["rate"]:.2f}', border=1)
                    pdf.cell(col_w[2], 5, str(line['hours']), border=1)
                    pdf.cell(col_w[3], 5, f'${line["cost"]:.2f}', border=1)
                    pdf.ln()

            pdf.set_font('Helvetica', 'B', 9)
            pdf.set_text_color(30, 80, 180)
            pdf.cell(0, 6, f'  Event Total: ${row["entry_cost"]:.2f}', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_text_color(0, 0, 0)
            pdf.ln(3)

    render_rows(billable_rows, 'BILLABLE DELAYS (CHARGED TO CLIENT)', (255, 235, 235))
    render_rows(non_billable_rows, 'NON-BILLABLE DELAYS (OWN COST)', (235, 245, 255))

    pdf.ln(3)
    pdf.set_fill_color(30, 80, 180)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('Helvetica', 'B', 12)
    pdf.cell(0, 10, f'  TOTAL BILLABLE DELAY CHARGES:  ${summary["total_cost"]:,.2f}', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
    pdf.set_text_color(0, 0, 0)

    pdf.ln(8)
    pdf.set_font('Helvetica', '', 9)
    pdf.cell(90, 6, 'Authorised by: ________________________________')
    pdf.cell(0, 6, 'Date: ____________________', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(3)
    pdf.cell(90, 6, 'Signature: ___________________________________', new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    return bytes(pdf.output())


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    today = date.today()
    recent_entries = (
        DailyEntry.query
        .order_by(DailyEntry.entry_date.desc(), DailyEntry.created_at.desc())
        .limit(10).all()
    )
    total_entries = DailyEntry.query.count()
    entries_today = DailyEntry.query.filter_by(entry_date=today).count()
    active_projects = Project.query.filter_by(active=True).count()
    active_hired = HiredMachine.query.filter_by(active=True).count()
    return render_template('index.html', recent_entries=recent_entries,
                           total_entries=total_entries, entries_today=entries_today,
                           active_projects=active_projects, active_hired=active_hired,
                           today=today)


# ---------------------------------------------------------------------------
# Admin — SQLite → Postgres one-time migration
# ---------------------------------------------------------------------------

@app.route('/admin/migrate-from-sqlite')
@login_required
def admin_migrate_sqlite():
    """One-time migration: read the old SQLite file on the volume and import into Postgres."""
    if not current_user.is_admin:
        flash('Admin access required.', 'danger')
        return redirect(url_for('index'))

    db_url = app.config['SQLALCHEMY_DATABASE_URI']
    if not db_url.startswith('postgresql'):
        flash('This tool only works when the app is using PostgreSQL. You are currently on SQLite.', 'warning')
        return redirect(url_for('admin_settings'))

    # Find the SQLite file — try common Railway paths
    sqlite_candidates = [
        os.path.join(os.path.dirname(__file__), 'instance', 'tracking.db'),
        '/app/instance/tracking.db',
        '/data/tracking.db',
        '/var/data/tracking.db',
    ]
    sqlite_path = next((p for p in sqlite_candidates if os.path.exists(p)), None)
    if not sqlite_path:
        flash('SQLite file not found. It may have already been cleaned up, or was never on this volume.', 'danger')
        return redirect(url_for('admin_settings'))

    import sqlite3 as _sqlite3
    conn = _sqlite3.connect(sqlite_path)
    conn.row_factory = _sqlite3.Row

    def tbl(name):
        try:
            cur = conn.execute(f"SELECT * FROM {name}")
            return [dict(r) for r in cur.fetchall()]
        except Exception:
            return []

    def assoc(name):
        try:
            cur = conn.execute(f"SELECT * FROM {name}")
            return [list(r) for r in cur.fetchall()]
        except Exception:
            return []

    data = {
        'role':                  tbl('role'),
        'project':               tbl('project'),
        'employee':              tbl('employee'),
        'machine':               tbl('machine'),
        'daily_entry':           tbl('daily_entry'),
        'entry_employees':       assoc('entry_employees'),
        'entry_machines':        assoc('entry_machines'),
        'hired_machine':         tbl('hired_machine'),
        'stand_down':            tbl('stand_down'),
        'planned_data':          tbl('planned_data'),
        'project_non_work_date': tbl('project_non_work_date'),
        'project_budgeted_role': tbl('project_budgeted_role'),
        'project_machine':       tbl('project_machine'),
        'project_worked_sunday': tbl('project_worked_sunday'),
        'public_holiday':        tbl('public_holiday'),
        'cfmeu_date':            tbl('cfmeu_date'),
        'swing_pattern':         tbl('swing_pattern'),
        'employee_swing':        tbl('employee_swing'),
        'user':                  tbl('user'),
    }
    conn.close()

    total = sum(len(v) for v in data.values())
    if total == 0:
        flash('SQLite file exists but appears to be empty — nothing to migrate.', 'warning')
        return redirect(url_for('admin_settings'))

    # Save as JSON and feed through the existing import route logic
    import io
    json_bytes = json.dumps(data, default=str).encode('utf-8')
    json_file = io.BytesIO(json_bytes)
    json_file.filename = 'export.json'

    # Store in session and redirect to import page with auto-trigger
    # Instead, redirect with the data available via a temp file
    tmp_path = os.path.join(os.path.dirname(__file__), 'instance', '_sqlite_migration.json')
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, default=str)

    flash(f'SQLite file found with {total} rows. Use the Import Data page to upload the migration file, '
          f'or visit /admin/migrate-from-sqlite/run to run it automatically.', 'info')
    return redirect(url_for('admin_migrate_sqlite_run'))


@app.route('/admin/migrate-from-sqlite/run')
@login_required
def admin_migrate_sqlite_run():
    """Actually perform the SQLite → Postgres migration using the temp JSON file."""
    if not current_user.is_admin:
        flash('Admin access required.', 'danger')
        return redirect(url_for('index'))

    tmp_path = os.path.join(os.path.dirname(__file__), 'instance', '_sqlite_migration.json')
    if not os.path.exists(tmp_path):
        flash('No migration file found. Visit /admin/migrate-from-sqlite first.', 'danger')
        return redirect(url_for('admin_settings'))

    with open(tmp_path, encoding='utf-8') as f:
        data = json.load(f)

    from sqlalchemy import text as _text

    def _d(val):
        if not val:
            return None
        try:
            return datetime.strptime(str(val)[:10], '%Y-%m-%d').date()
        except Exception:
            return None

    counts = {}
    try:
        # Roles
        role_id_map = {}
        for r in data.get('role', []):
            existing = Role.query.filter_by(name=r['name']).first()
            if not existing:
                obj = Role(name=r['name'], delay_rate=r.get('delay_rate'), group_name=r.get('group_name'))
                db.session.add(obj)
                db.session.flush()
                role_id_map[r['id']] = obj.id
            else:
                role_id_map[r['id']] = existing.id
        counts['roles'] = len(role_id_map)

        # Projects
        proj_id_map = {}
        for p in data.get('project', []):
            existing = Project.query.filter_by(name=p['name']).first()
            if existing:
                proj_id_map[p['id']] = existing.id
                continue
            obj = Project(
                name=p['name'], description=p.get('description'),
                active=bool(p.get('active', True)),
                start_date=_d(p.get('start_date')),
                planned_crew=p.get('planned_crew'),
                hours_per_day=p.get('hours_per_day'),
                quoted_days=p.get('quoted_days'),
                state=p.get('state'), is_cfmeu=bool(p.get('is_cfmeu', False)),
            )
            db.session.add(obj)
            db.session.flush()
            proj_id_map[p['id']] = obj.id
        counts['projects'] = len(proj_id_map)

        # Employees
        emp_id_map = {}
        for e in data.get('employee', []):
            existing = Employee.query.filter_by(name=e['name']).first()
            if existing:
                emp_id_map[e['id']] = existing.id
                continue
            obj = Employee(
                name=e['name'], role=e.get('role'),
                role_id=role_id_map.get(e['role_id']) if e.get('role_id') else None,
                delay_rate=e.get('delay_rate'), active=bool(e.get('active', True)),
            )
            db.session.add(obj)
            db.session.flush()
            emp_id_map[e['id']] = obj.id
        counts['employees'] = len(emp_id_map)

        # Machines
        mach_id_map = {}
        for m in data.get('machine', []):
            existing = Machine.query.filter_by(name=m['name']).first()
            if existing:
                mach_id_map[m['id']] = existing.id
                continue
            obj = Machine(
                name=m['name'], machine_type=m.get('machine_type'),
                delay_rate=m.get('delay_rate'), active=bool(m.get('active', True)),
            )
            db.session.add(obj)
            db.session.flush()
            mach_id_map[m['id']] = obj.id
        counts['machines'] = len(mach_id_map)

        # Daily Entries
        entry_id_map = {}
        for e in data.get('daily_entry', []):
            new_proj_id = proj_id_map.get(e['project_id'])
            if not new_proj_id:
                continue
            obj = DailyEntry(
                project_id=new_proj_id, entry_date=_d(e['entry_date']),
                lot_number=e.get('lot_number'), location=e.get('location'),
                material=e.get('material'), num_people=e.get('num_people'),
                install_hours=e.get('install_hours') or 0,
                install_sqm=e.get('install_sqm') or 0,
                delay_hours=e.get('delay_hours') or 0,
                delay_billable=bool(e.get('delay_billable', True)),
                delay_reason=e.get('delay_reason'),
                delay_description=e.get('delay_description'),
                machines_stood_down=bool(e.get('machines_stood_down', False)),
                notes=e.get('notes'),
                other_work_description=e.get('other_work_description'),
                weather=e.get('weather'),
            )
            db.session.add(obj)
            db.session.flush()
            entry_id_map[e['id']] = obj.id
        counts['entries'] = len(entry_id_map)

        # Entry ↔ Employee
        assoc_e = 0
        for row in data.get('entry_employees', []):
            new_entry_id = entry_id_map.get(row[0])
            new_emp_id = emp_id_map.get(row[1])
            if new_entry_id and new_emp_id:
                db.session.execute(_text(
                    'INSERT INTO entry_employees (entry_id, employee_id) VALUES (:e, :m)'
                ), {'e': new_entry_id, 'm': new_emp_id})
                assoc_e += 1
        counts['entry_employees'] = assoc_e

        # Entry ↔ Machine
        assoc_m = 0
        for row in data.get('entry_machines', []):
            new_entry_id = entry_id_map.get(row[0])
            new_mach_id = mach_id_map.get(row[1])
            if new_entry_id and new_mach_id:
                db.session.execute(_text(
                    'INSERT INTO entry_machines (entry_id, machine_id) VALUES (:e, :m)'
                ), {'e': new_entry_id, 'm': new_mach_id})
                assoc_m += 1
        counts['entry_machines'] = assoc_m

        # Hired Machines
        hm_id_map = {}
        for h in data.get('hired_machine', []):
            new_proj_id = proj_id_map.get(h['project_id'])
            if not new_proj_id:
                continue
            obj = HiredMachine(
                project_id=new_proj_id, machine_name=h['machine_name'],
                machine_type=h.get('machine_type'), hire_company=h.get('hire_company'),
                delivery_date=_d(h.get('delivery_date')), return_date=_d(h.get('return_date')),
                cost_per_day=h.get('cost_per_day'), cost_per_week=h.get('cost_per_week'),
                active=bool(h.get('active', True)), notes=h.get('notes'),
            )
            db.session.add(obj)
            db.session.flush()
            hm_id_map[h['id']] = obj.id
        counts['hired_machines'] = len(hm_id_map)

        # Public Holidays
        ph_count = 0
        for h in data.get('public_holiday', []):
            existing = PublicHoliday.query.filter_by(date=_d(h['date']), name=h['name']).first()
            if not existing:
                db.session.add(PublicHoliday(
                    date=_d(h['date']), name=h['name'],
                    state=h.get('state', 'ALL'), recurring=bool(h.get('recurring', True)),
                ))
                ph_count += 1
        counts['public_holidays'] = ph_count

        # CFMEU Dates
        cfmeu_count = 0
        for c in data.get('cfmeu_date', []):
            existing = CFMEUDate.query.filter_by(date=_d(c['date'])).first()
            if not existing:
                db.session.add(CFMEUDate(
                    date=_d(c['date']), name=c.get('name', ''),
                    state=c.get('state', 'ALL'),
                ))
                cfmeu_count += 1
        counts['cfmeu_dates'] = cfmeu_count

        # Non-work dates, budgeted roles, worked sundays
        for n in data.get('project_non_work_date', []):
            new_proj_id = proj_id_map.get(n['project_id'])
            if new_proj_id:
                db.session.add(ProjectNonWorkDate(project_id=new_proj_id, date=_d(n['date']), reason=n.get('reason')))
        for b in data.get('project_budgeted_role', []):
            new_proj_id = proj_id_map.get(b['project_id'])
            if new_proj_id:
                db.session.add(ProjectBudgetedRole(project_id=new_proj_id, role_name=b['role_name'], budgeted_count=b.get('budgeted_count', 1)))
        for w in data.get('project_worked_sunday', []):
            new_proj_id = proj_id_map.get(w['project_id'])
            if new_proj_id:
                db.session.add(ProjectWorkedSunday(project_id=new_proj_id, date=_d(w['date']), reason=w.get('reason')))

        db.session.commit()
        os.remove(tmp_path)  # Clean up temp file

        summary = ', '.join(f'{v} {k}' for k, v in counts.items() if v)
        flash(f'Migration successful! {summary}', 'success')

    except Exception as e:
        db.session.rollback()
        flash(f'Migration failed: {e}', 'danger')

    return redirect(url_for('admin_settings'))


# ---------------------------------------------------------------------------
# Admin — Data Import (migrate local data to production)
# ---------------------------------------------------------------------------

@app.route('/admin/import-data', methods=['GET', 'POST'])
def admin_import_data():
    if not current_user.is_admin:
        flash('Admin access required.', 'danger')
        return redirect(url_for('index'))

    if request.method == 'POST':
        f = request.files.get('export_file')
        if not f or not f.filename.endswith('.json'):
            flash('Please upload a valid export.json file.', 'danger')
            return redirect(url_for('admin_import_data'))

        try:
            data = json.loads(f.read().decode('utf-8'))
        except Exception as e:
            flash(f'Could not read file: {e}', 'danger')
            return redirect(url_for('admin_import_data'))

        from sqlalchemy import text as _text

        def _d(val):
            """Parse date string or return None."""
            if not val:
                return None
            try:
                return datetime.strptime(val[:10], '%Y-%m-%d').date()
            except Exception:
                return None

        def _dt(val):
            if not val:
                return None
            try:
                return datetime.strptime(val[:19], '%Y-%m-%d %H:%M:%S')
            except Exception:
                return None

        counts = {}
        try:
            # ── Roles ──────────────────────────────────────────────────────
            role_id_map = {}
            for r in data.get('role', []):
                existing = Role.query.filter_by(name=r['name']).first()
                if not existing:
                    obj = Role(name=r['name'], delay_rate=r.get('delay_rate'))
                    db.session.add(obj)
                    db.session.flush()
                    role_id_map[r['id']] = obj.id
                else:
                    role_id_map[r['id']] = existing.id
            counts['roles'] = len(role_id_map)

            # ── Projects ───────────────────────────────────────────────────
            proj_id_map = {}
            for p in data.get('project', []):
                obj = Project(
                    name=p['name'],
                    description=p.get('description'),
                    active=bool(p.get('active', True)),
                    start_date=_d(p.get('start_date')),
                    planned_crew=p.get('planned_crew'),
                    hours_per_day=p.get('hours_per_day'),
                    quoted_days=p.get('quoted_days'),
                )
                db.session.add(obj)
                db.session.flush()
                proj_id_map[p['id']] = obj.id
            counts['projects'] = len(proj_id_map)

            # ── Employees ──────────────────────────────────────────────────
            emp_id_map = {}
            for e in data.get('employee', []):
                old_role_id = e.get('role_id')
                obj = Employee(
                    name=e['name'],
                    role=e.get('role'),
                    role_id=role_id_map.get(old_role_id) if old_role_id else None,
                    delay_rate=e.get('delay_rate'),
                    active=bool(e.get('active', True)),
                )
                db.session.add(obj)
                db.session.flush()
                emp_id_map[e['id']] = obj.id
            counts['employees'] = len(emp_id_map)

            # ── Machines ───────────────────────────────────────────────────
            mach_id_map = {}
            for m in data.get('machine', []):
                obj = Machine(
                    name=m['name'],
                    machine_type=m.get('machine_type'),
                    delay_rate=m.get('delay_rate'),
                    active=bool(m.get('active', True)),
                )
                db.session.add(obj)
                db.session.flush()
                mach_id_map[m['id']] = obj.id
            counts['machines'] = len(mach_id_map)

            # ── Daily Entries ──────────────────────────────────────────────
            entry_id_map = {}
            for e in data.get('daily_entry', []):
                new_proj_id = proj_id_map.get(e['project_id'])
                if not new_proj_id:
                    continue
                obj = DailyEntry(
                    project_id=new_proj_id,
                    entry_date=_d(e['entry_date']),
                    lot_number=e.get('lot_number'),
                    location=e.get('location'),
                    material=e.get('material'),
                    num_people=e.get('num_people'),
                    install_hours=e.get('install_hours') or 0,
                    install_sqm=e.get('install_sqm') or 0,
                    delay_hours=e.get('delay_hours') or 0,
                    delay_billable=bool(e.get('delay_billable', True)),
                    delay_reason=e.get('delay_reason'),
                    delay_description=e.get('delay_description'),
                    machines_stood_down=bool(e.get('machines_stood_down', False)),
                    notes=e.get('notes'),
                    other_work_description=e.get('other_work_description'),
                )
                db.session.add(obj)
                db.session.flush()
                entry_id_map[e['id']] = obj.id
            counts['entries'] = len(entry_id_map)

            # ── Entry ↔ Employee associations ──────────────────────────────
            assoc_e_count = 0
            for row in data.get('entry_employees', []):
                new_entry_id = entry_id_map.get(row[0])
                new_emp_id = emp_id_map.get(row[1])
                if new_entry_id and new_emp_id:
                    db.session.execute(
                        _text('INSERT INTO entry_employees (entry_id, employee_id) VALUES (:e, :m)'),
                        {'e': new_entry_id, 'm': new_emp_id}
                    )
                    assoc_e_count += 1
            counts['entry_employees'] = assoc_e_count

            # ── Entry ↔ Machine associations ───────────────────────────────
            assoc_m_count = 0
            for row in data.get('entry_machines', []):
                new_entry_id = entry_id_map.get(row[0])
                new_mach_id = mach_id_map.get(row[1])
                if new_entry_id and new_mach_id:
                    db.session.execute(
                        _text('INSERT INTO entry_machines (entry_id, machine_id) VALUES (:e, :m)'),
                        {'e': new_entry_id, 'm': new_mach_id}
                    )
                    assoc_m_count += 1
            counts['entry_machines'] = assoc_m_count

            # ── Hired Machines ─────────────────────────────────────────────
            hm_id_map = {}
            for h in data.get('hired_machine', []):
                new_proj_id = proj_id_map.get(h['project_id'])
                if not new_proj_id:
                    continue
                obj = HiredMachine(
                    project_id=new_proj_id,
                    machine_name=h['machine_name'],
                    machine_type=h.get('machine_type'),
                    hire_company=h.get('hire_company'),
                    hire_company_email=h.get('hire_company_email'),
                    hire_company_phone=h.get('hire_company_phone'),
                    delivery_date=_d(h.get('delivery_date')),
                    return_date=_d(h.get('return_date')),
                    cost_per_day=h.get('cost_per_day'),
                    cost_per_week=h.get('cost_per_week'),
                    count_saturdays=bool(h.get('count_saturdays', True)),
                    notes=h.get('notes'),
                    active=bool(h.get('active', True)),
                )
                db.session.add(obj)
                db.session.flush()
                hm_id_map[h['id']] = obj.id
            counts['hired_machines'] = len(hm_id_map)

            # ── Stand Downs ────────────────────────────────────────────────
            sd_count = 0
            for s in data.get('stand_down', []):
                new_hm_id = hm_id_map.get(s['hired_machine_id'])
                if not new_hm_id:
                    continue
                new_entry_id = entry_id_map.get(s.get('entry_id')) if s.get('entry_id') else None
                obj = StandDown(
                    hired_machine_id=new_hm_id,
                    entry_id=new_entry_id,
                    stand_down_date=_d(s['stand_down_date']),
                    reason=s.get('reason', ''),
                )
                db.session.add(obj)
                sd_count += 1
            counts['stand_downs'] = sd_count

            # ── Planned Data ───────────────────────────────────────────────
            pd_count = 0
            for p in data.get('planned_data', []):
                new_proj_id = proj_id_map.get(p['project_id'])
                if not new_proj_id:
                    continue
                obj = PlannedData(
                    project_id=new_proj_id,
                    lot=p.get('lot'),
                    location=p.get('location'),
                    material=p.get('material'),
                    day_number=p.get('day_number'),
                    planned_sqm=p.get('planned_sqm'),
                )
                db.session.add(obj)
                pd_count += 1
            counts['planned_data'] = pd_count

            # ── Project Non-Work Dates ─────────────────────────────────────
            nwd_count = 0
            for n in data.get('project_non_work_date', []):
                new_proj_id = proj_id_map.get(n['project_id'])
                if not new_proj_id:
                    continue
                db.session.add(ProjectNonWorkDate(
                    project_id=new_proj_id,
                    date=_d(n['date']),
                    reason=n.get('reason'),
                ))
                nwd_count += 1
            counts['non_work_dates'] = nwd_count

            # ── Project Budgeted Roles ─────────────────────────────────────
            br_count = 0
            for b in data.get('project_budgeted_role', []):
                new_proj_id = proj_id_map.get(b['project_id'])
                if not new_proj_id:
                    continue
                db.session.add(ProjectBudgetedRole(
                    project_id=new_proj_id,
                    role_name=b['role_name'],
                    budgeted_count=b.get('budgeted_count', 1),
                ))
                br_count += 1
            counts['budgeted_roles'] = br_count

            # ── Project Machines (own fleet) ───────────────────────────────
            pm_count = 0
            for p in data.get('project_machine', []):
                new_proj_id = proj_id_map.get(p['project_id'])
                new_mach_id = mach_id_map.get(p['machine_id'])
                if not new_proj_id or not new_mach_id:
                    continue
                db.session.add(ProjectMachine(
                    project_id=new_proj_id,
                    machine_id=new_mach_id,
                    assigned_date=_d(p.get('assigned_date')),
                    notes=p.get('notes'),
                ))
                pm_count += 1
            counts['project_machines'] = pm_count

            # ── Worked Sundays ─────────────────────────────────────────────
            ws_count = 0
            for w in data.get('project_worked_sunday', []):
                new_proj_id = proj_id_map.get(w['project_id'])
                if not new_proj_id:
                    continue
                db.session.add(ProjectWorkedSunday(
                    project_id=new_proj_id,
                    date=_d(w['date']),
                    reason=w.get('reason'),
                ))
                ws_count += 1
            counts['worked_sundays'] = ws_count

            db.session.commit()

            summary = ', '.join(f'{v} {k}' for k, v in counts.items() if v)
            flash(f'Import successful! {summary}. Note: uploaded photos/documents need to be re-uploaded manually.', 'success')

        except Exception as e:
            db.session.rollback()
            flash(f'Import failed: {e}', 'danger')

        return redirect(url_for('admin_import_data'))

    # GET — show the import page
    entry_count = DailyEntry.query.count()
    project_count = Project.query.count()
    return render_template('admin/import_data.html',
                           entry_count=entry_count,
                           project_count=project_count)


# ---------------------------------------------------------------------------
# Admin — Projects / Employees / Machines / Roles / Settings
# ---------------------------------------------------------------------------

@app.route('/admin/projects', methods=['GET', 'POST'])
def admin_projects():
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            name = request.form.get('name', '').strip()
            description = request.form.get('description', '').strip()
            if name:
                p = Project(name=name, description=description or None)
                start_str = request.form.get('start_date', '').strip()
                if start_str:
                    try:
                        p.start_date = datetime.strptime(start_str, '%Y-%m-%d').date()
                    except ValueError:
                        pass
                for attr, raw, cast in [
                    ('planned_crew', request.form.get('planned_crew', '').strip(), int),
                    ('hours_per_day', request.form.get('hours_per_day', '').strip(), float),
                    ('quoted_days', request.form.get('quoted_days', '').strip(), int),
                ]:
                    if raw:
                        try:
                            setattr(p, attr, cast(raw))
                        except ValueError:
                            pass
                db.session.add(p)
                db.session.commit()
                flash(f'Project "{name}" added.', 'success')
            else:
                flash('Project name is required.', 'danger')
        elif action == 'edit':
            project = Project.query.get_or_404(int(request.form.get('id')))
            project.name = request.form.get('name', '').strip()
            project.description = request.form.get('description', '').strip() or None
            start_str = request.form.get('start_date', '').strip()
            project.start_date = datetime.strptime(start_str, '%Y-%m-%d').date() if start_str else None
            planned_crew = request.form.get('planned_crew', '').strip()
            project.planned_crew = int(planned_crew) if planned_crew else None
            hours_per_day = request.form.get('hours_per_day', '').strip()
            project.hours_per_day = float(hours_per_day) if hours_per_day else None
            quoted_days = request.form.get('quoted_days', '').strip()
            project.quoted_days = int(quoted_days) if quoted_days else None
            db.session.commit()
            flash('Project updated.', 'success')
        elif action == 'toggle':
            project = Project.query.get_or_404(int(request.form.get('id')))
            project.active = not project.active
            db.session.commit()
            flash(f'Project "{project.name}" {"activated" if project.active else "deactivated"}.', 'info')
        elif action == 'delete':
            project = Project.query.get_or_404(int(request.form.get('id')))
            if project.entries:
                flash('Cannot delete — has existing entries. Deactivate instead.', 'danger')
            else:
                db.session.delete(project)
                db.session.commit()
                flash('Project deleted.', 'info')
        return redirect(url_for('admin_projects'))

    projects = Project.query.order_by(Project.name).all()
    return render_template('admin/projects.html', projects=projects)


@app.route('/admin/employees', methods=['GET', 'POST'])
def admin_employees():
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            name = request.form.get('name', '').strip()
            role_ids = request.form.getlist('role_ids')
            delay_rate_raw = request.form.get('delay_rate', '').strip()
            if name:
                emp = Employee(name=name)
                db.session.add(emp)
                db.session.flush()  # get emp.id before setting m2m
                if role_ids:
                    role_objs = Role.query.filter(Role.id.in_([int(r) for r in role_ids])).all()
                    emp.roles = role_objs
                    emp.role = ', '.join(r.name for r in sorted(role_objs, key=lambda r: r.name))
                    emp.role_id = role_objs[0].id if len(role_objs) == 1 else None
                    if delay_rate_raw:
                        emp.delay_rate = float(delay_rate_raw)
                    else:
                        rates = [r.delay_rate for r in role_objs if r.delay_rate]
                        emp.delay_rate = max(rates) if rates else None
                else:
                    emp.delay_rate = float(delay_rate_raw) if delay_rate_raw else None
                db.session.commit()
                flash(f'Employee "{name}" added.', 'success')
            else:
                flash('Name is required.', 'danger')
        elif action == 'edit':
            emp = Employee.query.get_or_404(int(request.form.get('id')))
            emp.name = request.form.get('name', '').strip()
            role_ids = request.form.getlist('role_ids')
            delay_rate_raw = request.form.get('delay_rate', '').strip()
            if role_ids:
                role_objs = Role.query.filter(Role.id.in_([int(r) for r in role_ids])).all()
                emp.roles = role_objs
                emp.role = ', '.join(r.name for r in sorted(role_objs, key=lambda r: r.name))
                emp.role_id = role_objs[0].id if len(role_objs) == 1 else None
                if delay_rate_raw:
                    emp.delay_rate = float(delay_rate_raw)
                else:
                    rates = [r.delay_rate for r in role_objs if r.delay_rate]
                    emp.delay_rate = max(rates) if rates else None
            else:
                emp.roles = []
                emp.role_id = None
                emp.role = None
                emp.delay_rate = float(delay_rate_raw) if delay_rate_raw else None
            db.session.commit()
            flash('Employee updated.', 'success')
        elif action == 'toggle':
            emp = Employee.query.get_or_404(int(request.form.get('id')))
            emp.active = not emp.active
            db.session.commit()
            flash(f'"{emp.name}" {"activated" if emp.active else "deactivated"}.', 'info')
        elif action == 'delete':
            emp = Employee.query.get_or_404(int(request.form.get('id')))
            if emp.entries:
                flash('Cannot delete — has entries. Deactivate instead.', 'danger')
            else:
                db.session.delete(emp)
                db.session.commit()
                flash('Employee deleted.', 'info')
        return redirect(url_for('admin_employees'))

    employees = Employee.query.order_by(Employee.name).all()
    roles = Role.query.order_by(Role.name).all()
    return render_template('admin/employees.html', employees=employees, roles=roles)


@app.route('/admin/machines', methods=['GET', 'POST'])
def admin_machines():
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            name = request.form.get('name', '').strip()
            machine_type = request.form.get('machine_type', '').strip()
            plant_id = request.form.get('plant_id', '').strip()
            description = request.form.get('description', '').strip()
            delay_rate = request.form.get('delay_rate', '').strip()
            if name:
                db.session.add(Machine(name=name, plant_id=plant_id or None,
                                       machine_type=machine_type or None,
                                       description=description or None,
                                       delay_rate=float(delay_rate) if delay_rate else None))
                db.session.commit()
                flash(f'Machine "{name}" added.', 'success')
            else:
                flash('Name is required.', 'danger')
        elif action == 'edit':
            machine = Machine.query.get_or_404(int(request.form.get('id')))
            machine.name = request.form.get('name', '').strip()
            machine.plant_id = request.form.get('plant_id', '').strip() or None
            machine.machine_type = request.form.get('machine_type', '').strip() or None
            machine.description = request.form.get('description', '').strip() or None
            delay_rate = request.form.get('delay_rate', '').strip()
            machine.delay_rate = float(delay_rate) if delay_rate else None
            db.session.commit()
            flash('Machine updated.', 'success')
        elif action == 'toggle':
            machine = Machine.query.get_or_404(int(request.form.get('id')))
            machine.active = not machine.active
            db.session.commit()
            flash(f'"{machine.name}" {"activated" if machine.active else "deactivated"}.', 'info')
        elif action == 'delete':
            machine = Machine.query.get_or_404(int(request.form.get('id')))
            if machine.entries:
                flash('Cannot delete — has entries. Deactivate instead.', 'danger')
            else:
                db.session.delete(machine)
                db.session.commit()
                flash('Machine deleted.', 'info')
        elif action == 'assign':
            machine_id = int(request.form.get('machine_id'))
            project_id = int(request.form.get('project_id'))
            if not ProjectMachine.query.filter_by(project_id=project_id, machine_id=machine_id).first():
                db.session.add(ProjectMachine(project_id=project_id, machine_id=machine_id))
                db.session.commit()
                flash('Machine assigned to project.', 'success')
            else:
                flash('Already assigned to that project.', 'warning')
        elif action == 'unassign':
            pm = ProjectMachine.query.get_or_404(int(request.form.get('pm_id')))
            db.session.delete(pm)
            db.session.commit()
            flash('Assignment removed.', 'info')
        return redirect(url_for('admin_machines'))

    machines = Machine.query.order_by(Machine.name).all()
    projects = Project.query.filter_by(active=True).order_by(Project.name).all()
    all_assignments = ProjectMachine.query.all()
    assignments_by_machine = {}
    for pm in all_assignments:
        assignments_by_machine.setdefault(pm.machine_id, []).append(pm)
    return render_template('admin/machines.html', machines=machines, projects=projects,
                           assignments_by_machine=assignments_by_machine)


@app.route('/admin/roles', methods=['GET', 'POST'])
def admin_roles():
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            name = request.form.get('name', '').strip()
            delay_rate = request.form.get('delay_rate', '').strip()
            if name:
                db.session.add(Role(name=name, delay_rate=float(delay_rate) if delay_rate else None))
                db.session.commit()
                flash(f'Role "{name}" added.', 'success')
            else:
                flash('Role name is required.', 'danger')
        elif action == 'edit':
            role = Role.query.get_or_404(int(request.form.get('id')))
            role.name = request.form.get('name', '').strip()
            delay_rate = request.form.get('delay_rate', '').strip()
            role.delay_rate = float(delay_rate) if delay_rate else None
            group_name = request.form.get('group_name', '').strip()
            role.group_name = group_name or None
            db.session.commit()
            flash('Role updated.', 'success')
        elif action == 'delete':
            role = Role.query.get_or_404(int(request.form.get('id')))
            if role.employees:
                flash('Cannot delete — employees assigned to this role. Reassign first.', 'danger')
            else:
                db.session.delete(role)
                db.session.commit()
                flash('Role deleted.', 'info')
        return redirect(url_for('admin_roles'))

    roles = Role.query.order_by(Role.name).all()
    return render_template('admin/roles.html', roles=roles)


@app.route('/admin/holidays', methods=['GET', 'POST'])
@login_required
def admin_holidays():
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            selected_states = request.form.getlist('states')
            date_str = request.form.get('date', '').strip()
            name = request.form.get('name', '').strip()
            if selected_states and date_str and name:
                try:
                    d = datetime.strptime(date_str, '%Y-%m-%d').date()
                    states_str = ','.join(selected_states)
                    db.session.add(PublicHoliday(state=states_str, states=states_str, date=d, name=name))
                    db.session.commit()
                    flash(f'Added: {name} ({states_str} — {d.strftime("%d/%m/%Y")}).', 'success')
                except ValueError:
                    flash('Invalid date.', 'danger')
            else:
                flash('Select at least one state, a date, and a name.', 'danger')
        elif action == 'delete':
            h = PublicHoliday.query.get(int(request.form.get('id', 0)))
            if h:
                db.session.delete(h)
                db.session.commit()
                flash('Holiday deleted.', 'success')
        return redirect(url_for('admin_holidays'))
    holidays = PublicHoliday.query.order_by(PublicHoliday.date).all()
    return render_template('admin/holidays.html', holidays=holidays, states=AUSTRALIAN_STATES)


@app.route('/admin/cfmeu', methods=['GET', 'POST'])
@login_required
def admin_cfmeu():
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            date_str = request.form.get('date', '').strip()
            name = request.form.get('name', '').strip()
            selected_states = request.form.getlist('states')
            if date_str and name and selected_states:
                try:
                    d = datetime.strptime(date_str, '%Y-%m-%d').date()
                    states_str = ','.join(selected_states)
                    db.session.add(CFMEUDate(state=states_str, states=states_str, date=d, name=name))
                    db.session.commit()
                    flash(f'Added: {name} ({states_str} — {d.strftime("%d/%m/%Y")}).', 'success')
                except ValueError:
                    flash('Invalid date.', 'danger')
            else:
                flash('Select at least one state, a date, and a name.', 'danger')
        elif action == 'delete':
            c = CFMEUDate.query.get(int(request.form.get('id', 0)))
            if c:
                db.session.delete(c)
                db.session.commit()
                flash('CFMEU date deleted.', 'success')
        return redirect(url_for('admin_cfmeu'))
    cfmeu_dates = CFMEUDate.query.order_by(CFMEUDate.date).all()
    return render_template('admin/cfmeu.html', cfmeu_dates=cfmeu_dates, states=AUSTRALIAN_STATES)


@app.route('/admin/backup/download')
@login_required
def admin_backup_download():
    """Download a database backup. Admin only."""
    if not current_user.is_admin:
        flash('Admin access required.', 'danger')
        return redirect(url_for('index'))

    db_url = app.config['SQLALCHEMY_DATABASE_URI']
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    if db_url.startswith('postgresql'):
        # Postgres — use pg_dump
        import subprocess, tempfile
        from urllib.parse import urlparse
        parsed = urlparse(db_url)
        env = os.environ.copy()
        env['PGPASSWORD'] = parsed.password or ''
        dump_file = os.path.join(tempfile.gettempdir(), f'plytrack_backup_{timestamp}.sql')
        cmd = [
            'pg_dump',
            '-h', parsed.hostname,
            '-p', str(parsed.port or 5432),
            '-U', parsed.username,
            '-d', parsed.path.lstrip('/'),
            '-f', dump_file,
            '--no-password',
        ]
        result = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if result.returncode != 0:
            flash(f'pg_dump failed: {result.stderr[:200]}', 'danger')
            return redirect(url_for('admin_settings'))
        return send_file(
            dump_file,
            as_attachment=True,
            download_name=f'plytrack_backup_{timestamp}.sql',
            mimetype='application/sql',
        )
    else:
        # SQLite — send the .db file directly
        db_path = db_url.replace('sqlite:///', '')
        if not os.path.isabs(db_path):
            db_path = os.path.join(os.path.dirname(__file__), 'instance', 'tracking.db')
        if not os.path.exists(db_path):
            flash('Database file not found.', 'danger')
            return redirect(url_for('admin_settings'))
        return send_file(
            db_path,
            as_attachment=True,
            download_name=f'plytrack_backup_{timestamp}.db',
            mimetype='application/octet-stream',
        )


@app.route('/admin/settings', methods=['GET', 'POST'])
def admin_settings():
    settings = load_settings()
    if request.method == 'POST':
        settings['company_name'] = request.form.get('company_name', '').strip()
        settings['smtp_server'] = request.form.get('smtp_server', '').strip()
        settings['smtp_port'] = int(request.form.get('smtp_port') or 587)
        settings['smtp_username'] = request.form.get('smtp_username', '').strip()
        new_pw = request.form.get('smtp_password', '').strip()
        if new_pw:
            settings['smtp_password'] = new_pw
        settings['from_name'] = request.form.get('from_name', '').strip()
        settings['from_email'] = request.form.get('from_email', '').strip()
        save_settings(settings)
        flash('Settings saved.', 'success')
        return redirect(url_for('admin_settings'))
    return render_template('admin/settings.html', settings=settings)


# ---------------------------------------------------------------------------
# Delay Report — preview, PDF, email
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# utils/ re-exports — keeps existing routes working during refactor
# ---------------------------------------------------------------------------
from utils.files import safe, allowed_file, allowed_photo, allowed_doc
from utils.settings import load_settings, save_settings
from utils.helpers import _natural_key
from utils.reports import (generate_pdf, generate_delay_pdf,
                            generate_project_report_pdf,
                            generate_weekly_report_pdf)
from utils.gantt import compute_gantt_data
from utils.progress import (compute_project_progress,
                             compute_delay_summary, build_delay_report)
from utils.schedule import build_schedule_grid, build_day_summary


if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
