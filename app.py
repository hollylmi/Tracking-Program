import json
from datetime import timedelta

from flask import Flask, request, redirect, url_for, session
from flask_login import LoginManager, current_user
from markupsafe import Markup
from models import db, User, Project
import os


app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-key-change-in-production')
_db_url = os.environ.get('DATABASE_URL', 'sqlite:///tracking.db')
# Railway provides postgres:// — SQLAlchemy requires postgresql://
if _db_url.startswith('postgres://'):
    _db_url = _db_url.replace('postgres://', 'postgresql://', 1)
app.config['SQLALCHEMY_DATABASE_URI'] = _db_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # 32 MB upload limit

# TODO: Set JWT_SECRET_KEY environment variable in Railway before deploying to production.
# Generate one with: python -c "import secrets; print(secrets.token_hex(32))"
app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', 'dev-jwt-secret-change-in-prod')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=12)
app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(days=30)
app.config['JWT_TOKEN_LOCATION'] = ['headers', 'query_string']
app.config['JWT_QUERY_STRING_NAME'] = 'token'
# TODO: Set up Railway cron job to call
# POST /api/admin/send-reminders at 4pm
# daily after beta launch

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'instance', 'uploads')

db.init_app(app)

from flask_jwt_extended import JWTManager
jwt = JWTManager(app)

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

from blueprints.admin import admin_bp
app.register_blueprint(admin_bp)

from blueprints.main import main_bp
app.register_blueprint(main_bp)

from blueprints.api.auth import api_auth_bp
app.register_blueprint(api_auth_bp, url_prefix='/api')

from blueprints.api.data import api_data_bp
app.register_blueprint(api_data_bp, url_prefix='/api')

@app.template_filter('breakdown_json')
def breakdown_json_filter(bd):
    """Serialize a MachineBreakdown model to HTML-attribute-safe JSON.
    Double quotes are encoded as &quot; so the output can be used in data-* attributes.
    The browser automatically decodes &quot; back to " before JSON.parse() sees it.
    """
    photos = []
    for p in (bd.photos or []):
        photos.append({
            'url': url_for('equipment.serve_breakdown_photo', filename=p.filename),
            'name': p.original_name or p.filename,
        })
    data = {
        'id': bd.id,
        'date': bd.incident_date.isoformat() if bd.incident_date else None,
        'incident_time': bd.incident_time,
        'description': bd.description or '',
        'repair_status': bd.repair_status or 'pending',
        'repairing_by': bd.repairing_by,
        'anticipated_return': bd.anticipated_return.isoformat() if bd.anticipated_return else None,
        'resolved_date': bd.resolved_date.isoformat() if bd.resolved_date else None,
        'photos': photos,
    }
    raw = json.dumps(data)
    # Encode for safe embedding in an HTML double-quoted attribute value
    safe = raw.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
    return Markup(safe)


login_manager = LoginManager(app)
login_manager.login_view = 'auth.login'
login_manager.login_message = 'Please log in to access this page.'
login_manager.login_message_category = 'warning'


@jwt.unauthorized_loader
def unauthorized_response(callback):
    return {'error': 'Missing or invalid token'}, 401

@jwt.expired_token_loader
def expired_token_response(jwt_header, jwt_payload):
    return {'error': 'Token has expired'}, 401

