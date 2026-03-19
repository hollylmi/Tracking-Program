from functools import wraps

from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_user, logout_user, current_user
from werkzeug.security import check_password_hash, generate_password_hash

from models import db, User, Employee

auth_bp = Blueprint('auth', __name__)

VALID_ROLES = ('admin', 'supervisor', 'site')


def require_role(*roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not current_user.is_authenticated:
                if request.is_json:
                    return {'error': 'Unauthorised'}, 401
                return redirect(url_for('auth.login'))
            if current_user.role not in roles:
                if request.is_json:
                    return {'error': 'Forbidden'}, 403
                flash('You do not have permission to access this page.', 'danger')
                return redirect(url_for('main.index'))
            return f(*args, **kwargs)
        return decorated_function
    return decorator


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        user = User.query.filter_by(username=username).first()
        if user and user.active and check_password_hash(user.password_hash, password):
            login_user(user, remember=request.form.get('remember') == 'on')
            next_page = request.args.get('next')
            return redirect(next_page or url_for('main.index'))
        flash('Invalid username or password.', 'danger')
    return render_template('login.html')


@auth_bp.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('auth.login'))


# ---------------------------------------------------------------------------
# Admin — Users
# ---------------------------------------------------------------------------

@auth_bp.route('/admin/users')
@require_role('admin')
def admin_users():
    users = User.query.order_by(User.username).all()
    employees = Employee.query.filter_by(active=True).order_by(Employee.name).all()
    return render_template('admin/users.html', users=users, employees=employees)


@auth_bp.route('/admin/users/add', methods=['POST'])
@require_role('admin')
def admin_users_add():
    username = request.form.get('username', '').strip().lower()
    display_name = request.form.get('display_name', '').strip()
    email = request.form.get('email', '').strip()
    password = request.form.get('password', '')
    role = request.form.get('role', 'site')
    employee_id = request.form.get('employee_id', '').strip() or None
    if role not in VALID_ROLES:
        role = 'site'
    if not username or not password:
        flash('Username and password are required.', 'danger')
        return redirect(url_for('auth.admin_users'))
    if User.query.filter_by(username=username).first():
        flash(f'Username "{username}" is already taken.', 'danger')
        return redirect(url_for('auth.admin_users'))
    user = User(
        username=username,
        display_name=display_name or username,
        email=email or None,
        password_hash=generate_password_hash(password),
        role=role,
        is_admin=(role == 'admin'),
        employee_id=int(employee_id) if employee_id else None,
        active=True,
    )
    db.session.add(user)
    db.session.commit()
    flash(f'User "{username}" created successfully.', 'success')
    return redirect(url_for('auth.admin_users'))


@auth_bp.route('/admin/users/<int:user_id>/toggle', methods=['POST'])
@require_role('admin')
def admin_users_toggle(user_id):
    user = User.query.get_or_404(user_id)
    if user.id == current_user.id:
        flash('You cannot deactivate your own account.', 'danger')
        return redirect(url_for('auth.admin_users'))
    user.active = not user.active
    db.session.commit()
    status = 'activated' if user.active else 'deactivated'
    flash(f'User "{user.username}" {status}.', 'success')
    return redirect(url_for('auth.admin_users'))


@auth_bp.route('/admin/users/<int:user_id>/reset-password', methods=['POST'])
@require_role('admin')
def admin_users_reset_password(user_id):
    user = User.query.get_or_404(user_id)
    new_password = request.form.get('new_password', '')
    if not new_password:
        flash('New password cannot be empty.', 'danger')
        return redirect(url_for('auth.admin_users'))
    user.password_hash = generate_password_hash(new_password)
    db.session.commit()
    flash(f'Password for "{user.username}" reset successfully.', 'success')
    return redirect(url_for('auth.admin_users'))


@auth_bp.route('/admin/users/<int:user_id>/toggle-admin', methods=['POST'])
@require_role('admin')
def admin_users_toggle_admin(user_id):
    flash('Admin status is now managed via Change Role. Please use that instead.', 'warning')
    return redirect(url_for('auth.admin_users'))


@auth_bp.route('/admin/users/<int:user_id>/change-role', methods=['POST'])
@require_role('admin')
def admin_users_change_role(user_id):
    user = User.query.get_or_404(user_id)
    if user.id == current_user.id:
        flash('You cannot change your own role.', 'danger')
        return redirect(url_for('auth.admin_users'))
    role = request.form.get('role', '').strip()
    if role not in VALID_ROLES:
        flash('Invalid role.', 'danger')
        return redirect(url_for('auth.admin_users'))
    user.role = role
    user.is_admin = (role == 'admin')
    db.session.commit()
    flash(f'Role for "{user.username}" changed to {role}.', 'success')
    return redirect(url_for('auth.admin_users'))


@auth_bp.route('/no-project')
def no_project():
    """Shown when a logged-in user has no project access assigned."""
    return render_template('no_project.html')


@auth_bp.route('/account/change-password', methods=['GET', 'POST'])
@require_role('admin', 'supervisor', 'site')
def change_password():
    """Allow any logged-in user to change their own password."""
    if request.method == 'POST':
        current_pw = request.form.get('current_password', '')
        new_pw = request.form.get('new_password', '')
        confirm_pw = request.form.get('confirm_password', '')
        if not check_password_hash(current_user.password_hash, current_pw):
            flash('Current password is incorrect.', 'danger')
        elif len(new_pw) < 6:
            flash('New password must be at least 6 characters.', 'danger')
        elif new_pw != confirm_pw:
            flash('New passwords do not match.', 'danger')
        else:
            current_user.password_hash = generate_password_hash(new_pw)
            db.session.commit()
            flash('Password changed successfully.', 'success')
            return redirect(url_for('main.index'))
    return render_template('change_password.html')
