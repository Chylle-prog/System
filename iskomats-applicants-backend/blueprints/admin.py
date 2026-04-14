import os

from flask import jsonify, redirect

from api_routes import api_bp as admin_bp, init_socketio as init_admin_socketio


def register_admin_routes(app):
    @app.route('/admin')
    def admin_index():
        admin_frontend_url = os.environ.get('ADMIN_FRONTEND_URL', '').strip()
        if admin_frontend_url:
            return redirect(admin_frontend_url)

        return jsonify({
            'service': 'iskomats-admin-frontend',
            'status': 'configure ADMIN_FRONTEND_URL to redirect to the hosted dashboard',
        }), 200