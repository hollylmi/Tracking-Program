from datetime import date, datetime, timedelta

from flask import Blueprint, render_template, request, Response

from blueprints.auth import require_role
from models import Project
from utils.progress import build_delay_report
from utils.reports import generate_delay_pdf
from utils.settings import load_settings

delays_bp = Blueprint('delays', __name__)


@delays_bp.route('/delay-report')
@require_role('admin', 'supervisor')
def delay_report():
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)

    date_from_str = request.args.get('date_from', week_start.strftime('%Y-%m-%d'))
    date_to_str = request.args.get('date_to', week_end.strftime('%Y-%m-%d'))
    project_id = request.args.get('project_id', '')
    billable_filter = request.args.get('billable', 'all')

    try:
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
    except ValueError:
        date_from, date_to = week_start, week_end

    rows, summary = build_delay_report(project_id, date_from, date_to, billable_filter)
    projects = Project.query.order_by(Project.name).all()
    settings = load_settings()

    project_name = ''
    if project_id:
        p = Project.query.get(int(project_id))
        project_name = p.name if p else ''

    return render_template('delay_report.html',
                           rows=rows, summary=summary,
                           date_from=date_from, date_to=date_to,
                           date_from_str=date_from_str, date_to_str=date_to_str,
                           project_id=project_id, project_name=project_name,
                           projects=projects, settings=settings,
                           billable_filter=billable_filter)


@delays_bp.route('/delay-report/pdf')
@require_role('admin', 'supervisor')
def delay_report_pdf():
    date_from_str = request.args.get('date_from')
    date_to_str = request.args.get('date_to')
    project_id = request.args.get('project_id', '')
    billable_filter = request.args.get('billable', 'all')

    try:
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        today = date.today()
        date_from = today - timedelta(days=today.weekday())
        date_to = date_from + timedelta(days=6)

    rows, summary = build_delay_report(project_id, date_from, date_to, billable_filter)
    settings = load_settings()

    project_name = ''
    if project_id:
        p = Project.query.get(int(project_id))
        project_name = p.name if p else ''

    pdf_bytes = generate_delay_pdf(rows, summary, date_from, date_to, project_name, settings)
    filename = f"delay_report_{date_from_str}_to_{date_to_str}.pdf"
    return Response(pdf_bytes, mimetype='application/pdf',
                    headers={'Content-Disposition': f'attachment; filename="{filename}"'})
