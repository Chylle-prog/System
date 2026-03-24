from .admin import admin_bp, register_admin_routes, init_admin_socketio
from .student import register_student_routes, student_api_bp

__all__ = [
    'admin_bp',
    'init_admin_socketio',
    'register_admin_routes',
    'register_student_routes',
    'student_api_bp',
]