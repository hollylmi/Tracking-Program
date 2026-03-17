"""dxf_to_svg.py — Convert a DXF file to an SVG with labelled panel shapes.

Two strategies are attempted in order:

1. RASTER strategy (preferred, requires opencv-python-headless + numpy):
   - Rasterize ALL line geometry onto a high-resolution canvas.
   - Find enclosed white regions between the drawn lines using connected components.
   - Works for drawings where panels are formed by multiple overlapping/shared
     polylines — no need for each panel to be a single closed polyline.

2. VECTOR fallback (used if OpenCV is not available):
   - Reads only explicitly closed LWPOLYLINE / POLYLINE entities.
   - Works only when every panel outline is a single closed polyline.

In both cases, TEXT / MTEXT labels are extracted from the DXF and matched to panels.
"""

import re
import math
import ezdxf

# Optional: raster strategy
try:
    import numpy as _np
    import cv2 as _cv2
    _RASTER_AVAILABLE = True
except ImportError:
    _RASTER_AVAILABLE = False


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _mtext_plain(e) -> str:
    """Extract plain text from an MTEXT entity across ezdxf versions."""
    try:
        from ezdxf.tools.text import plain_mtext
        return plain_mtext(e.text)
    except Exception:
        pass
    try:
        return e.plain_mtext()
    except AttributeError:
        pass
    t = getattr(e, 'text', '') or ''
    t = re.sub(r'\{\\[^}]*;([^}]*)\}', r'\1', t)
    t = re.sub(r'\\[A-Za-z0-9]+;', '', t)
    t = re.sub(r'\\P', ' ', t)
    return t.strip()


def _safe_id(text: str) -> str:
    """Strip whitespace and replace characters invalid in SVG IDs."""
    text = text.strip()
    text = re.sub(r'[^\w\-.]', '_', text)
    if text and text[0].isdigit():
        text = 'p_' + text
    return text or 'panel'


def _arc_points(cx, cy, r, start_deg, end_deg, steps=24):
    """Approximate an arc as a list of (x, y) points."""
    if end_deg < start_deg:
        end_deg += 360.0
    angles = [math.radians(start_deg + (end_deg - start_deg) * i / steps)
              for i in range(steps + 1)]
    return [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in angles]


def _collect_geometry(msp):
    """
    Return (polylines, texts) from a DXF model space.

    polylines : list of lists of (x, y) — each is one continuous line strip
    texts     : list of {text, x, y}
    """
    polylines = []
    texts = []

    for e in msp:
        tag = e.dxftype()

        # ── geometry ──────────────────────────────────────────────────────
        if tag == 'LWPOLYLINE':
            pts = [(p[0], p[1]) for p in e.get_points()]
            if len(pts) >= 2:
                if e.closed:
                    pts = pts + [pts[0]]
                polylines.append(pts)

        elif tag == 'LINE':
            polylines.append([
                (e.dxf.start.x, e.dxf.start.y),
                (e.dxf.end.x,   e.dxf.end.y),
            ])

        elif tag == 'POLYLINE':
            pts = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
            if len(pts) >= 2:
                if e.is_closed:
                    pts = pts + [pts[0]]
                polylines.append(pts)

        elif tag == 'ARC':
            try:
                cx, cy = e.dxf.center.x, e.dxf.center.y
                r = e.dxf.radius
                pts = _arc_points(cx, cy, r, e.dxf.start_angle, e.dxf.end_angle)
                polylines.append(pts)
            except Exception:
                pass

        elif tag == 'SPLINE':
            try:
                pts = [(p[0], p[1]) for p in e.flattening(0.01)]
                if len(pts) >= 2:
                    polylines.append(pts)
            except Exception:
                pass

        # ── text ──────────────────────────────────────────────────────────
        elif tag == 'TEXT':
            texts.append({
                'text': (e.dxf.text or '').strip(),
                'x': e.dxf.insert.x,
                'y': e.dxf.insert.y,
            })

        elif tag == 'MTEXT':
            plain = _mtext_plain(e).strip()
            ins = e.dxf.insert
            texts.append({'text': plain, 'x': ins.x, 'y': ins.y})

        elif tag == 'INSERT':
            # Block references — check ATTRIB children for panel IDs
            try:
                for attrib in e.attribs:
                    aname = (attrib.dxf.tag or '').upper()
                    if aname in ('PANEL_NO', 'PANEL', 'ID', 'NAME', 'LABEL', 'NUMBER', 'NO'):
                        val = (attrib.dxf.text or '').strip()
                        if val:
                            texts.append({
                                'text': val,
                                'x': attrib.dxf.insert.x,
                                'y': attrib.dxf.insert.y,
                            })
            except Exception:
                pass

    return polylines, texts


