// Socket.io singleton wrapper
const socket = io();

const SocketClient = {
  emit(event, data) {
    socket.emit(event, data);
  },

  on(event, callback) {
    socket.on(event, callback);
  },

  off(event, callback) {
    socket.off(event, callback);
  },

  get id() {
    return socket.id;
  },

  get connected() {
    return socket.connected;
  }
};

export default SocketClient;
