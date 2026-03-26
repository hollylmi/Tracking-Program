import os
import uuid
from datetime import date, datetime, timedelta

from flask import Blueprint, render_template, request, redirect, url_for, flash, Response
from flask_login import current_user
from werkzeug.utils import secure_filename

from blueprints.auth import require_role
from utils.helpers import get_active_project_id
from models import db, Project, HiredMachine, StandDown, HireCompany, HireReview
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
@require_role('admin', 'supervisor', 'site')
def hire_list():
    project_filter = request.args.get('project_id', '')
    query = HiredMachine.query.filter_by(active=True).order_by(HiredMachine.created_at.desc())
    if current_user.role != 'admin':
        active_pid = get_active_project_id()
        if active_pid:
            query = query.filter_by(project_id=active_pid)
            project_filter = str(active_pid)
        else:
            hired = []
            projects = Project.query.order_by(Project.name).all()
            return render_template('hire/list.html', hired=hired, projects=projects,
                                   project_filter=project_filter)
    elif project_filter:
        query = query.filter_by(project_id=int(project_filter))
    hired = query.all()
    projects = Project.query.order_by(Project.name).all()
    return render_template('hire/list.html', hired=hired, projects=projects,
                           project_filter=project_filter)


@hire_bp.route('/hire/new', methods=['GET', 'POST'])
@require_role('admin')
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
            delay_rate=float(request.form.get('delay_rate')) if request.form.get('delay_rate') else None,
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
@require_role('admin', 'supervisor', 'site')
def hire_detail(hm_id):
    hm = HiredMachine.query.get_or_404(hm_id)
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    return render_template('hire/detail.html', hm=hm, week_start=week_start, week_end=week_end)


@hire_bp.route('/hire/<int:hm_id>/edit', methods=['GET', 'POST'])
@require_role('admin')
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
        hm.delay_rate = float(request.form.get('delay_rate')) if request.form.get('delay_rate') else None
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
@require_role('admin')
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
@require_role('admin', 'supervisor')
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
@require_role('admin', 'supervisor')
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
@require_role('admin', 'supervisor')
def standdown_delete(hm_id, sd_id):
    sd = StandDown.query.get_or_404(sd_id)
    db.session.delete(sd)
    db.session.commit()
    flash('Stand-down removed.', 'info')
    return redirect(url_for('hire.hire_detail', hm_id=hm_id))


@hire_bp.route('/hire/<int:hm_id>/report')
@require_role('admin', 'supervisor')
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
@require_role('admin', 'supervisor')
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


# ---------------------------------------------------------------------------
# Return / deactivate hired machine
# ---------------------------------------------------------------------------

@hire_bp.route('/hire/<int:hm_id>/return', methods=['POST'])
@require_role('admin', 'supervisor')
def hire_return(hm_id):
    hm = HiredMachine.query.get_or_404(hm_id)
    hm.active = False
    if not hm.return_date:
        hm.return_date = date.today()

    # Auto-create the hire company if it doesn't exist
    company = None
    if hm.hire_company:
        company = HireCompany.query.filter_by(name=hm.hire_company).first()
        if not company:
            company = HireCompany(
                name=hm.hire_company,
                phone=hm.hire_company_phone,
                email=hm.hire_company_email,
            )
            db.session.add(company)
            db.session.flush()

    # Auto-create a draft review linked to this machine
    if company:
        existing_review = HireReview.query.filter_by(
            company_id=company.id, hired_machine_id=hm.id).first()
        if not existing_review:
            db.session.add(HireReview(
                company_id=company.id,
                hired_machine_id=hm.id,
                machine_description=f"{hm.machine_name} ({hm.plant_id})" if hm.plant_id else hm.machine_name,
                weekly_rate=hm.cost_per_week,
            ))

    db.session.commit()
    flash(f'"{hm.machine_name}" marked as returned ({hm.return_date.strftime("%d/%m/%Y")}).', 'success')

    # Redirect to the company page so user can complete the review
    if company:
        flash(f'A review has been created for {hm.machine_name} — please add your ratings.', 'info')
        return redirect(url_for('hire.hire_company_detail', company_id=company.id))

    return redirect(url_for('hire.hire_list'))


@hire_bp.route('/hire/<int:hm_id>/reactivate', methods=['POST'])
@require_role('admin', 'supervisor')
def hire_reactivate(hm_id):
    hm = HiredMachine.query.get_or_404(hm_id)
    hm.active = True
    hm.return_date = None
    db.session.commit()
    flash(f'"{hm.machine_name}" reactivated.', 'success')
    return redirect(url_for('hire.hire_detail', hm_id=hm_id))


# ---------------------------------------------------------------------------
# Hire Companies database
# ---------------------------------------------------------------------------