def _assign_labels(shapes, used_labels=None):
    """Ensure every shape has a unique non-None label, filling gaps with panel_N."""
    if used_labels is None:
        used_labels = set()

    # First: de-duplicate already-assigned labels
    for shape in shapes:
        if shape.get('label'):
            raw = shape['label']
            candidate = raw
            n = 2
            while candidate in used_labels:
                candidate = f'{raw}_{n}'
                n += 1
            shape['label'] = candidate
            used_labels.add(candidate)

    # Second: fallback IDs
    for i, shape in enumerate(shapes, start=1):
        if not shape.get('label'):
            candidate = f'panel_{i}'
            n = 2
            while candidate in used_labels:
                candidate = f'panel_{i}_{n}'
                n += 1
            shape['label'] = candidate
            used_labels.add(candidate)

    return shapes


def _build_svg(shapes, min_x, min_y, max_x, max_y):
    """Emit the SVG string from a list of shapes with DXF-space vertices."""
    dxf_w = max_x - min_x or 1.0
    dxf_h = max_y - min_y or 1.0
    pad   = max(dxf_w, dxf_h) * 0.02

    vb_x = min_x - pad
    vb_y = min_y - pad
    vb_w = dxf_w + 2 * pad
    vb_h = dxf_h + 2 * pad

    def flip_y(y):
        # DXF Y-up → SVG Y-down
        return (max_y + min_y) - y

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg"'
        f' viewBox="{vb_x:.4f} {vb_y:.4f} {vb_w:.4f} {vb_h:.4f}"'
        f' preserveAspectRatio="xMidYMid meet">',
        f'  <!-- Generated by Plytrack DXF converter — {len(shapes)} panels -->',
    ]

    for shape in shapes:
        pts = ' '.join(
            f'{x:.4f},{flip_y(y):.4f}'
            for x, y in shape['verts']
        )
        lines.append(
            f'  <polygon id="{shape["label"]}" points="{pts}"'
            f' fill="#e2e8f0" stroke="#64748b"'
            f' vector-effect="non-scaling-stroke"'
            f' style="stroke-width:1px;cursor:pointer;"'
            f' onclick="window._plyClick(this)"'
            f' pointer-events="all"/>'
        )

    lines.append('</svg>')
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Strategy 1: Raster (OpenCV) — handles overlapping polylines
# ---------------------------------------------------------------------------

