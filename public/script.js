const socket = io('/');
const videoGrid = document.getElementById('video-grid');
const myPeer = new Peer(undefined, {
  path: '/peerjs',
  host: '/',
  port: '443'
});

let myVideoStream;
const myVideo = document.createElement('video');
myVideo.muted = true;
const peers = {};
let isHost = IS_HOST;
let isRecording = false;
let raisedHand = false;
let screenStream = null;
let currentPinnedVideo = null;
let myPeerId = null;

// UI Elements
const muteButton = document.getElementById('muteButton');
const videoButton = document.getElementById('videoButton');
const screenShareButton = document.getElementById('screenShareButton');
const raiseHandButton = document.getElementById('raiseHandButton');
const recordButton = document.getElementById('recordButton');
const participantsButton = document.getElementById('participantsButton');
const chatMessageInput = document.getElementById('chat_message');
const messagesList = document.querySelector('.messages');
const recordingIndicator = document.getElementById('recordingIndicator');
const participantsList = document.getElementById('participantsTab');

// Initialize UI
if (isHost) {
  recordButton.classList.remove('disabled');
}

// Media setup
navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
}).then(stream => {
  myVideoStream = stream;
  addVideoStream(myVideo, stream, true);

  myPeer.on('call', call => {
    call.answer(stream);
    const video = document.createElement('video');
    const userId = call.peer;
    
    call.on('stream', userVideoStream => {
      addVideoStream(video, userVideoStream, false, userId);
    });
    
    call.on('close', () => {
      video.remove();
      removeParticipantUI(userId);
    });
  });

  socket.on('user-connected', userId => {
    connectToNewUser(userId, stream);
    updateParticipantsList();
  });

  // Handle incoming messages
  socket.on('createMessage', data => {
    appendMessage(data.userId, data.message, data.timestamp);
  });

  // Host controls
  socket.on('force-mute', () => {
    muteUnmute(true);
    showNotification('Host has muted your microphone');
  });

  socket.on('force-disable-video', () => {
    playStop(true);
    showNotification('Host has disabled your video');
  });

  socket.on('force-remove', () => {
    showNotification('You have been removed from the meeting');
    setTimeout(() => leaveMeeting(), 2000);
  });

  socket.on('made-cohost', () => {
    isHost = true;
    recordButton.classList.remove('disabled');
    showNotification('You have been made a co-host');
    updateParticipantsList();
  });

  socket.on('host-changed', newHostId => {
    if (newHostId === myPeer.id) {
      isHost = true;
      recordButton.classList.remove('disabled');
      showNotification('You are now the host');
    }
    updateParticipantsList();
  });

  // Raise hand
  socket.on('raise-hand-update', (userId, isRaised) => {
    updateRaiseHandUI(userId, isRaised);
  });

  // Recording
  socket.on('recording-started', () => {
    isRecording = true;
    recordingIndicator.style.display = 'block';
  });

  socket.on('recording-stopped', () => {
    isRecording = false;
    recordingIndicator.style.display = 'none';
  });

  // Screen sharing
  socket.on('screen-share-started', userId => {
    const videoContainer = document.querySelector(`[data-user="${userId}"]`);
    if (videoContainer) {
      videoContainer.classList.add('screen-sharing');
    }
  });

  socket.on('screen-share-stopped', () => {
    document.querySelectorAll('.screen-sharing').forEach(el => {
      el.classList.remove('screen-sharing');
    });
  });

  // Room state
  socket.on('room-state', state => {
    isHost = state.isHost;
    if (isHost) {
      recordButton.classList.remove('disabled');
    }
    state.raisedHands.forEach(userId => updateRaiseHandUI(userId, true));
    if (state.screenSharer) {
      document.querySelector(`[data-user="${state.screenSharer}"]`)?.classList.add('screen-sharing');
    }
    updateParticipantsList();
  });

  // Participant updates
  socket.on('user-muted', userId => {
    showNotification(`Participant ${userId.substring(0, 5)} has been muted`);
  });

  socket.on('video-disabled', userId => {
    showNotification(`Participant ${userId.substring(0, 5)}'s video has been disabled`);
  });

  socket.on('user-removed', userId => {
    showNotification(`Participant ${userId.substring(0, 5)} has been removed`);
  });

  socket.on('cohost-added', userId => {
    showNotification(`Participant ${userId.substring(0, 5)} has been made co-host`);
    updateParticipantsList();
  });
});

