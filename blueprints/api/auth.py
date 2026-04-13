from flask import Blueprint, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt_identity,
    jwt_required,
)
from werkzeug.security import check_password_hash

from models import User

api_auth_bp = Blueprint('api_auth', __name__)


@api_auth_bp.route('/auth/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return {'error': 'Invalid username or password'}, 401

    user = User.query.filter_by(username=username).first()

    if not user or not check_password_hash(user.password_hash, password):
        return {'error': 'Invalid username or password'}, 401

    if not user.active:
        return {'error': 'Account is inactive'}, 403

    access_token = create_access_token(identity=str(user.id))
    refresh_token = create_refresh_token(identity=str(user.id))

    projects = [{'id': p.id, 'name': p.name, 'active': p.active, 'status': p.status, 'is_operational': p.is_operational} for p in user.accessible_projects()]

    return {
        'access_token': access_token,
        'refresh_token': refresh_token,
        'user': {
            'id': user.id,
            'username': user.username,
            'display_name': user.display_name,
            'role': user.role,
            'employee_id': user.employee_id,
            'accessible_projects': projects,
        },
    }, 200


@api_auth_bp.route('/auth/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    user_id = get_jwt_identity()
    access_token = create_access_token(identity=user_id)
    return {'access_token': access_token}, 200


@api_auth_bp.route('/auth/me', methods=['GET'])
@jwt_required()
def me():
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    if not user or not user.active:
        return {'error': 'User not found or inactive'}, 401

    projects = [{'id': p.id, 'name': p.name, 'active': p.active, 'status': p.status, 'is_operational': p.is_operational} for p in user.accessible_projects()]

    return {
        'id': user.id,
        'username': user.username,
        'display_name': user.display_name,
        'role': user.role,
        'employee_id': user.employee_id,
        'accessible_projects': projects,
    }, 200


@api_auth_bp.route('/auth/logout', methods=['POST'])
@jwt_required()
def logout():
    # JWT is stateless — logout is handled client-side by discarding the token.
    # True server-side revocation would require storing the token JTI in a blocklist
    # (e.g. Redis or a DB table) and checking it on every request.
    # TODO: Implement token blocklist for server-side revocation if needed.
    return {'message': 'Logged out successfully'}, 200
