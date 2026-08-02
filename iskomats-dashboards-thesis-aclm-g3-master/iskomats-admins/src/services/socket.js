import { io } from 'socket.io-client';
import { SOCKET_URL, resolveSocketUrl } from './config';

class SocketService {
  constructor() {
    this.socket = null;
    this.handlers = new Map();
    this.userId = null;
    this.username = null;
  }

  getUserIdFromToken(token = null) {
    try {
      const activeToken = token || localStorage.getItem('authToken');
      if (!activeToken) return null;
      const base64Url = activeToken.split('.')[1];
      if (!base64Url) return null;
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      const decoded = JSON.parse(jsonPayload);
      return decoded.user_id || decoded.user_no || decoded.id || null;
    } catch (e) {
      return null;
    }
  }

  connect(token) {
    if (!this.userId) {
      this.userId = this.getUserIdFromToken(token);
    }
    if (this.socket) {
      if (token && this.socket.connected) {
        this.socket.emit('login', { token });
      }
      return;
    }

    const socketUrl = resolveSocketUrl ? resolveSocketUrl() : SOCKET_URL;

    this.socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      console.log('Connected to socket server');
      this.socket.emit('login', { token });
    });

    this.socket.on('message', (data) => {
      this._notifyHandlers('message', data);
    });

    this.socket.on('history', (data) => {
      this._notifyHandlers('history', data);
    });

    this.socket.on('logged_in', (data) => {
      // Store user ID and username for message sending
      this.userId = data.id || this.getUserIdFromToken();
      this.username = data.name;
      this._notifyHandlers('logged_in', data);
    });

    this.socket.on('add_room', (data) => {
      this._notifyHandlers('add_room', data);
    });

    this.socket.on('account_change', (data) => {
      this._notifyHandlers('account_change', data);
    });

    this.socket.on('applicant_status_update', (data) => {
      this._notifyHandlers('applicant_status_update', data);
    });

    this.socket.on('scholarship_update', (data) => {
      this._notifyHandlers('scholarship_update', data);
    });

    this.socket.on('announcement_update', (data) => {
      this._notifyHandlers('announcement_update', data);
    });

    this.socket.on('announcement_notification', (data) => {
      this._notifyHandlers('announcement_notification', data);
    });

    this.socket.on('admin_message', (data) => {
      this._notifyHandlers('admin_message', data);
    });

    this.socket.on('admin_history', (data) => {
      this._notifyHandlers('admin_history', data);
    });

    this.socket.on('error', (data) => {
      this._notifyHandlers('error', data);
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from socket server');
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.userId = null;
      this.username = null;
    }
  }

  subscribe(event, callback) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event).add(callback);
    return () => this.unsubscribe(event, callback);
  }

  // Helper to subscribe and listen for scholarship updates
  onScholarshipUpdate(callback) {
    return this.subscribe('scholarship_update', callback);
  }

  onAnnouncementUpdate(callback) {
    return this.subscribe('announcement_update', callback);
  }

  onAnnouncementNotification(callback) {
    return this.subscribe('announcement_notification', callback);
  }

  unsubscribe(event, callback) {
    if (this.handlers.has(event)) {
      this.handlers.get(event).delete(callback);
    }
  }

  _notifyHandlers(event, data) {
    if (this.handlers.has(event)) {
      this.handlers.get(event).forEach(callback => callback(data));
    }
  }

  emit(event, data) {
    if (this.socket) {
      this.socket.emit(event, data);
    }
  }

  sendMessage(room, username, message, providerName = null) {
    const resolvedSenderId = this.userId || this.getUserIdFromToken();
    this.emit('message', { 
      room, 
      username: providerName || username || this.username, 
      message,
      sender_id: resolvedSenderId,
      ...(providerName && { provider_name: providerName })
    });
  }

  loadHistory(room) {
    this.emit('load_history', { room });
  }

  startChat(applicantId, proNo) {
    this.emit('start_chat', { applicant_id: applicantId, pro_no: proNo });
  }

  sendAdminMessage(room, message, senderId = null) {
    const resolvedSenderId = senderId || this.userId || this.getUserIdFromToken();
    console.log('[SOCKET] sendAdminMessage:', { room, message, sender_id: resolvedSenderId });
    this.emit('admin_message', {
      room,
      message,
      sender_id: resolvedSenderId,
    });
  }

  loadAdminHistory(room) {
    this.emit('load_admin_history', { room });
  }
}

export const socketService = new SocketService();
export default socketService;