socket.on('user-disconnected', userId => {
  if (peers[userId]) peers[userId].close();
  removeParticipantUI(userId);
  updateParticipantsList();
});

myPeer.on('open', id => {
  myPeerId = id;
  socket.emit('join-room', ROOM_ID, id, isHost);
});

myPeer.on('error', err => {
  console.error('PeerJS error:', err);
  showNotification('Connection error. Please refresh the page.');
});

// Connection functions
function connectToNewUser(userId, stream) {
  const call = myPeer.call(userId, stream);
  const video = document.createElement('video');
  
  call.on('stream', userVideoStream => {
    addVideoStream(video, userVideoStream, false, userId);
  });
  
  call.on('close', () => {
    video.remove();
    removeParticipantUI(userId);
  });

  peers[userId] = call;
}

function addVideoStream(video, stream, isSelf = false, userId = null) {
  video.srcObject = stream;
  video.addEventListener('loadedmetadata', () => {
    video.play();
  });

  const videoContainer = document.createElement('div');
  videoContainer.className = 'video-container';
  videoContainer.setAttribute('data-user', userId || myPeer.id);
  
  if (isSelf) {
    videoContainer.classList.add('self-video');
    const info = document.createElement('div');
    info.className = 'participant-info';
    info.textContent = 'You';
    videoContainer.appendChild(info);
  } else if (userId) {
    const info = document.createElement('div');
    info.className = 'participant-info';
    info.textContent = `Participant ${userId.substring(0, 5)}`;
    videoContainer.appendChild(info);
  }

  if ((isHost || IS_HOST) && !isSelf) {
    const menu = document.createElement('div');
    menu.className = 'action-menu';
    menu.innerHTML = `
      <button onclick="showParticipantControls('${userId}')"><i class="fas fa-ellipsis-v"></i></button>
    `;
    videoContainer.appendChild(menu);
  }

  videoContainer.appendChild(video);
  videoGrid.appendChild(videoContainer);

  // Pin/unpin functionality
  videoContainer.addEventListener('click', () => {
    if (currentPinnedVideo === videoContainer) {
      videoContainer.classList.remove('pinned');
      currentPinnedVideo = null;
    } else {
      if (currentPinnedVideo) {
        currentPinnedVideo.classList.remove('pinned');
      }
      videoContainer.classList.add('pinned');
      currentPinnedVideo = videoContainer;
    }
  });

  // Track audio/video state
  const audioTrack = stream.getAudioTracks()[0];
  const videoTrack = stream.getVideoTracks()[0];

  if (audioTrack) {
    audioTrack.onended = () => {
      videoContainer.classList.add('muted');
    };
    audioTrack.onmute = () => {
      videoContainer.classList.add('muted');
    };
    audioTrack.onunmute = () => {
      videoContainer.classList.remove('muted');
    };
  }

  if (videoTrack) {
    videoTrack.onended = () => {
      videoContainer.classList.add('no-video');
    };
    videoTrack.onmute = () => {
      videoContainer.classList.add('no-video');
    };
    videoTrack.onunmute = () => {
      videoContainer.classList.remove('no-video');
    };
  }
}

function removeParticipantUI(userId) {
  const videoContainer = document.querySelector(`[data-user="${userId}"]`);
  if (videoContainer) {
    videoContainer.remove();
  }
  delete peers[userId];
  updateParticipantsList();
}

// Chat functions
function appendMessage(user, message, timestamp) {
  const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  const li = document.createElement('li');
  li.className = 'message';
  li.innerHTML = `
    <b>${user === 'You' ? 'You' : `Participant ${user.substring(0, 5)}`}</b>
    <span class="message-time">${time}</span><br/>
    ${message}
  `;
  messagesList.appendChild(li);
  scrollToBottom();
}

