import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

class SocketService {
  constructor() {
    this.socket = null;
    this.subscribers = new Map();
    this.userId = null;
    this.username = null;
  }

  connect(token) {
    if (this.socket?.connected) return;

    this.socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      forceNew: true,
      withCredentials: true
    });

    this.socket.on('connect', () => {
      console.log('Connected to socket server');
      this.socket.emit('login', { token });
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from socket server');
    });

    this.socket.on('error', (err) => {
      console.error('Socket error:', err);
      this.notify('error', err);
    });

    this.socket.on('message', (data) => {
      console.log('Received message:', data);
      this.notify('message', data);
    });

    this.socket.on('logged_in', (data) => {
      console.log('Logged in successfully:', data);
      // Store user ID and username for message sending
      this.userId = data.id;
      this.username = data.name;
      this.notify('logged_in', data);
    });

    this.socket.on('add_room', (data) => {
      console.log('Joined room:', data);
      this.notify('add_room', data);
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
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Set());
    }
    this.subscribers.get(event).add(callback);
    return () => this.unsubscribe(event, callback);
  }

  unsubscribe(event, callback) {
    if (this.subscribers.has(event)) {
      this.subscribers.get(event).delete(callback);
    }
  }

  notify(event, data) {
    if (this.subscribers.has(event)) {
      this.subscribers.get(event).forEach(callback => callback(data));
    }
  }

  sendMessage(room, username, message) {
    if (this.socket?.connected) {
      this.socket.emit('message', { 
        room, 
        username: username || this.username, 
        message,
        sender_id: this.userId
      });
    }
  }

  loadHistory(room) {
    if (this.socket?.connected) {
      this.socket.emit('load_history', { room });
    }
  }

  startChat(applicantId, proNo) {
    if (this.socket?.connected) {
      this.socket.emit('start_chat', { applicant_id: applicantId, pro_no: proNo });
    }
  }
}

const socketService = new SocketService();
export default socketService;
