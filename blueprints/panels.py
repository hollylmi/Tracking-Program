import os
import json
import uuid
import tempfile
from datetime import datetime

from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_login import current_user
from werkzeug.utils import secure_filename

from blueprints.auth import require_role
from utils.helpers import get_active_project_id
from models import db, Project, Employee, DiagramLayer, PanelInstallRecord
import storage

try:
    from dxf_to_svg import dxf_to_svg as _dxf_to_svg
    _DXF_AVAILABLE = True
except ImportError:
    _DXF_AVAILABLE = False

try:
    import fitz as _fitz          # PyMuPDF — PDF → image
    _PYMUPDF_AVAILABLE = True
except ImportError:
    _PYMUPDF_AVAILABLE = False

try:
    import cv2 as _cv2
    import numpy as _np
    _CV2_AVAILABLE = True
except ImportError:
    _CV2_AVAILABLE = False

panels_bp = Blueprint('panels', __name__)

SVG_FOLDER = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'instance', 'uploads', 'panels')


# ---------------------------------------------------------------------------
# Panel diagram routes
# ---------------------------------------------------------------------------

@panels_bp.route('/project/<int:project_id>/panels')
@require_role('admin', 'supervisor', 'site')
def panel_overview(project_id):
    if current_user.role != 'admin':
        active_pid = get_active_project_id()
        if active_pid != project_id:
            flash('You do not have access to this project.', 'danger')
            return redirect(url_for('main.index'))
    project = Project.query.get_or_404(project_id)
    layers = (DiagramLayer.query
              .filter_by(project_id=project_id)
              .order_by(DiagramLayer.sort_order, DiagramLayer.layer_name)
              .all())
    return render_template('panels/overview.html', project=project, layers=layers)


@panels_bp.route('/project/<int:project_id>/panels/layer/add', methods=['POST'])
@require_role('admin')
def panel_layer_add(project_id):
    project = Project.query.get_or_404(project_id)
    layer_name = request.form.get('layer_name', '').strip()
    description = request.form.get('description', '').strip() or None
    sort_order = int(request.form.get('sort_order', 0) or 0)
    if not layer_name:
        flash('Layer name is required.', 'warning')
        return redirect(url_for('panels.panel_overview', project_id=project_id))
    layer = DiagramLayer(
        project_id=project_id,
        layer_name=layer_name,
        description=description,
        sort_order=sort_order,
    )
    svg_file = request.files.get('svg_file')
    if svg_file and svg_file.filename:
        os.makedirs(SVG_FOLDER, exist_ok=True)
        ext = svg_file.filename.rsplit('.', 1)[-1].lower()
        if ext == 'dxf':
            if not _DXF_AVAILABLE:
                flash('DXF support not installed. Run: pip install ezdxf', 'danger')
                return redirect(url_for('panels.panel_overview', project_id=project_id))
            with tempfile.NamedTemporaryFile(suffix='.dxf', delete=False) as tmp:
                svg_file.save(tmp.name)
                tmp_path = tmp.name
            try:
                svg_content = _dxf_to_svg(tmp_path)
            except Exception as exc:
                os.unlink(tmp_path)
                db.session.add(layer)
                db.session.commit()
                flash(f'Layer added but DXF conversion failed: {exc}', 'warning')
                return redirect(url_for('panels.panel_overview', project_id=project_id))
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
            stored_name = f'{uuid.uuid4().hex}.svg'
            storage.upload_text(svg_content, f'panels/{stored_name}', os.path.join(SVG_FOLDER, stored_name))
            layer.svg_filename = stored_name
            layer.svg_original_name = secure_filename(svg_file.filename).replace('.dxf', '.svg')
        elif ext == 'svg':
            stored_name = f'{uuid.uuid4().hex}.svg'
            storage.upload_file(svg_file, f'panels/{stored_name}', os.path.join(SVG_FOLDER, stored_name))
            layer.svg_filename = stored_name
            layer.svg_original_name = secure_filename(svg_file.filename)
        else:
            flash('Only SVG or DXF files are accepted for diagrams.', 'warning')
            return redirect(url_for('panels.panel_overview', project_id=project_id))
    db.session.add(layer)
    db.session.commit()
    flash(f'Layer "{layer_name}" added.', 'success')
    return redirect(url_for('panels.panel_overview', project_id=project_id))


