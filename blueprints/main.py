from datetime import date

from flask import Blueprint, render_template

from models import DailyEntry, Project, HiredMachine

main_bp = Blueprint('main', __name__)


@main_bp.route('/')
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
