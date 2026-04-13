import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from functools import wraps

from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app
from flask_login import login_user, logout_user, current_user
from werkzeug.security import check_password_hash, generate_password_hash
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature

from models import db, User, Employee, UserProjectAccess, DeviceToken

auth_bp = Blueprint('auth', __name__)

VALID_ROLES = ('admin', 'supervisor', 'site')


def require_role(*roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            is_api = request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest'
            if not current_user.is_authenticated:
                if is_api:
                    return {'error': 'Unauthorised'}, 401
                return redirect(url_for('auth.login'))
            if current_user.role not in roles:
                if is_api:
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
# Password Reset
# ---------------------------------------------------------------------------

def _get_reset_serializer():
    return URLSafeTimedSerializer(current_app.config['SECRET_KEY'], salt='password-reset')


def _send_reset_email(user, token):
    from utils.settings import load_settings
    settings = load_settings()
    smtp_server = settings.get('smtp_server', 'smtp.gmail.com')
    smtp_port = int(settings.get('smtp_port', 587))
    smtp_user = settings.get('smtp_username', '')
    smtp_pass = settings.get('smtp_password', '')
    company = settings.get('company_name', 'Plytrack')

    if not smtp_user or not smtp_pass:
        return False

    reset_url = url_for('auth.reset_password', token=token, _external=True)

    msg = MIMEMultipart('alternative')
    msg['Subject'] = f'{company} — Password Reset'
    msg['From'] = smtp_user
    msg['To'] = user.email

    text = f"""Hi {user.display_name or user.username},

A password reset was requested for your {company} account.

Click this link to reset your password (expires in 1 hour):
{reset_url}

If you did not request this, you can ignore this email.

— {company}"""

    html = f"""<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px;">
<h2 style="color:#2F2F2F;">Password Reset</h2>
<p>Hi {user.display_name or user.username},</p>
<p>A password reset was requested for your <strong>{company}</strong> account.</p>
<p><a href="{reset_url}" style="display:inline-block;background:#FFB7C5;color:#2F2F2F;
padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">
Reset Password</a></p>
<p style="color:#888;font-size:13px;">This link expires in 1 hour. If you did not request this, ignore this email.</p>
<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
<p style="color:#aaa;font-size:11px;">{company}</p>
</div>"""

    msg.attach(MIMEText(text, 'plain'))
    msg.attach(MIMEText(html, 'html'))

    try:
        with smtplib.SMTP(smtp_server, smtp_port, timeout=10) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, user.email, msg.as_string())
        return True
    except Exception as e:
        current_app.logger.error(f'Failed to send reset email: {e}')
        return False


@auth_bp.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        if email:
            user = User.query.filter(db.func.lower(User.email) == email, User.active == True).first()
            if user and user.email:
                s = _get_reset_serializer()
                token = s.dumps(user.id)
                sent = _send_reset_email(user, token)
                if not sent:
                    flash('Email could not be sent. Contact your administrator to reset your password.', 'danger')
                    return render_template('forgot_password.html')
        # Always show success (don't reveal if email exists)
        flash('If an account with that email exists, a reset link has been sent.', 'success')
        return redirect(url_for('auth.login'))
    return render_template('forgot_password.html')


@auth_bp.route('/reset-password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    s = _get_reset_serializer()
    try:
        user_id = s.loads(token, max_age=3600)  # 1 hour
    except (SignatureExpired, BadSignature):
        flash('This reset link has expired or is invalid. Please request a new one.', 'danger')
        return redirect(url_for('auth.forgot_password'))

    user = User.query.get(user_id)
    if not user:
        flash('User not found.', 'danger')
        return redirect(url_for('auth.login'))

    if request.method == 'POST':
        password = request.form.get('password', '')
        confirm = request.form.get('confirm', '')
        if len(password) < 6:
            flash('Password must be at least 6 characters.', 'danger')
            return render_template('reset_password.html', token=token)
        if password != confirm:
            flash('Passwords do not match.', 'danger')
            return render_template('reset_password.html', token=token)
        user.password_hash = generate_password_hash(password)
        db.session.commit()
        flash('Password has been reset. You can now log in.', 'success')
        return redirect(url_for('auth.login'))

    return render_template('reset_password.html', token=token)


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


@auth_bp.route('/admin/users/<int:user_id>/delete', methods=['POST'])
@require_role('admin')
def admin_users_delete(user_id):
    user = User.query.get_or_404(user_id)
    if user.id == current_user.id:
        flash('You cannot delete your own account.', 'danger')
        return redirect(url_for('auth.admin_users'))
    if user.entries:
        flash(f'Cannot delete "{user.username}" — has submitted entries. Deactivate instead.', 'danger')
        return redirect(url_for('auth.admin_users'))
    # Clean up related data
    UserProjectAccess.query.filter_by(user_id=user.id).delete()
    DeviceToken.query.filter_by(user_id=user.id).delete()
    db.session.delete(user)
    db.session.commit()
    flash(f'User "{user.username}" deleted.', 'success')
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