def _dxf_to_svg_raster(polylines, texts, canvas_width=4000):
    """
    Rasterize all line geometry, find enclosed regions with connected components,
    and return (shapes, min_x, min_y, max_x, max_y).

    Each shape: {verts: [(x,y),...], label: str|None, comp_id: int}
    """
    np = _np
    cv2 = _cv2

    # Bounds
    all_pts = [p for pl in polylines for p in pl]
    min_x = min(p[0] for p in all_pts)
    max_x = max(p[0] for p in all_pts)
    min_y = min(p[1] for p in all_pts)
    max_y = max(p[1] for p in all_pts)

    dxf_w = max_x - min_x or 1.0
    dxf_h = max_y - min_y or 1.0

    # Canvas with 2% padding on each side
    pad_frac = 0.02
    px_pad = max(4, int(canvas_width * pad_frac))

    cw = canvas_width + 2 * px_pad
    ch = int(canvas_width * dxf_h / dxf_w) + 2 * px_pad
    scale = canvas_width / dxf_w

    def to_px(x, y):
        return (
            int((x - min_x) * scale) + px_pad,
            int((max_y - y) * scale) + px_pad,   # flip Y
        )

    def from_px(px, py):
        return (
            (px - px_pad) / scale + min_x,
            max_y - (py - px_pad) / scale,        # un-flip Y
        )

    # White canvas, black lines
    canvas = np.ones((ch, cw), dtype=np.uint8) * 255
    line_thickness = max(2, int(scale * 0.002))   # thin but connected

    for pl in polylines:
        px_pts = [to_px(p[0], p[1]) for p in pl]
        for i in range(len(px_pts) - 1):
            cv2.line(canvas, px_pts[i], px_pts[i + 1], 0, line_thickness)

    # Seal the canvas border so the outer region is connected
    cv2.rectangle(canvas, (0, 0), (cw - 1, ch - 1), 0, line_thickness)

    # Find connected white regions
    non_line = (canvas == 255).astype(np.uint8)
    ret, labels, stats, centroids = cv2.connectedComponentsWithStats(non_line)

    # Identify regions touching the border (outer / background)
    border_ids = set()
    border_ids.update(labels[0, :].tolist())
    border_ids.update(labels[-1, :].tolist())
    border_ids.update(labels[:, 0].tolist())
    border_ids.update(labels[:, -1].tolist())

    total_px = cw * ch
    min_area = total_px * 0.000015  # very small minimum — ~0.0015% of canvas

    # ── Build shapes — first pass (area pre-filter only) ──────────────────────
    shapes = []

    for comp_id in range(1, ret):
        if comp_id in border_ids:
            continue
        area = int(stats[comp_id, cv2.CC_STAT_AREA])
        if area < min_area or area > total_px * 0.90:
            continue

        mask = (labels == comp_id).astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue

        contour = max(contours, key=cv2.contourArea)
        arc_len = cv2.arcLength(contour, True)
        epsilon = 0.003 * arc_len
        approx = cv2.approxPolyDP(contour, epsilon, True)
        if len(approx) < 3:
            continue

        verts = [from_px(pt[0][0], pt[0][1]) for pt in approx]

        cx_px, cy_px = centroids[comp_id]
        cx_dxf, cy_dxf = from_px(float(cx_px), float(cy_px))

        shapes.append({
            'verts':   verts,
            'label':   None,
            'comp_id': comp_id,
            'cx':      cx_dxf,
            'cy':      cy_dxf,
            'area':    area,
        })

    if not shapes:
        raise ValueError(
            'No enclosed panel regions found in the DXF.\n'
            'Make sure the drawing has lines that form closed panel boundaries.\n'
            'Tip: try exporting as DXF R2010 with all layers included.'
        )

    # ── Remove anomalously large "background corridor" regions ────────────────
    # These are areas inside the drawing boundary that are NOT panels — e.g.
    # the margins between the panel grid and the outer boundary line.
    # Strategy: repeatedly drop the largest region when it is more than 4×
    # the size of the next-largest, until the distribution looks uniform.
    shapes.sort(key=lambda s: s['area'], reverse=True)
    while len(shapes) >= 2 and shapes[0]['area'] > shapes[1]['area'] * 4:
        shapes.pop(0)

    # ── Sort largest → smallest so small panels are drawn last (on top) ───────
    # In SVG, later elements are painted on top and receive pointer events first.
    # Putting small panels last ensures they are clickable even when they
    # partially overlap a larger neighbouring region.
    shapes.sort(key=lambda s: s['area'], reverse=True)

    # ── Match text labels ────────────────────────────────────────────────────
    # Priority: text whose pixel coordinate falls inside the region
    for t in texts:
        if not t['text']:
            continue
        tx_px, ty_px = to_px(t['x'], t['y'])
        tx_i, ty_i = int(round(tx_px)), int(round(ty_px))
        if 0 <= ty_i < ch and 0 <= tx_i < cw:
            comp = int(labels[ty_i, tx_i])
            for shape in shapes:
                if shape['comp_id'] == comp and shape['label'] is None:
                    shape['label'] = _safe_id(t['text'])
                    break

    # Fallback: assign nearest unmatched text to each still-unlabelled shape
    unmatched_texts = [t for t in texts if t['text']]
    for shape in shapes:
        if shape['label'] or not unmatched_texts:
            continue
        best, best_d = None, float('inf')
        for t in unmatched_texts:
            d = (t['x'] - shape['cx']) ** 2 + (t['y'] - shape['cy']) ** 2
            if d < best_d:
                best_d, best = d, t
        if best:
            shape['label'] = _safe_id(best['text'])

    _assign_labels(shapes)
    return shapes, min_x, min_y, max_x, max_y


