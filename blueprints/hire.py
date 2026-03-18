import os
import uuid
from datetime import date, datetime, timedelta

from flask import Blueprint, render_template, request, redirect, url_for, flash, Response
from werkzeug.utils import secure_filename

from models import db, Project, HiredMachine, StandDown
import storage
from utils.files import allowed_file
from utils.settings import load_settings
from utils.schedule import build_day_summary
from utils.reports import generate_pdf

hire_bp = Blueprint('hire', __name__)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'instance', 'uploads')


# ---------------------------------------------------------------------------
# Hired machines
# ---------------------------------------------------------------------------

@hire_bp.route('/hire')
def hire_list():
    project_filter = request.args.get('project_id', '')
    query = HiredMachine.query.order_by(HiredMachine.created_at.desc())
    if project_filter:
        query = query.filter_by(project_id=int(project_filter))
    hired = query.all()
    projects = Project.query.order_by(Project.name).all()
    return render_template('hire/list.html', hired=hired, projects=projects,
                           project_filter=project_filter)


@hire_bp.route('/hire/new', methods=['GET', 'POST'])
def hire_new():
    projects = Project.query.filter_by(active=True).order_by(Project.name).all()

    if request.method == 'POST':
        project_id = request.form.get('project_id')
        machine_name = request.form.get('machine_name', '').strip()
        if not project_id or not machine_name:
            flash('Project and machine name are required.', 'danger')
            return render_template('hire/form.html', projects=projects)

        hm = HiredMachine(
            project_id=int(project_id),
            machine_name=machine_name,
            plant_id=request.form.get('plant_id', '').strip() or None,
            machine_type=request.form.get('machine_type', '').strip() or None,
            description=request.form.get('description', '').strip() or None,
            hire_company=request.form.get('hire_company', '').strip() or None,
            hire_company_email=request.form.get('hire_company_email', '').strip() or None,
            hire_company_phone=request.form.get('hire_company_phone', '').strip() or None,
            cost_per_week=float(request.form.get('cost_per_week')) if request.form.get('cost_per_week') else None,
            count_saturdays='count_saturdays' in request.form,
            notes=request.form.get('notes', '').strip() or None,
        )
        delivery_str = request.form.get('delivery_date', '').strip()
        if delivery_str:
            try:
                hm.delivery_date = datetime.strptime(delivery_str, '%Y-%m-%d').date()
            except ValueError:
                pass
        return_str = request.form.get('return_date', '').strip()
        if return_str:
            try:
                hm.return_date = datetime.strptime(return_str, '%Y-%m-%d').date()
            except ValueError:
                pass
        file = request.files.get('invoice_file')
        if file and file.filename and allowed_file(file.filename):
            ext = file.filename.rsplit('.', 1)[1].lower()
            stored_name = f"{uuid.uuid4().hex}.{ext}"
            local_path = os.path.join(UPLOAD_FOLDER, stored_name)
            storage.upload_file(file, f'invoices/{stored_name}', local_path)
            hm.invoice_filename = stored_name
            hm.invoice_original_name = secure_filename(file.filename)
        db.session.add(hm)
        db.session.commit()
        flash(f'Hired machine "{machine_name}" added.', 'success')
        return redirect(url_for('hire.hire_detail', hm_id=hm.id))

    return render_template('hire/form.html', projects=projects)


@hire_bp.route('/hire/<int:hm_id>')
def hire_detail(hm_id):
    hm = HiredMachine.query.get_or_404(hm_id)
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    return render_template('hire/detail.html', hm=hm, week_start=week_start, week_end=week_end)


@hire_bp.route('/hire/<int:hm_id>/edit', methods=['GET', 'POST'])
def hire_edit(hm_id):
    hm = HiredMachine.query.get_or_404(hm_id)
    projects = Project.query.filter_by(active=True).order_by(Project.name).all()
    if request.method == 'POST':
        hm.project_id = int(request.form.get('project_id'))
        hm.machine_name = request.form.get('machine_name', '').strip()
        hm.plant_id = request.form.get('plant_id', '').strip() or None
        hm.machine_type = request.form.get('machine_type', '').strip() or None
        hm.description = request.form.get('description', '').strip() or None
        hm.hire_company = request.form.get('hire_company', '').strip() or None
        hm.hire_company_email = request.form.get('hire_company_email', '').strip() or None
        hm.hire_company_phone = request.form.get('hire_company_phone', '').strip() or None
        hm.notes = request.form.get('notes', '').strip() or None
        hm.cost_per_week = float(request.form.get('cost_per_week')) if request.form.get('cost_per_week') else None
        hm.count_saturdays = 'count_saturdays' in request.form
        delivery_str = request.form.get('delivery_date', '').strip()
        hm.delivery_date = datetime.strptime(delivery_str, '%Y-%m-%d').date() if delivery_str else None
        return_str = request.form.get('return_date', '').strip()
        hm.return_date = datetime.strptime(return_str, '%Y-%m-%d').date() if return_str else None
        file = request.files.get('invoice_file')
        if file and file.filename and allowed_file(file.filename):
            if hm.invoice_filename:
                storage.delete_file(f'invoices/{hm.invoice_filename}',
                                    os.path.join(UPLOAD_FOLDER, hm.invoice_filename))
            ext = file.filename.rsplit('.', 1)[1].lower()
            stored_name = f"{uuid.uuid4().hex}.{ext}"
            local_path = os.path.join(UPLOAD_FOLDER, stored_name)
            storage.upload_file(file, f'invoices/{stored_name}', local_path)
            hm.invoice_filename = stored_name
            hm.invoice_original_name = secure_filename(file.filename)
        db.session.commit()
        flash('Machine hire record updated.', 'success')
        return redirect(url_for('hire.hire_detail', hm_id=hm.id))
    return render_template('hire/form.html', hm=hm, projects=projects)


