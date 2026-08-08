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

    try:
        from api_routes import get_all_messages_rest, handle_room_messages_rest
        app.add_url_rule('/api/messages/all', 'global_get_all_messages', get_all_messages_rest, methods=['GET'])
        app.add_url_rule('/api/messages/provider/<int:pro_no>', 'global_get_provider_messages', get_all_messages_rest, methods=['GET'])
        app.add_url_rule('/api/messages/<path:room_id>', 'global_handle_room_messages', handle_room_messages_rest, methods=['GET', 'POST'])
        print("[BACKEND] Successfully registered global /api/messages REST endpoints.", flush=True)
    except Exception as e:
        print(f"[BACKEND] Error registering global message rules: {e}", flush=True)