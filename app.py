from flask import Flask, request, redirect, url_for
from flask_login import LoginManager, current_user
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

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'instance', 'uploads')

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

from blueprints.admin import admin_bp
app.register_blueprint(admin_bp)

from blueprints.main import main_bp
app.register_blueprint(main_bp)

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
        "ALTER TABLE user ADD COLUMN role VARCHAR(20) DEFAULT 'admin' NOT NULL",
        "ALTER TABLE user ADD COLUMN employee_id INTEGER REFERENCES employee(id)",
        """CREATE TABLE IF NOT EXISTS user_project_access (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES "user"(id),
            project_id INTEGER NOT NULL REFERENCES project(id),
            granted_by INTEGER REFERENCES "user"(id),
            granted_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, project_id)
        )""",
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


if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