@hire_bp.route('/hire/<int:hm_id>/delete', methods=['POST'])
def hire_delete(hm_id):
    hm = HiredMachine.query.get_or_404(hm_id)
    if hm.invoice_filename:
        storage.delete_file(f'invoices/{hm.invoice_filename}',
                            os.path.join(UPLOAD_FOLDER, hm.invoice_filename))
    db.session.delete(hm)
    db.session.commit()
    flash('Hire record deleted.', 'info')
    return redirect(url_for('hire.hire_list'))


@hire_bp.route('/hire/<int:hm_id>/invoice')
def hire_invoice(hm_id):
    hm = HiredMachine.query.get_or_404(hm_id)
    if not hm.invoice_filename:
        flash('No file attached.', 'warning')
        return redirect(url_for('hire.hire_detail', hm_id=hm_id))
    return storage.serve_file(f'invoices/{hm.invoice_filename}',
                              os.path.join(UPLOAD_FOLDER, hm.invoice_filename),
                              download_name=hm.invoice_original_name,
                              as_attachment=False)


@hire_bp.route('/hire/<int:hm_id>/standdown/add', methods=['POST'])
def standdown_add(hm_id):
    hm = HiredMachine.query.get_or_404(hm_id)
    date_str = request.form.get('stand_down_date', '').strip()
    reason = request.form.get('reason', '').strip()
    if not date_str or not reason:
        flash('Date and reason are required.', 'danger')
        return redirect(url_for('hire.hire_detail', hm_id=hm_id))
    try:
        sd_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        flash('Invalid date.', 'danger')
        return redirect(url_for('hire.hire_detail', hm_id=hm_id))
    existing = StandDown.query.filter_by(hired_machine_id=hm_id, stand_down_date=sd_date).first()
    if existing:
        flash(f'{sd_date.strftime("%d/%m/%Y")} is already recorded as a stand-down.', 'warning')
        return redirect(url_for('hire.hire_detail', hm_id=hm_id))
    db.session.add(StandDown(hired_machine_id=hm_id, stand_down_date=sd_date, reason=reason))
    db.session.commit()
    flash(f'Stand-down recorded for {sd_date.strftime("%d/%m/%Y")}.', 'success')
    return redirect(url_for('hire.hire_detail', hm_id=hm_id))


@hire_bp.route('/hire/<int:hm_id>/standdown/<int:sd_id>/delete', methods=['POST'])
def standdown_delete(hm_id, sd_id):
    sd = StandDown.query.get_or_404(sd_id)
    db.session.delete(sd)
    db.session.commit()
    flash('Stand-down removed.', 'info')
    return redirect(url_for('hire.hire_detail', hm_id=hm_id))


@hire_bp.route('/hire/<int:hm_id>/report')
def hire_report(hm_id):
    hm = HiredMachine.query.get_or_404(hm_id)
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    date_from_str = request.args.get('date_from', week_start.strftime('%Y-%m-%d'))
    date_to_str = request.args.get('date_to', week_end.strftime('%Y-%m-%d'))
    try:
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
    except ValueError:
        date_from, date_to = week_start, week_end
    days, summary = build_day_summary(hm, date_from, date_to)
    settings = load_settings()
    return render_template('hire/report.html', hm=hm, days=days, summary=summary,
                           date_from=date_from, date_to=date_to,
                           date_from_str=date_from_str, date_to_str=date_to_str,
                           settings=settings, timedelta=timedelta)


@hire_bp.route('/hire/<int:hm_id>/report/pdf')
def hire_report_pdf(hm_id):
    hm = HiredMachine.query.get_or_404(hm_id)
    date_from_str = request.args.get('date_from')
    date_to_str = request.args.get('date_to')
    try:
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        today = date.today()
        date_from = today - timedelta(days=today.weekday())
        date_to = date_from + timedelta(days=6)
    days, summary = build_day_summary(hm, date_from, date_to)
    settings = load_settings()
    pdf_bytes = generate_pdf(hm, date_from, date_to, days, summary, settings)
    filename = f"standdown_{hm.machine_name.replace(' ', '_')}_{date_from_str}_to_{date_to_str}.pdf"
    return Response(pdf_bytes, mimetype='application/pdf',
                    headers={'Content-Disposition': f'attachment; filename="{filename}"'})