@jwt.invalid_token_loader
def invalid_token_response(callback):
    return {'error': 'Invalid token'}, 422


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
        'ALTER TABLE "user" ADD COLUMN email VARCHAR(200)',
        "ALTER TABLE daily_entry ADD COLUMN weather VARCHAR(200)",
        "ALTER TABLE daily_entry ADD COLUMN local_id VARCHAR(100)",
        "ALTER TABLE daily_entry ADD COLUMN form_opened_at TIMESTAMP",
        "ALTER TABLE machine_breakdown ADD COLUMN local_id VARCHAR(100)",
        "ALTER TABLE diagram_layer ADD COLUMN canvas_bg_filename VARCHAR(500)",
        "ALTER TABLE diagram_layer ADD COLUMN canvas_bg_original_name VARCHAR(500)",
        "ALTER TABLE panel_install_record ADD COLUMN source VARCHAR(20)",
        'ALTER TABLE "user" ADD COLUMN role VARCHAR(20) DEFAULT \'admin\' NOT NULL',
        'ALTER TABLE "user" ADD COLUMN employee_id INTEGER REFERENCES employee(id)',
        """CREATE TABLE IF NOT EXISTS user_project_access (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES "user"(id),
            project_id INTEGER NOT NULL REFERENCES project(id),
            granted_by INTEGER REFERENCES "user"(id),
            granted_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, project_id)
        )""",
        """CREATE TABLE IF NOT EXISTS device_token (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES "user"(id),
            token VARCHAR(500) NOT NULL,
            platform VARCHAR(20) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, token)
        )""",
        # ── 2026-03-24: catch-up migrations for columns added to models ──
        "ALTER TABLE project ADD COLUMN site_address VARCHAR(500)",
        "ALTER TABLE project ADD COLUMN site_contact VARCHAR(200)",
        # DailyEntry — columns added after initial table creation
        "ALTER TABLE daily_entry ADD COLUMN location VARCHAR(200)",
        "ALTER TABLE daily_entry ADD COLUMN install_sqm FLOAT DEFAULT 0",
        "ALTER TABLE daily_entry ADD COLUMN delay_billable BOOLEAN DEFAULT TRUE",
        "ALTER TABLE daily_entry ADD COLUMN delay_description TEXT",
        "ALTER TABLE daily_entry ADD COLUMN machines_stood_down BOOLEAN DEFAULT FALSE",
        "ALTER TABLE daily_entry ADD COLUMN other_work_description TEXT",
        "ALTER TABLE daily_entry ADD COLUMN updated_at TIMESTAMP",
        "ALTER TABLE daily_entry ADD COLUMN user_id INTEGER REFERENCES \"user\"(id)",
        # HiredMachine — newer columns
        "ALTER TABLE hired_machine ADD COLUMN hire_company_email VARCHAR(200)",
        "ALTER TABLE hired_machine ADD COLUMN hire_company_phone VARCHAR(50)",
        "ALTER TABLE hired_machine ADD COLUMN cost_per_day FLOAT",
        "ALTER TABLE hired_machine ADD COLUMN cost_per_week FLOAT",
        "ALTER TABLE hired_machine ADD COLUMN count_saturdays BOOLEAN DEFAULT TRUE",
        "ALTER TABLE hired_machine ADD COLUMN invoice_filename VARCHAR(500)",
        "ALTER TABLE hired_machine ADD COLUMN invoice_original_name VARCHAR(500)",
        "ALTER TABLE hired_machine ADD COLUMN notes TEXT",
        "ALTER TABLE hired_machine ADD COLUMN active BOOLEAN DEFAULT TRUE",
        # PanelInstallRecord — as-built canvas columns
        "ALTER TABLE panel_install_record ADD COLUMN roll_number VARCHAR(100)",
        "ALTER TABLE panel_install_record ADD COLUMN install_time VARCHAR(10)",
        "ALTER TABLE panel_install_record ADD COLUMN width_m FLOAT",
        "ALTER TABLE panel_install_record ADD COLUMN length_m FLOAT",
        "ALTER TABLE panel_install_record ADD COLUMN area_sqm FLOAT",
        "ALTER TABLE panel_install_record ADD COLUMN panel_type VARCHAR(100)",
        "ALTER TABLE panel_install_record ADD COLUMN canvas_x FLOAT",
        "ALTER TABLE panel_install_record ADD COLUMN canvas_y FLOAT",
        "ALTER TABLE panel_install_record ADD COLUMN canvas_w FLOAT",
        "ALTER TABLE panel_install_record ADD COLUMN canvas_h FLOAT",
        "ALTER TABLE panel_install_record ADD COLUMN canvas_points TEXT",
        "ALTER TABLE panel_install_record ADD COLUMN recorded_by_id INTEGER REFERENCES \"user\"(id)",
        "ALTER TABLE panel_install_record ADD COLUMN updated_at TIMESTAMP",
        # ProjectAssignment — scheduled_role_id
        "ALTER TABLE project_assignment ADD COLUMN scheduled_role_id INTEGER REFERENCES role(id)",
        # MachineBreakdown — hired_machine support
        "ALTER TABLE machine_breakdown ADD COLUMN hired_machine_id INTEGER REFERENCES hired_machine(id)",
        # Widen legacy state column — was VARCHAR(10), too small for comma-separated values
        "ALTER TABLE public_holiday ALTER COLUMN state TYPE VARCHAR(200)",
        "ALTER TABLE cfmeu_date ALTER COLUMN state TYPE VARCHAR(200)",
        # Machine groups
        "ALTER TABLE machine ADD COLUMN group_id INTEGER REFERENCES machine_group(id)",
        "ALTER TABLE hired_machine ADD COLUMN group_id INTEGER REFERENCES machine_group(id)",
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
def inject_project_context():
    """Inject project context into every template.

    For admins: injects _active_projects (all active) for the Progress dropdown,
                plus active_project=None and permitted_projects=None.
    For supervisor/site: injects permitted projects, the current active project,
                         and _active_projects (same list) for nav compatibility.
    """
    if not current_user.is_authenticated:
        return {}

    if current_user.role == 'admin':
        try:
            projects = Project.query.filter_by(active=True).order_by(Project.name).all()
        except Exception:
            projects = []
        return {
            '_active_projects': projects,
            'active_project': None,
            'permitted_projects': None,
        }

    permitted = current_user.accessible_projects()
    active_project = None
    active_id = session.get('active_project_id')

    if active_id:
        active_project = next((p for p in permitted if p.id == active_id), None)

    if not active_project and permitted:
        active_project = permitted[0]
        session['active_project_id'] = permitted[0].id

    return {
        '_active_projects': permitted,
        'active_project': active_project,
        'permitted_projects': permitted,
    }


@app.before_request
def require_login():
    """Redirect unauthenticated users to login for all routes except login/static."""
    if request.path.startswith('/api/'):
        return  # JWT handles auth for all /api/* routes
    public_endpoints = {'auth.login', 'auth.logout', 'auth.no_project', 'static'}
    if request.endpoint not in public_endpoints and not current_user.is_authenticated:
        return redirect(url_for('auth.login', next=request.url))


@app.before_request
def set_active_project():
    """Track the active project for supervisor/site users via the session."""
    if request.path.startswith('/api/'):
        return  # JWT handles auth for all /api/* routes
    if not current_user.is_authenticated:
        return
    if request.endpoint in ('static', 'auth.login', 'auth.logout', 'auth.no_project'):
        return
    if current_user.role == 'admin':
        return

    permitted = current_user.accessible_projects()

    if not permitted:
        session.pop('active_project_id', None)
        return redirect(url_for('auth.no_project'))

    # Allow a project switch via ?switch_project=<id>
    requested_id = request.args.get('switch_project', type=int)
    if requested_id:
        permitted_ids = [p.id for p in permitted]
        if requested_id in permitted_ids:
            session['active_project_id'] = requested_id

    # Default to first permitted project if nothing set yet
    if 'active_project_id' not in session:
        session['active_project_id'] = permitted[0].id


if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