# ---------------------------------------------------------------------------
# Strategy 2: Vector fallback — closed polylines only
# ---------------------------------------------------------------------------

def _bbox(verts):
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    return min(xs), min(ys), max(xs), max(ys)


def _centroid(verts):
    return (
        sum(v[0] for v in verts) / len(verts),
        sum(v[1] for v in verts) / len(verts),
    )


def _point_in_bbox(px, py, bbox):
    x0, y0, x1, y1 = bbox
    return x0 <= px <= x1 and y0 <= py <= y1


def _dxf_to_svg_vector(msp):
    """
    Fallback: read only explicitly-closed LWPOLYLINE / POLYLINE entities.
    Returns (shapes, min_x, min_y, max_x, max_y).
    """
    shapes = []

    for e in msp:
        verts = None
        tag = e.dxftype()
        if tag == 'LWPOLYLINE' and e.closed:
            verts = [(p[0], p[1]) for p in e.get_points()]
        elif tag == 'POLYLINE' and e.is_closed:
            verts = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]

        if verts and len(verts) >= 3:
            shapes.append({'verts': verts, 'bbox': _bbox(verts), 'label': None})

    if not shapes:
        # Try HATCH boundaries
        for e in msp:
            if e.dxftype() != 'HATCH':
                continue
            for path in e.paths:
                try:
                    verts = [(p[0], p[1]) for p in path.vertices]
                except AttributeError:
                    continue
                if len(verts) >= 3:
                    shapes.append({'verts': verts, 'bbox': _bbox(verts), 'label': None})

    if not shapes:
        raise ValueError(
            'No closed polylines found in the DXF model space.\n'
            'If your panels are formed by overlapping lines, install opencv-python-headless '
            'and numpy so the raster detection strategy can be used instead.'
        )

    # Collect texts
    texts = []
    for e in msp:
        tag = e.dxftype()
        if tag == 'TEXT':
            texts.append({'text': (e.dxf.text or '').strip(),
                          'x': e.dxf.insert.x, 'y': e.dxf.insert.y})
        elif tag == 'MTEXT':
            plain = _mtext_plain(e).strip()
            ins = e.dxf.insert
            texts.append({'text': plain, 'x': ins.x, 'y': ins.y})

    used: set = set()
    for shape in shapes:
        best, best_score = None, float('inf')
        cx, cy = _centroid(shape['verts'])
        for t in texts:
            if not t['text']:
                continue
            tx, ty = t['x'], t['y']
            dist = (tx - cx) ** 2 + (ty - cy) ** 2
            inside = _point_in_bbox(tx, ty, shape['bbox'])
            score = dist - (1e18 if inside else 0)
            if score < best_score:
                best_score, best = score, t['text']
        if best:
            shape['label'] = _safe_id(best)

    _assign_labels(shapes, used)

    all_x = [v[0] for s in shapes for v in s['verts']]
    all_y = [v[1] for s in shapes for v in s['verts']]
    return shapes, min(all_x), min(all_y), max(all_x), max(all_y)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def dxf_to_svg(dxf_path: str, canvas_width: int = 6000) -> str:
    """Parse *dxf_path* and return an SVG string with labelled panel shapes.

    Parameters
    ----------
    dxf_path : str
        Path to the DXF file.
    canvas_width : int
        Width of the internal raster canvas (raster strategy only).
        Higher values detect smaller panels but use more memory.
        Default 4000 works well for up to ~200 panels.

    Raises
    ------
    ValueError
        If no panel regions can be detected.
    ezdxf.DXFError
        If the file cannot be parsed as DXF.
    """
    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()

    if _RASTER_AVAILABLE:
        polylines, texts = _collect_geometry(msp)
        if not polylines:
            raise ValueError('No line geometry found in the DXF model space.')
        shapes, min_x, min_y, max_x, max_y = _dxf_to_svg_raster(
            polylines, texts, canvas_width=canvas_width
        )
    else:
        shapes, min_x, min_y, max_x, max_y = _dxf_to_svg_vector(msp)

    return _build_svg(shapes, min_x, min_y, max_x, max_y)
