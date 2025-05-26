const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const { ExpressPeerServer } = require('peer');
const { v4: uuidV4 } = require('uuid');
const path = require('path');

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/peerjs'
});

// Room structure: { roomId: { hostId, coHosts, participants, isRecording, raisedHands, screenSharer } }
const rooms = {};

app.use('/peerjs', peerServer);
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect(`/${uuidV4()}`);
});

app.get('/:room', (req, res) => {
  const roomId = req.params.room;
  const isHost = !rooms[roomId];
  res.render('room', { roomId, isHost });
});

io.on('connection', (socket) => {
  socket.on('join-room', (roomId, peerId, isHost) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        hostId: peerId,
        coHosts: [],
        participants: [],
        isRecording: false,
        raisedHands: [],
        screenSharer: null
      };
    } else if (isHost) {
      isHost = false;
    }

    rooms[roomId].participants.push(peerId);
    socket.join(roomId);
    socket.to(roomId).emit('user-connected', peerId);

    socket.emit('room-state', {
      isHost: rooms[roomId].hostId === peerId || rooms[roomId].coHosts.includes(peerId),
      isRecording: rooms[roomId].isRecording,
      participants: rooms[roomId].participants,
      raisedHands: rooms[roomId].raisedHands,
      screenSharer: rooms[roomId].screenSharer
    });

    // Message handling
    socket.on('message', (message) => {
      io.to(roomId).emit('createMessage', {
        userId: peerId,
        message: message,
        timestamp: new Date().toISOString()
      });
    });

    // Screen sharing
    socket.on('start-screen-share', () => {
      rooms[roomId].screenSharer = peerId;
      io.to(roomId).emit('screen-share-started', peerId);
    });

    socket.on('stop-screen-share', () => {
      if (rooms[roomId].screenSharer === peerId) {
        rooms[roomId].screenSharer = null;
        io.to(roomId).emit('screen-share-stopped');
      }
    });

    // Host controls
    const isPrivileged = () => rooms[roomId] && 
      (rooms[roomId].hostId === peerId || rooms[roomId].coHosts.includes(peerId));

    socket.on('mute-user', (targetPeerId) => {
      if (isPrivileged()) {
        io.to(targetPeerId).emit('force-mute');
        io.to(roomId).emit('user-muted', targetPeerId);
      }
    });

    socket.on('disable-video', (targetPeerId) => {
      if (isPrivileged()) {
        io.to(targetPeerId).emit('force-disable-video');
        io.to(roomId).emit('video-disabled', targetPeerId);
      }
    });

    socket.on('remove-user', (targetPeerId) => {
      if (isPrivileged()) {
        io.to(targetPeerId).emit('force-remove');
        rooms[roomId].participants = rooms[roomId].participants.filter(id => id !== targetPeerId);
        io.to(roomId).emit('user-removed', targetPeerId);
      }
    });

    socket.on('make-cohost', (targetPeerId) => {
      if (rooms[roomId] && rooms[roomId].hostId === peerId && !rooms[roomId].coHosts.includes(targetPeerId)) {
        rooms[roomId].coHosts.push(targetPeerId);
        io.to(targetPeerId).emit('made-cohost');
        io.to(roomId).emit('cohost-added', targetPeerId);
      }
    });

    // Raise hand
    socket.on('raise-hand', (isRaised) => {
      if (isRaised) {
        if (!rooms[roomId].raisedHands.includes(peerId)) {
          rooms[roomId].raisedHands.push(peerId);
        }
      } else {
        rooms[roomId].raisedHands = rooms[roomId].raisedHands.filter(id => id !== peerId);
      }
      io.to(roomId).emit('raise-hand-update', peerId, isRaised);
    });

    // Recording
    socket.on('start-recording', () => {
      if (isPrivileged() && !rooms[roomId].isRecording) {
        rooms[roomId].isRecording = true;
        io.to(roomId).emit('recording-started');
      }
    });

    socket.on('stop-recording', () => {
      if (isPrivileged() && rooms[roomId].isRecording) {
        rooms[roomId].isRecording = false;
        io.to(roomId).emit('recording-stopped');
      }
    });

    // Disconnect handler
    socket.on('disconnect', () => {
      if (!rooms[roomId]) return;

      socket.to(roomId).emit('user-disconnected', peerId);
      rooms[roomId].participants = rooms[roomId].participants.filter(id => id !== peerId);
      rooms[roomId].raisedHands = rooms[roomId].raisedHands.filter(id => id !== peerId);
      rooms[roomId].coHosts = rooms[roomId].coHosts.filter(id => id !== peerId);

      if (rooms[roomId].screenSharer === peerId) {
        rooms[roomId].screenSharer = null;
        io.to(roomId).emit('screen-share-stopped');
      }

      if (peerId === rooms[roomId].hostId) {
        if (rooms[roomId].participants.length > 0) {
          const newHostId = rooms[roomId].coHosts.length > 0 
            ? rooms[roomId].coHosts[0]
            : rooms[roomId].participants[0];
          
          rooms[roomId].hostId = newHostId;
          rooms[roomId].coHosts = rooms[roomId].coHosts.filter(id => id !== newHostId);
          io.to(newHostId).emit('made-cohost');
          io.to(roomId).emit('host-changed', newHostId);
        } else {
          delete rooms[roomId];
        }
      }
    });

    socket.on('leave-room', () => {
      if (!rooms[roomId]) return;
      
      socket.to(roomId).emit('user-disconnected', peerId);
      rooms[roomId].participants = rooms[roomId].participants.filter(id => id !== peerId);
      rooms[roomId].raisedHands = rooms[roomId].raisedHands.filter(id => id !== peerId);
      rooms[roomId].coHosts = rooms[roomId].coHosts.filter(id => id !== peerId);

      if (rooms[roomId].screenSharer === peerId) {
        rooms[roomId].screenSharer = null;
        io.to(roomId).emit('screen-share-stopped');
      }
    });
  });
});

server.listen(process.env.PORT || 3031, () => {
  console.log(`Server running on port ${process.env.PORT || 3031}`);
});