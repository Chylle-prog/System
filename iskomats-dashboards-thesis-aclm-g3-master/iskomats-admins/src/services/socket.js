import { io } from 'socket.io-client';
import { SOCKET_URL } from './config';

class SocketService {
  constructor() {
    this.socket = null;
    this.handlers = new Map();
    this.userId = null;
    this.username = null;
  }

  connect(token) {
    if (this.socket) return;

    this.socket = io(SOCKET_URL, {
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

    this.socket.on('logged_in', (data) => {
      // Store user ID and username for message sending
      this.userId = data.id;
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
    this.emit('message', { 
      room, 
      username: providerName || username || this.username, 
      message,
      sender_id: this.userId,
      ...(providerName && { provider_name: providerName })
    });
  }

  loadHistory(room) {
    this.emit('load_history', { room });
  }

  startChat(applicantId, proNo) {
    this.emit('start_chat', { applicant_id: applicantId, pro_no: proNo });
  }
}

export const socketService = new SocketService();
export default socketService;