@panels_bp.route('/project/<int:project_id>/panels/layer/<int:layer_id>/upload-svg', methods=['POST'])
@require_role('admin')
def panel_layer_upload_svg(project_id, layer_id):
    layer = DiagramLayer.query.get_or_404(layer_id)
    if layer.project_id != project_id:
        return 'Not found', 404
    svg_file = request.files.get('svg_file')
    if not svg_file or not svg_file.filename:
        flash('No file selected.', 'warning')
        return redirect(url_for('panels.panel_overview', project_id=project_id))
    ext = svg_file.filename.rsplit('.', 1)[-1].lower()
    if ext != 'svg':
        flash('Only SVG files are accepted.', 'warning')
        return redirect(url_for('panels.panel_overview', project_id=project_id))
    os.makedirs(SVG_FOLDER, exist_ok=True)
    if layer.svg_filename:
        storage.delete_file(f'panels/{layer.svg_filename}', os.path.join(SVG_FOLDER, layer.svg_filename))
    stored_name = f'{uuid.uuid4().hex}.svg'
    storage.upload_file(svg_file, f'panels/{stored_name}', os.path.join(SVG_FOLDER, stored_name))
    layer.svg_filename = stored_name
    layer.svg_original_name = secure_filename(svg_file.filename)
    db.session.commit()
    flash('SVG diagram uploaded.', 'success')
    return redirect(url_for('panels.panel_layer_view', project_id=project_id, layer_id=layer_id))


@panels_bp.route('/project/<int:project_id>/panels/layer/<int:layer_id>/upload-dxf', methods=['POST'])
@require_role('admin')
def panel_layer_upload_dxf(project_id, layer_id):
    """Accept a DXF file, convert it to SVG with panel IDs, and save it."""
    if not _DXF_AVAILABLE:
        flash('DXF support is not installed. Run: pip install ezdxf', 'danger')
        return redirect(url_for('panels.panel_overview', project_id=project_id))
    layer = DiagramLayer.query.get_or_404(layer_id)
    if layer.project_id != project_id:
        return 'Not found', 404
    dxf_file = request.files.get('dxf_file')
    if not dxf_file or not dxf_file.filename:
        flash('No DXF file selected.', 'warning')
        return redirect(url_for('panels.panel_layer_view', project_id=project_id, layer_id=layer_id))
    ext = dxf_file.filename.rsplit('.', 1)[-1].lower()
    if ext != 'dxf':
        flash('Only DXF files are accepted here.', 'warning')
        return redirect(url_for('panels.panel_layer_view', project_id=project_id, layer_id=layer_id))
    # Save the DXF to a temp path, convert, then discard
    os.makedirs(SVG_FOLDER, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix='.dxf', delete=False) as tmp:
        dxf_file.save(tmp.name)
        tmp_path = tmp.name
    try:
        svg_content = _dxf_to_svg(tmp_path)
    except Exception as exc:
        os.unlink(tmp_path)
        flash(f'DXF conversion failed: {exc}', 'danger')
        return redirect(url_for('panels.panel_layer_view', project_id=project_id, layer_id=layer_id))
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    # Remove old SVG if present
    if layer.svg_filename:
        storage.delete_file(f'panels/{layer.svg_filename}', os.path.join(SVG_FOLDER, layer.svg_filename))
    stored_name = f'{uuid.uuid4().hex}.svg'
    storage.upload_text(svg_content, f'panels/{stored_name}', os.path.join(SVG_FOLDER, stored_name))
    layer.svg_filename = stored_name
    layer.svg_original_name = secure_filename(dxf_file.filename).replace('.dxf', '.svg')
    db.session.commit()
    flash('DXF converted and diagram saved. Click a panel to start recording.', 'success')
    return redirect(url_for('panels.panel_layer_view', project_id=project_id, layer_id=layer_id))