function sendMessage() {
  const message = chatMessageInput.value.trim();
  if (message) {
    socket.emit('message', message);
    appendMessage('You', message);
    chatMessageInput.value = '';
  }
}

chatMessageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

// Media control functions
function muteUnmute(forced = false) {
  const audioTrack = myVideoStream.getAudioTracks()[0];
  if (!audioTrack) return;

  const enabled = audioTrack.enabled;
  if (enabled || forced) {
    audioTrack.enabled = false;
    setUnmuteButton();
    if (forced) {
      showNotification('Your microphone has been muted by the host');
    }
  } else {
    setMuteButton();
    audioTrack.enabled = true;
  }
}

function playStop(forced = false) {
  const videoTrack = myVideoStream.getVideoTracks()[0];
  if (!videoTrack) return;

  const enabled = videoTrack.enabled;
  if (enabled || forced) {
    videoTrack.enabled = false;
    setPlayVideo();
    if (forced) {
      showNotification('Your video has been disabled by the host');
    }
  } else {
    setStopVideo();
    videoTrack.enabled = true;
  }
}

function setMuteButton() {
  muteButton.innerHTML = `
    <i class="fas fa-microphone"></i>
    <span>Mute</span>
  `;
}

function setUnmuteButton() {
  muteButton.innerHTML = `
    <i class="fas fa-microphone-slash"></i>
    <span>Unmute</span>
  `;
}

function setStopVideo() {
  videoButton.innerHTML = `
    <i class="fas fa-video"></i>
    <span>Stop Video</span>
  `;
}

function setPlayVideo() {
  videoButton.innerHTML = `
    <i class="fas fa-video-slash"></i>
    <span>Start Video</span>
  `;
}

// Screen sharing
async function shareScreen() {
  try {
    if (screenStream) {
      // Stop screen sharing
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
      screenShareButton.innerHTML = `
        <i class="fas fa-desktop"></i>
        <span>Share Screen</span>
      `;
      socket.emit('stop-screen-share');
      return;
    }

    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });

    screenShareButton.innerHTML = `
      <i class="fas fa-times"></i>
      <span>Stop Sharing</span>
    `;
    socket.emit('start-screen-share');

    // Replace video track
    const videoTrack = screenStream.getVideoTracks()[0];
    const oldVideoTrack = myVideoStream.getVideoTracks()[0];
    
    myVideoStream.removeTrack(oldVideoTrack);
    myVideoStream.addTrack(videoTrack);
    oldVideoTrack.stop();

    // Update all peer connections
    Object.values(peers).forEach(peer => {
      const sender = peer.peerConnection.getSenders().find(s => s.track.kind === 'video');
      sender.replaceTrack(videoTrack);
    });

    // Handle when user stops screen sharing
    videoTrack.onended = () => {
      shareScreen();
    };
  } catch (err) {
    console.error('Screen sharing error:', err);
    showNotification('Screen sharing failed');
  }
}

// Raise hand
function toggleRaiseHand() {
  raisedHand = !raisedHand;
  socket.emit('raise-hand', raisedHand);
  
  if (raisedHand) {
    raiseHandButton.classList.add('active');
    raiseHandButton.innerHTML = `<i class="fas fa-hand-paper"></i><span>Lower Hand</span>`;
  } else {
    raiseHandButton.classList.remove('active');
    raiseHandButton.innerHTML = `<i class="fas fa-hand-paper"></i><span>Raise Hand</span>`;
  }
}

function updateRaiseHandUI(userId, isRaised) {
  const videoContainer = document.querySelector(`[data-user="${userId}"]`);
  if (videoContainer) {
    const handIndicator = videoContainer.querySelector('.raise-hand');
    if (isRaised) {
      if (!handIndicator) {
        const handEl = document.createElement('div');
        handEl.className = 'raise-hand';
        handEl.innerHTML = '<i class="fas fa-hand-paper"></i>';
        videoContainer.appendChild(handEl);
      }
    } else if (handIndicator) {
      handIndicator.remove();
    }
  }
}

