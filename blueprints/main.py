from datetime import date

from flask import Blueprint, render_template

from blueprints.auth import require_role
from models import DailyEntry, Project, HiredMachine
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
    projects = Project.query.filter_by(active=True).order_by(Project.name).all()
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

    return render_template('index.html', recent_entries=recent_entries,
                           total_entries=total_entries, entries_today=entries_today,
                           active_projects=len(projects), active_hired=active_hired,
                           project_data=project_data, today=today)