@panels_bp.route('/project/<int:project_id>/panels/layer/<int:layer_id>/upload-bg', methods=['POST'])
@require_role('admin')
def panel_layer_upload_bg(project_id, layer_id):
    """Upload a background image (JPG/PNG) or PDF (first page) for a diagram layer."""
    layer = DiagramLayer.query.get_or_404(layer_id)
    if layer.project_id != project_id:
        return 'Not found', 404
    bg_file = request.files.get('bg_file')
    if not bg_file or not bg_file.filename:
        flash('No file selected.', 'warning')
        return redirect(url_for('panels.panel_layer_view', project_id=project_id, layer_id=layer_id))
    ext = bg_file.filename.rsplit('.', 1)[-1].lower()
    if ext not in ('jpg', 'jpeg', 'png', 'pdf'):
        flash('Background must be JPG, PNG, or PDF.', 'warning')
        return redirect(url_for('panels.panel_layer_view', project_id=project_id, layer_id=layer_id))
    os.makedirs(SVG_FOLDER, exist_ok=True)
    # Remove old background
    if layer.bg_filename:
        storage.delete_file(f'panels/{layer.bg_filename}', os.path.join(SVG_FOLDER, layer.bg_filename))
    stored_name = f'{uuid.uuid4().hex}_bg.png'
    dest = os.path.join(SVG_FOLDER, stored_name)
    os.makedirs(SVG_FOLDER, exist_ok=True)
    if ext == 'pdf':
        if not _PYMUPDF_AVAILABLE:
            flash('PDF conversion requires PyMuPDF. Run: pip install PyMuPDF', 'danger')
            return redirect(url_for('panels.panel_layer_view', project_id=project_id, layer_id=layer_id))
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            bg_file.save(tmp.name)
            tmp_path = tmp.name
        try:
            doc = _fitz.open(tmp_path)
            page = doc[0]
            mat = _fitz.Matrix(2.0, 2.0)
            pix = page.get_pixmap(matrix=mat)
            pix.save(dest)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        storage.upload_local_file(dest, f'panels/{stored_name}')
    else:
        storage.upload_file(bg_file, f'panels/{stored_name}', dest)
    layer.bg_filename = stored_name
    layer.bg_original_name = secure_filename(bg_file.filename)
    db.session.commit()
    flash('Background image saved.', 'success')
    return redirect(url_for('panels.panel_layer_view', project_id=project_id, layer_id=layer_id))


@panels_bp.route('/project/<int:project_id>/panels/layer/<int:layer_id>/bg-image')
@require_role('admin', 'supervisor', 'site')
def panel_layer_bg_image(project_id, layer_id):
    """Serve the background image for a diagram layer (diagram view)."""
    layer = DiagramLayer.query.get_or_404(layer_id)
    if layer.project_id != project_id or not layer.bg_filename:
        return '', 404
    return storage.serve_file(f'panels/{layer.bg_filename}', os.path.join(SVG_FOLDER, layer.bg_filename))