// Recording
function startRecording() {
  if (!isHost) return;
  
  isRecording = !isRecording;
  
  if (isRecording) {
    recordButton.innerHTML = `<i class="fas fa-stop"></i><span>Stop Recording</span>`;
    socket.emit('start-recording');
  } else {
    recordButton.innerHTML = `<i class="fas fa-record-vinyl"></i><span>Record</span>`;
    socket.emit('stop-recording');
  }
}

// Participant management
function updateParticipantsList() {
  participantsList.innerHTML = '';
  
  // Add self first
  const selfItem = document.createElement('div');
  selfItem.className = 'participant-item';
  selfItem.innerHTML = `
    <span>You ${isHost ? '(Host)' : ''}</span>
    <div class="participant-controls">
      ${isHost ? '<i class="fas fa-crown"></i>' : ''}
    </div>
  `;
  participantsList.appendChild(selfItem);
  
  // Add other participants
  Object.keys(peers).forEach(userId => {
    const participant = document.createElement('div');
    participant.className = 'participant-item';
    participant.innerHTML = `
      <span>Participant ${userId.substring(0, 5)}</span>
      <div class="participant-controls">
        ${isHost ? `<button onclick="showParticipantControls('${userId}')"><i class="fas fa-ellipsis-v"></i></button>` : ''}
      </div>
    `;
    participantsList.appendChild(participant);
  });
}

function showParticipantControls(userId) {
  if (!isHost) return;
  
  const content = document.getElementById('participantControlsContent');
  content.innerHTML = `
    <h4>Controls for Participant ${userId.substring(0, 5)}</h4>
    <div class="control-options">
      <button onclick="muteParticipant('${userId}')">Mute Audio</button>
      <button onclick="disableVideo('${userId}')">Disable Video</button>
      <button onclick="removeParticipant('${userId}')">Remove Participant</button>
      <button onclick="makeCoHost('${userId}')">Make Co-Host</button>
    </div>
  `;
  document.getElementById('hostControlsModal').style.display = 'flex';
}

function muteParticipant(userId) {
  if (!isHost) return;
  socket.emit('mute-user', userId);
}

function disableVideo(userId) {
  if (!isHost) return;
  socket.emit('disable-video', userId);
}

function removeParticipant(userId) {
  if (!isHost) return;
  if (confirm(`Are you sure you want to remove participant ${userId.substring(0, 5)}?`)) {
    socket.emit('remove-user', userId);
  }
}

function makeCoHost(userId) {
  if (!isHost) return;
  socket.emit('make-cohost', userId);
}

// Meeting controls
function leaveMeeting() {
  document.getElementById('confirmLeaveModal').style.display = 'flex';
}

function confirmLeave() {
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
  }
  if (myVideoStream) {
    myVideoStream.getTracks().forEach(track => track.stop());
  }
  socket.emit('leave-room');
  window.location.href = "/";
}

function toggleParticipants() {
  switchTab('participants');
  updateParticipantsList();
}

function switchTab(tabName) {
  document.getElementById('chatTab').style.display = 'none';
  document.getElementById('participantsTab').style.display = 'none';
  document.getElementById('filesTab').style.display = 'none';
  
  document.getElementById(tabName + 'Tab').style.display = 'block';
  
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.toLowerCase().includes(tabName)) {
      btn.classList.add('active');
    }
  });
}

// Helper functions
function scrollToBottom() {
  const chatWindow = document.querySelector('.main__chat_window');
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl+M for mute/unmute
  if (e.ctrlKey && e.key === 'm') {
    muteUnmute();
  }
  // Ctrl+H for raise hand
  if (e.ctrlKey && e.key === 'h') {
    toggleRaiseHand();
  }
  // Ctrl+E for end call (host only)
  if (e.ctrlKey && e.key === 'e' && isHost) {
    leaveMeeting();
  }
  // Ctrl+Enter to send message
  if (e.ctrlKey && e.key === 'Enter') {
    sendMessage();
  }
});