@hire_bp.route('/hire/companies')
@require_role('admin', 'supervisor')
def hire_companies():
    companies = HireCompany.query.order_by(HireCompany.name).all()

    # Build average rates by machine type per company
    company_rates = {}
    for c in companies:
        machines = HiredMachine.query.filter_by(hire_company=c.name).all()
        type_data = {}
        for hm in machines:
            mtype = hm.machine_type or hm.machine_name or 'Other'
            if mtype not in type_data:
                type_data[mtype] = {'total_rate': 0, 'count': 0}
            if hm.cost_per_week:
                type_data[mtype]['total_rate'] += hm.cost_per_week
                type_data[mtype]['count'] += 1
        avg_rates = []
        for mtype, data in sorted(type_data.items()):
            if data['count'] > 0:
                avg = round(data['total_rate'] / data['count'], 0)
                avg_rates.append({'type': mtype, 'avg_weekly': avg, 'count': data['count']})
        company_rates[c.id] = avg_rates

    return render_template('hire/companies.html', companies=companies,
                           company_rates=company_rates)


@hire_bp.route('/hire/companies/add', methods=['POST'])
@require_role('admin', 'supervisor')
def hire_company_add():
    name = request.form.get('name', '').strip()
    if not name:
        flash('Company name is required.', 'danger')
        return redirect(url_for('hire.hire_companies'))
    existing = HireCompany.query.filter_by(name=name).first()
    if existing:
        flash(f'"{name}" already exists.', 'warning')
        return redirect(url_for('hire.hire_companies'))
    company = HireCompany(
        name=name,
        phone=request.form.get('phone', '').strip() or None,
        email=request.form.get('email', '').strip() or None,
        notes=request.form.get('notes', '').strip() or None,
    )
    db.session.add(company)
    db.session.commit()
    flash(f'Company "{name}" added.', 'success')
    return redirect(url_for('hire.hire_companies'))


@hire_bp.route('/hire/companies/<int:company_id>')
@require_role('admin', 'supervisor')
def hire_company_detail(company_id):
    company = HireCompany.query.get_or_404(company_id)
    # Get all hired machines associated with this company name
    hired_history = HiredMachine.query.filter_by(hire_company=company.name).order_by(HiredMachine.delivery_date.desc()).all()
    return render_template('hire/company_detail.html', company=company, hired_history=hired_history)


@hire_bp.route('/hire/companies/<int:company_id>/review', methods=['POST'])
@require_role('admin', 'supervisor')
def hire_review_add(company_id):
    company = HireCompany.query.get_or_404(company_id)
    review = HireReview(
        company_id=company.id,
        hired_machine_id=request.form.get('hired_machine_id', type=int) or None,
        machine_description=request.form.get('machine_description', '').strip() or None,
        weekly_rate=float(request.form.get('weekly_rate')) if request.form.get('weekly_rate') else None,
        rating_standdown=int(request.form.get('rating_standdown')) if request.form.get('rating_standdown') else None,
        rating_communication=int(request.form.get('rating_communication')) if request.form.get('rating_communication') else None,
        rating_delivery=int(request.form.get('rating_delivery')) if request.form.get('rating_delivery') else None,
        comments=request.form.get('comments', '').strip() or None,
    )
    db.session.add(review)
    db.session.commit()
    flash('Review added.', 'success')
    return redirect(url_for('hire.hire_company_detail', company_id=company.id))


@hire_bp.route('/hire/companies/<int:company_id>/edit', methods=['POST'])
@require_role('admin', 'supervisor')
def hire_company_edit(company_id):
    company = HireCompany.query.get_or_404(company_id)
    company.name = request.form.get('name', '').strip() or company.name
    company.phone = request.form.get('phone', '').strip() or None
    company.email = request.form.get('email', '').strip() or None
    company.notes = request.form.get('notes', '').strip() or None
    db.session.commit()
    flash(f'Company "{company.name}" updated.', 'success')
    return redirect(url_for('hire.hire_company_detail', company_id=company.id))


@hire_bp.route('/hire/companies/<int:company_id>/delete', methods=['POST'])
@require_role('admin')
def hire_company_delete(company_id):
    company = HireCompany.query.get_or_404(company_id)
    db.session.delete(company)
    db.session.commit()
    flash(f'Company "{company.name}" deleted.', 'success')
    return redirect(url_for('hire.hire_companies'))


@hire_bp.route('/hire/reviews/<int:review_id>/edit', methods=['POST'])
@require_role('admin', 'supervisor')
def hire_review_edit(review_id):
    review = HireReview.query.get_or_404(review_id)
    review.machine_description = request.form.get('machine_description', '').strip() or review.machine_description
    review.weekly_rate = float(request.form.get('weekly_rate')) if request.form.get('weekly_rate') else review.weekly_rate
    review.rating_delivery = int(request.form.get('rating_delivery')) if request.form.get('rating_delivery') else review.rating_delivery
    review.rating_communication = int(request.form.get('rating_communication')) if request.form.get('rating_communication') else review.rating_communication
    review.rating_standdown = int(request.form.get('rating_standdown')) if request.form.get('rating_standdown') else review.rating_standdown
    review.comments = request.form.get('comments', '').strip() or review.comments
    db.session.commit()
    flash('Review updated.', 'success')
    return redirect(url_for('hire.hire_company_detail', company_id=review.company_id))


@hire_bp.route('/hire/reviews/<int:review_id>/delete', methods=['POST'])
@require_role('admin')
def hire_review_delete(review_id):
    review = HireReview.query.get_or_404(review_id)
    company_id = review.company_id
    db.session.delete(review)
    db.session.commit()
    flash('Review deleted.', 'success')
    return redirect(url_for('hire.hire_company_detail', company_id=company_id))
