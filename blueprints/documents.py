import os
import uuid

from flask import Blueprint, request, redirect, url_for, flash
from werkzeug.utils import secure_filename

from models import db, Project, ProjectDocument
import storage
from utils.files import allowed_doc

documents_bp = Blueprint('documents', __name__)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'instance', 'uploads')


@documents_bp.route('/project/<int:project_id>/documents/upload', methods=['POST'])
def project_document_upload(project_id):
    Project.query.get_or_404(project_id)
    f = request.files.get('document')
    if not f or not f.filename:
        flash('No file selected.', 'danger')
        return redirect(url_for('project_dashboard', project_id=project_id))
    if not allowed_doc(f.filename):
        flash('File type not allowed. Accepted: pdf, png, jpg, jpeg, dwg, dxf, doc, docx, xls, xlsx', 'danger')
        return redirect(url_for('project_dashboard', project_id=project_id))
    doc_type = request.form.get('doc_type', 'other').strip()
    if doc_type not in ('drawing', 'specification', 'other'):
        doc_type = 'other'
    ext = f.filename.rsplit('.', 1)[1].lower()
    stored_name = f"doc_{uuid.uuid4().hex}.{ext}"
    proj_upload_dir = os.path.join(UPLOAD_FOLDER, 'projects', str(project_id))
    storage.upload_file(f, f'docs/{stored_name}', os.path.join(proj_upload_dir, stored_name))
    db.session.add(ProjectDocument(
        project_id=project_id,
        filename=stored_name,
        original_name=secure_filename(f.filename),
        doc_type=doc_type,
    ))
    db.session.commit()
    flash(f'Document "{f.filename}" uploaded.', 'success')
    return redirect(url_for('project_dashboard', project_id=project_id))


@documents_bp.route('/project/<int:project_id>/documents/<int:doc_id>/download')
def project_document_download(project_id, doc_id):
    doc = ProjectDocument.query.get_or_404(doc_id)
    if doc.project_id != project_id:
        flash('Document not found.', 'danger')
        return redirect(url_for('project_dashboard', project_id=project_id))
    proj_upload_dir = os.path.join(UPLOAD_FOLDER, 'projects', str(project_id))
    return storage.serve_file(f'docs/{doc.filename}', os.path.join(proj_upload_dir, doc.filename),
                              as_attachment=True, download_name=doc.original_name or doc.filename)


@documents_bp.route('/project/<int:project_id>/documents/<int:doc_id>/delete', methods=['POST'])
def project_document_delete(project_id, doc_id):
    doc = ProjectDocument.query.get_or_404(doc_id)
    if doc.project_id != project_id:
        flash('Document not found.', 'danger')
        return redirect(url_for('project_dashboard', project_id=project_id))
    proj_upload_dir = os.path.join(UPLOAD_FOLDER, 'projects', str(project_id))
    storage.delete_file(f'docs/{doc.filename}', os.path.join(proj_upload_dir, doc.filename))
    db.session.delete(doc)
    db.session.commit()
    flash('Document deleted.', 'info')
    return redirect(url_for('project_dashboard', project_id=project_id))