@panels_bp.route('/project/<int:project_id>/panels/layer/<int:layer_id>/autodetect', methods=['POST'])
@require_role('admin')
def panel_layer_autodetect(project_id, layer_id):
    """Run OpenCV contour detection on the background image and return panel polygons."""
    if not _CV2_AVAILABLE:
        return jsonify({'ok': False, 'error': 'opencv-python-headless not installed'}), 500
    layer = DiagramLayer.query.get_or_404(layer_id)
    if layer.project_id != project_id or not layer.bg_filename:
        return jsonify({'ok': False, 'error': 'No background image uploaded'}), 400
    bg_path = os.path.join(SVG_FOLDER, layer.bg_filename)
    if not os.path.exists(bg_path):
        return jsonify({'ok': False, 'error': 'Background image file not found'}), 404

    img = _cv2.imread(bg_path)
    if img is None:
        return jsonify({'ok': False, 'error': 'Could not read background image'}), 500
    h, w = img.shape[:2]

    # Get detection parameters from request
    data = request.get_json() or {}
    min_area_pct = float(data.get('min_area_pct', 0.002))   # 0.2% of image area
    max_area_pct = float(data.get('max_area_pct', 0.25))    # 25% of image area
    min_area = int(w * h * min_area_pct)
    max_area = int(w * h * max_area_pct)

    gray = _cv2.cvtColor(img, _cv2.COLOR_BGR2GRAY)

    threshold_val = int(data.get('threshold', 180))
    dilate_iter   = int(data.get('dilate', 3))

    _, binary = _cv2.threshold(gray, threshold_val, 255, _cv2.THRESH_BINARY_INV)
    kernel = _np.ones((3, 3), _np.uint8)

    # ── 1. Find the overall outer boundary of the drawing ─────────────
    # Use heavy dilation to ensure the outer outline is fully closed.
    outer_bin = _cv2.dilate(binary, kernel, iterations=dilate_iter * 5)
    cnts_outer, _ = _cv2.findContours(outer_bin, _cv2.RETR_EXTERNAL, _cv2.CHAIN_APPROX_SIMPLE)
    if not cnts_outer:
        return jsonify({'ok': False, 'error': 'No drawing boundary found. Try lowering the threshold.'})
    outer_cnt = max(cnts_outer, key=_cv2.contourArea)
    if _cv2.contourArea(outer_cnt) < w * h * 0.05:
        return jsonify({'ok': False, 'error': 'Drawing boundary too small. Check threshold.'})
    outer_mask = _np.zeros((h, w), _np.uint8)
    _cv2.fillPoly(outer_mask, [outer_cnt], 255)

    # ── 2. Detect panel divider lines using Hough transform ───────────
    # Use minimal dilation so we detect individual lines, not blobs.
    line_bin = _cv2.dilate(binary, kernel, iterations=1)
    lines = _cv2.HoughLinesP(
        line_bin, 1, _np.pi / 180,
        threshold=40,
        minLineLength=int(h * 0.15),   # line must span ≥15% of image height
        maxLineGap=int(h * 0.06),      # allow gaps up to 6% of image height
    )
    if lines is None or len(lines) < 2:
        return jsonify({'ok': False, 'error': 'Not enough panel lines detected. Try lowering threshold or gap-close.'})

    # ── 3. Keep lines that are mostly vertical (panel dividers) ───────
    # Panels can be tilted, so accept angles 25°–90° from horizontal.
    mid_y = h / 2.0
    dividers = []
    for ln in lines:
        x1, y1, x2, y2 = map(int, ln[0])
        dy = y2 - y1
        dx = x2 - x1
        if abs(dy) < 1:
            continue
        angle = abs(_np.degrees(_np.arctan2(dy, dx)))
        if angle < 25:
            continue   # too horizontal — skip boundary/baseline lines
        # Normalise so y1 is always the top point
        if y1 > y2:
            x1, y1, x2, y2 = x2, y2, x1, y1
        # X-position at mid-image (used for clustering / sorting)
        t = (mid_y - y1) / (y2 - y1) if (y2 - y1) != 0 else 0.5
        x_mid = x1 + t * (x2 - x1)
        dividers.append({'x_mid': x_mid, 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2})

    if len(dividers) < 2:
        return jsonify({'ok': False, 'error': 'Too few vertical lines found. Try lowering threshold.'})

    dividers.sort(key=lambda d: d['x_mid'])

    # ── 4. Cluster nearby dividers (merge duplicate Hough detections) ─
    cluster_gap = max(6, w // 100)
    clusters, current = [], [dividers[0]]
    for d in dividers[1:]:
        if d['x_mid'] - current[-1]['x_mid'] < cluster_gap:
            current.append(d)
        else:
            clusters.append(current)
            current = [d]
    clusters.append(current)

    # Average each cluster into one representative line
    merged = []
    for cl in clusters:
        merged.append({
            'x1': int(_np.mean([d['x1'] for d in cl])),
            'y1': int(_np.mean([d['y1'] for d in cl])),
            'x2': int(_np.mean([d['x2'] for d in cl])),
            'y2': int(_np.mean([d['y2'] for d in cl])),
        })

    # ── 5. Build panel quads from each adjacent pair of dividers ──────
    polygons = []
    for i in range(len(merged) - 1):
        L, R = merged[i], merged[i + 1]
        pts = [
            [L['x1'], L['y1']],   # top-left
            [R['x1'], R['y1']],   # top-right
            [R['x2'], R['y2']],   # bottom-right
            [L['x2'], L['y2']],   # bottom-left
        ]
        cnt_arr = _np.array(pts, dtype=_np.int32)
        area = _cv2.contourArea(cnt_arr)
        if area < min_area or area > max_area:
            continue
        # Panel must overlap the drawing boundary by at least 40%
        pmask = _np.zeros((h, w), _np.uint8)
        _cv2.fillPoly(pmask, [cnt_arr], 255)
        overlap = _cv2.countNonZero(_cv2.bitwise_and(pmask, outer_mask))
        total   = _cv2.countNonZero(pmask)
        if total > 0 and overlap / total < 0.4:
            continue
        polygons.append(pts)

    return jsonify({
        'ok': True,
        'img_width': w,
        'img_height': h,
        'polygons': polygons,
        'count': len(polygons),
    })


@panels_bp.route('/project/<int:project_id>/panels/layer/<int:layer_id>/delete', methods=['POST'])
@require_role('admin')
def panel_layer_delete(project_id, layer_id):
    layer = DiagramLayer.query.get_or_404(layer_id)
    if layer.project_id != project_id:
        return 'Not found', 404
    for fname in (layer.svg_filename, layer.bg_filename):
        if fname:
            storage.delete_file(f'panels/{fname}', os.path.join(SVG_FOLDER, fname))
    db.session.delete(layer)
    db.session.commit()
    flash(f'Layer "{layer.layer_name}" deleted.', 'success')
    return redirect(url_for('panels.panel_overview', project_id=project_id))


@panels_bp.route('/project/<int:project_id>/panels/layer/<int:layer_id>')
@require_role('admin', 'supervisor', 'site')
def panel_layer_view(project_id, layer_id):
    project = Project.query.get_or_404(project_id)
    layer = DiagramLayer.query.get_or_404(layer_id)
    if layer.project_id != project_id:
        return 'Not found', 404
    all_layers = (DiagramLayer.query
                  .filter_by(project_id=project_id)
                  .order_by(DiagramLayer.sort_order, DiagramLayer.layer_name)
                  .all())
    svg_content = None
    if layer.svg_filename:
        svg_content = storage.read_text(f'panels/{layer.svg_filename}', os.path.join(SVG_FOLDER, layer.svg_filename))
    panel_data = {}
    for rec in layer.panels:
        panel_data[rec.panel_id] = {
            'id': rec.id,
            'panel_id': rec.panel_id,
            'panel_label': rec.panel_label or rec.panel_id,
            'status': rec.status,
            'installed_date': rec.installed_date.isoformat() if rec.installed_date else '',
            'employee_id': rec.employee_id or '',
            'notes': rec.notes or '',
            'roll_number': rec.roll_number or '',
            'install_time': rec.install_time or '',
            'width_m': rec.width_m if rec.width_m is not None else '',
            'length_m': rec.length_m if rec.length_m is not None else '',
            'area_sqm': rec.area_sqm if rec.area_sqm is not None else '',
            'panel_type': rec.panel_type or '',
        }
    employees = Employee.query.filter_by(active=True).order_by(Employee.name).all()
    bg_url = url_for('panels.panel_layer_bg_image', project_id=project_id, layer_id=layer_id) \
             if layer.bg_filename else None
    return render_template('panels/layer.html',
                           project=project, layer=layer,
                           all_layers=all_layers,
                           svg_content=svg_content,
                           panel_data_json=json.dumps(panel_data),
                           employees=employees,
                           bg_url=bg_url,
                           cv2_available=_CV2_AVAILABLE)


@panels_bp.route('/project/<int:project_id>/panels/layer/<int:layer_id>/record', methods=['POST'])
@require_role('admin', 'supervisor')
def panel_record_save(project_id, layer_id):
    layer = DiagramLayer.query.get_or_404(layer_id)
    if layer.project_id != project_id:
        return jsonify({'ok': False, 'error': 'Not found'}), 404
    data = request.get_json() or {}
    panel_id = (data.get('panel_id') or '').strip()
    if not panel_id:
        return jsonify({'ok': False, 'error': 'panel_id required'}), 400
    status = data.get('status', 'planned')
    panel_label = (data.get('panel_label') or '').strip() or panel_id
    notes = (data.get('notes') or '').strip() or None
    roll_number = (data.get('roll_number') or '').strip() or None
    install_time = (data.get('install_time') or '').strip() or None
    panel_type = (data.get('panel_type') or '').strip() or None
    def _float_or_none(v):
        try:
            return float(v) if v not in (None, '') else None
        except (ValueError, TypeError):
            return None
    width_m   = _float_or_none(data.get('width_m'))
    length_m  = _float_or_none(data.get('length_m'))
    area_sqm  = _float_or_none(data.get('area_sqm'))
    employee_id = data.get('employee_id') or None
    if employee_id:
        try:
            employee_id = int(employee_id)
        except (ValueError, TypeError):
            employee_id = None
    installed_date = None
    if data.get('installed_date'):
        try:
            from datetime import datetime as _dt
            installed_date = _dt.strptime(data['installed_date'], '%Y-%m-%d').date()
        except ValueError:
            pass
    rec = PanelInstallRecord.query.filter_by(layer_id=layer_id, panel_id=panel_id).first()
    if rec is None:
        rec = PanelInstallRecord(layer_id=layer_id, panel_id=panel_id)
        db.session.add(rec)
    rec.panel_label = panel_label
    rec.status = status
    rec.installed_date = installed_date
    rec.employee_id = employee_id
    rec.notes = notes
    rec.roll_number  = roll_number
    rec.install_time = install_time
    rec.width_m      = width_m
    rec.length_m     = length_m
    rec.area_sqm     = area_sqm
    rec.panel_type   = panel_type
    rec.recorded_by_id = current_user.id
    rec.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({
        'ok': True,
        'status': rec.status,
        'panel_id': rec.panel_id,
        'panel_label': panel_label,
        'roll_number':  roll_number,
        'install_time': install_time,
        'width_m':      width_m,
        'length_m':     length_m,
        'area_sqm':     area_sqm,
        'panel_type':   panel_type,
    })


@panels_bp.route('/project/<int:project_id>/panels/layer/<int:layer_id>/data.json')
@require_role('admin', 'supervisor', 'site')
def panel_data_json(project_id, layer_id):
    layer = DiagramLayer.query.get_or_404(layer_id)
    if layer.project_id != project_id:
        return jsonify({}), 404
    data = {}
    for rec in layer.panels:
        data[rec.panel_id] = {
            'panel_label': rec.panel_label or rec.panel_id,
            'status': rec.status,
            'installed_date': rec.installed_date.isoformat() if rec.installed_date else '',
            'employee_id': rec.employee_id or '',
            'notes': rec.notes or '',
        }
    return jsonify(data)
