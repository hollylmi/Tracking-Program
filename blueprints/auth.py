from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_user, logout_user, login_required, current_user
from werkzeug.security import check_password_hash, generate_password_hash

from models import db, User

auth_bp = Blueprint('auth', __name__)


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        user = User.query.filter_by(username=username).first()
        if user and user.active and check_password_hash(user.password_hash, password):
            login_user(user, remember=request.form.get('remember') == 'on')
            next_page = request.args.get('next')
            return redirect(next_page or url_for('index'))
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
def admin_users():
    if not current_user.is_admin:
        flash('Admin access required.', 'danger')
        return redirect(url_for('index'))
    users = User.query.order_by(User.username).all()
    return render_template('admin/users.html', users=users)


@auth_bp.route('/admin/users/add', methods=['POST'])
def admin_users_add():
    if not current_user.is_admin:
        flash('Admin access required.', 'danger')
        return redirect(url_for('index'))
    username = request.form.get('username', '').strip().lower()
    display_name = request.form.get('display_name', '').strip()
    email = request.form.get('email', '').strip()
    password = request.form.get('password', '')
    is_admin = request.form.get('is_admin') == 'on'
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
        is_admin=is_admin,
        active=True,
    )
    db.session.add(user)
    db.session.commit()
    flash(f'User "{username}" created successfully.', 'success')
    return redirect(url_for('auth.admin_users'))


@auth_bp.route('/admin/users/<int:user_id>/toggle', methods=['POST'])
def admin_users_toggle(user_id):
    if not current_user.is_admin:
        flash('Admin access required.', 'danger')
        return redirect(url_for('index'))
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
def admin_users_reset_password(user_id):
    if not current_user.is_admin:
        flash('Admin access required.', 'danger')
        return redirect(url_for('index'))
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
def admin_users_toggle_admin(user_id):
    if not current_user.is_admin:
        flash('Admin access required.', 'danger')
        return redirect(url_for('index'))
    user = User.query.get_or_404(user_id)
    if user.id == current_user.id:
        flash('You cannot change your own admin status.', 'danger')
        return redirect(url_for('auth.admin_users'))
    user.is_admin = not user.is_admin
    db.session.commit()
    status = 'granted admin' if user.is_admin else 'removed admin from'
    flash(f'Successfully {status} "{user.username}".', 'success')
    return redirect(url_for('auth.admin_users'))


@auth_bp.route('/account/change-password', methods=['GET', 'POST'])
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
            return redirect(url_for('index'))
    return render_template('change_password.html')
