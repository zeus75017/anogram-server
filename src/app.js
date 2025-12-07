const { ipcRenderer } = require('electron');
const io = require('socket.io-client');

// ========== CONFIGURATION DU SERVEUR ==========
const SERVER_URL = 'https://anogram-server.onrender.com';

let API_URL = SERVER_URL;
let socket = null;
let currentUser = null;
let currentConversationId = null;
let conversations = [];
let contacts = [];
let typingTimeout = null;
let selectedGroupMembers = [];
let groupAvatarFile = null;
let currentCall = null;
let callTimer = null;
let callDuration = 0;
let selectedMessageId = null;
let selectedMessageIsSaved = false;
let channelAvatarFile = null;
let editGroupAvatarFile = null;
let currentGroupInfo = null;
let isAdmin = false;
let pendingUpdateVersion = null;

// Voice Recording Variables
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimer = null;
let isRecording = false;

// ==================== AUTO UPDATE ====================
function setupUpdateHandlers() {
  const updateBanner = document.getElementById('updateBanner');
  const updateTitle = document.getElementById('updateTitle');
  const updateVersion = document.getElementById('updateVersion');
  const updateDownloadBtn = document.getElementById('updateDownloadBtn');
  const updateLaterBtn = document.getElementById('updateLaterBtn');
  const updateProgress = document.getElementById('updateProgress');
  const updateProgressFill = document.getElementById('updateProgressFill');
  const updateProgressText = document.getElementById('updateProgressText');
  const updateIcon = updateBanner?.querySelector('.update-icon');

  // Mise à jour disponible
  ipcRenderer.on('update-available', (event, data) => {
    console.log('Mise à jour disponible:', data.version);
    pendingUpdateVersion = data.version;

    if (updateBanner) {
      updateBanner.classList.remove('hidden', 'ready');
      updateTitle.textContent = 'Nouvelle version disponible';
      updateVersion.textContent = `v${data.version}`;
      updateDownloadBtn.textContent = 'Mettre à jour';
      updateDownloadBtn.style.display = 'block';
      updateProgress.classList.add('hidden');
      if (updateIcon) updateIcon.innerHTML = '<i class="fas fa-download"></i>';
    }
  });

  // Progression du téléchargement
  ipcRenderer.on('update-progress', (event, data) => {
    console.log('Progression:', data.percent + '%');

    if (updateBanner) {
      updateProgress.classList.remove('hidden');
      updateProgressFill.style.width = `${data.percent}%`;
      updateProgressText.textContent = `${data.percent}%`;
      updateDownloadBtn.style.display = 'none';
      updateTitle.textContent = 'Téléchargement en cours...';
      if (updateIcon) {
        updateIcon.classList.add('downloading');
        updateIcon.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i>';
      }
    }
  });

  // Mise à jour téléchargée
  ipcRenderer.on('update-downloaded', (event, data) => {
    console.log('Mise à jour prête:', data.version);

    if (updateBanner) {
      updateBanner.classList.add('ready');
      updateTitle.textContent = 'Mise à jour prête';
      updateVersion.textContent = `v${data.version} - Redémarrez pour installer`;
      updateDownloadBtn.textContent = 'Redémarrer';
      updateDownloadBtn.style.display = 'block';
      updateProgress.classList.add('hidden');
      if (updateIcon) {
        updateIcon.classList.remove('downloading');
        updateIcon.innerHTML = '<i class="fas fa-check"></i>';
      }
    }
  });

  // Bouton de téléchargement/installation
  if (updateDownloadBtn) {
    updateDownloadBtn.addEventListener('click', () => {
      if (updateDownloadBtn.textContent === 'Redémarrer') {
        ipcRenderer.send('install-update');
      } else {
        ipcRenderer.send('download-update');
        updateDownloadBtn.style.display = 'none';
        updateTitle.textContent = 'Préparation du téléchargement...';
      }
    });
  }

  // Bouton fermer
  if (updateLaterBtn) {
    updateLaterBtn.addEventListener('click', () => {
      updateBanner.classList.add('hidden');
    });
  }
}

// Afficher la version actuelle dans les paramètres
async function displayAppVersion() {
  try {
    const version = await ipcRenderer.invoke('get-app-version');
    const versionElement = document.getElementById('appVersionText');
    if (versionElement) {
      versionElement.textContent = `Version ${version}`;
    }
  } catch (e) {
    console.log('Erreur récupération version:', e);
  }
}

// Admin check function - définie tôt pour être accessible partout
async function checkAdminStatus() {
  try {
    const response = await fetch(`${API_URL}/api/admin/check`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (response.ok) {
      const data = await response.json();
      isAdmin = data.isAdmin;
      console.log('Admin status:', isAdmin);

      const menuAdmin = document.getElementById('menuAdmin');
      if (menuAdmin) {
        menuAdmin.style.display = isAdmin ? 'flex' : 'none';
        console.log('Menu admin display:', isAdmin ? 'flex' : 'none');
      }
    }
  } catch (error) {
    console.error('Erreur vérification admin:', error);
  }
}

// ==================== DOM ELEMENTS ====================
const authContainer = document.getElementById('authContainer');
const appContainer = document.getElementById('appContainer');
const loginPage = document.getElementById('loginPage');
const registerPage = document.getElementById('registerPage');

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginError = document.getElementById('loginError');
const registerError = document.getElementById('registerError');
const showRegister = document.getElementById('showRegister');
const showLogin = document.getElementById('showLogin');

const menuBtn = document.getElementById('menuBtn');
const sidebarMenu = document.getElementById('sidebarMenu');
const chatsContainer = document.getElementById('chatsContainer');
const chatPlaceholder = document.getElementById('chatPlaceholder');
const chatContent = document.getElementById('chatContent');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const searchInput = document.getElementById('searchInput');
const newChatBtn = document.getElementById('newChatBtn');

const currentChatAvatar = document.getElementById('currentChatAvatar');
const currentChatAvatarPlaceholder = document.getElementById('currentChatAvatarPlaceholder');
const currentChatName = document.getElementById('currentChatName');
const currentChatStatus = document.getElementById('currentChatStatus');

const menuAvatarImg = document.getElementById('menuAvatarImg');
const menuAvatarPlaceholder = document.getElementById('menuAvatarPlaceholder');
const menuUserName = document.getElementById('menuUserName');
const menuUserPhone = document.getElementById('menuUserPhone');
const menuLogout = document.getElementById('menuLogout');
const menuSettings = document.getElementById('menuSettings');
const menuNewGroup = document.getElementById('menuNewGroup');
const menuContacts = document.getElementById('menuContacts');
const menuCalls = document.getElementById('menuCalls');
const menuSaved = document.getElementById('menuSaved');
const menuAdmin = document.getElementById('menuAdmin');

// Window controls
const setupWindowControls = (prefix = '') => {
  const minimizeBtn = document.getElementById(`minimizeBtn${prefix}`);
  const maximizeBtn = document.getElementById(`maximizeBtn${prefix}`);
  const closeBtn = document.getElementById(`closeBtn${prefix}`);

  if (minimizeBtn) minimizeBtn.addEventListener('click', () => ipcRenderer.send('minimize-window'));
  if (maximizeBtn) maximizeBtn.addEventListener('click', () => ipcRenderer.send('maximize-window'));
  if (closeBtn) closeBtn.addEventListener('click', () => ipcRenderer.send('close-window'));
};

setupWindowControls('Auth');
setupWindowControls('');

// ==================== API FUNCTIONS ====================
async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` })
  };

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: { ...headers, ...options.headers }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erreur serveur');
    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// ==================== AUTH FUNCTIONS ====================
async function login(loginInput, password) {
  const data = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: loginInput, password })
  });
  localStorage.setItem('token', data.token);
  currentUser = data.user;
  showApp();
  connectSocket();
  checkAdminStatus();
}

async function register(displayName, username, phone, password) {
  const data = await apiRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ displayName, username, phone, password })
  });
  localStorage.setItem('token', data.token);
  currentUser = data.user;
  showApp();
  connectSocket();
  checkAdminStatus();
}

async function verifyToken() {
  try {
    const data = await apiRequest('/api/auth/verify');
    currentUser = data.user;
    showApp();
    connectSocket();
    checkAdminStatus();
    return true;
  } catch (error) {
    localStorage.removeItem('token');
    return false;
  }
}

function logout() {
  localStorage.removeItem('token');
  currentUser = null;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  showAuth();
}

// ==================== SOCKET FUNCTIONS ====================
function connectSocket() {
  const token = localStorage.getItem('token');
  if (!token) return;

  socket = io(API_URL, { auth: { token } });

  socket.on('connect', () => {
    console.log('Socket connecté');
    loadConversations();
    loadContacts();
  });

  socket.on('new_message', handleNewMessage);
  socket.on('user_status', (data) => updateUserStatus(data.userId, data.status, data.lastSeen));
  socket.on('user_typing', (data) => { if (data.conversationId === currentConversationId) showTypingIndicator(); });
  socket.on('user_stop_typing', (data) => { if (data.conversationId === currentConversationId) hideTypingIndicator(); });
  socket.on('messages_read', (data) => { if (data.conversationId === currentConversationId) markMessagesAsRead(); });

  // Appels
  socket.on('incoming_call', handleIncomingCall);
  socket.on('call_answered', handleCallAnswered);
  socket.on('call_ended', handleCallEnded);

  socket.on('disconnect', () => console.log('Socket déconnecté'));
}

// ==================== UI FUNCTIONS ====================
function showAuth() {
  authContainer.classList.remove('hidden');
  appContainer.classList.add('hidden');
}

function showApp() {
  authContainer.classList.add('hidden');
  appContainer.classList.remove('hidden');
  updateMenuProfile();
}

function updateMenuProfile() {
  if (!currentUser) return;
  menuUserName.textContent = currentUser.displayName;
  menuUserPhone.textContent = currentUser.phone;
  updateAvatar(menuAvatarImg, menuAvatarPlaceholder, currentUser.avatar);
}

function updateAvatar(imgElement, placeholderElement, avatarUrl) {
  if (avatarUrl) {
    const fullUrl = avatarUrl.startsWith('http') ? avatarUrl : API_URL + avatarUrl;
    // Garder l'image cachée et le placeholder visible jusqu'au chargement
    imgElement.style.display = 'none';
    placeholderElement.style.display = 'flex';
    imgElement.onerror = function() {
      this.style.display = 'none';
      placeholderElement.style.display = 'flex';
    };
    imgElement.onload = function() {
      this.style.display = 'block';
      placeholderElement.style.display = 'none';
    };
    imgElement.src = fullUrl;
  } else {
    imgElement.style.display = 'none';
    placeholderElement.style.display = 'flex';
  }
}

// ==================== CONVERSATIONS ====================
async function loadConversations() {
  try {
    const data = await apiRequest('/api/conversations');
    conversations = data.conversations;
    renderConversations();
  } catch (error) {
    console.error('Erreur chargement conversations:', error);
  }
}

function renderConversations() {
  if (conversations.length === 0) {
    chatsContainer.innerHTML = `<div class="no-chats"><i class="fas fa-comments"></i><p>Aucune discussion</p></div>`;
    return;
  }

  chatsContainer.innerHTML = '';
  conversations.forEach(conv => {
    const chatItem = document.createElement('div');
    chatItem.className = `chat-item ${conv.id === currentConversationId ? 'active' : ''}`;
    chatItem.dataset.id = conv.id;

    const lastMessageText = conv.lastMessage ? conv.lastMessage.content : 'Aucun message';
    const lastMessageTime = conv.lastMessage ? formatTime(conv.lastMessage.createdAt) : '';
    const isGroup = conv.type === 'group';
    const isChannel = conv.type === 'channel';
    const iconClass = isChannel ? 'bullhorn' : (isGroup ? 'users' : 'user');

    chatItem.innerHTML = `
      <div class="user-avatar">
        ${conv.avatar
          ? `<img src="${conv.avatar.startsWith('http') ? conv.avatar : API_URL + conv.avatar}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'avatar-placeholder\\'><i class=\\'fas fa-${iconClass}\\'></i></div>';">`
          : `<div class="avatar-placeholder"><i class="fas fa-${iconClass}"></i></div>`}
      </div>
      ${!isGroup && !isChannel && conv.status === 'online' ? '<div class="online-indicator"></div>' : ''}
      <div class="chat-info">
        <div class="chat-top-row">
          <span class="chat-name">${isChannel ? '📢 ' : ''}${conv.name || 'Discussion'}</span>
          <span class="chat-time">${lastMessageTime}</span>
        </div>
        <div class="chat-bottom-row">
          <span class="chat-preview">${lastMessageText}</span>
          ${conv.unreadCount > 0 ? `<span class="unread-badge">${conv.unreadCount}</span>` : ''}
        </div>
      </div>
    `;

    chatItem.addEventListener('click', () => openConversation(conv.id));
    chatsContainer.appendChild(chatItem);
  });
}

async function openConversation(conversationId) {
  currentConversationId = conversationId;
  const conv = conversations.find(c => c.id === conversationId);
  if (!conv) return;

  document.querySelectorAll('.chat-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === conversationId);
  });

  chatPlaceholder.style.display = 'none';
  chatContent.style.display = 'flex';

  currentChatName.textContent = (conv.type === 'channel' ? '📢 ' : '') + (conv.name || 'Discussion');

  if (conv.type === 'group') {
    currentChatStatus.textContent = `${conv.participants?.length || 0} membres`;
  } else if (conv.type === 'channel') {
    currentChatStatus.textContent = `${conv.participants?.length || 0} abonnés`;
  } else {
    currentChatStatus.textContent = conv.status === 'online' ? 'en ligne' :
      (conv.status === 'hidden' ? 'vu récemment' : formatLastSeen(conv.lastSeen));
  }
  currentChatStatus.classList.toggle('offline', conv.status !== 'online');

  const iconClass = conv.type === 'channel' ? 'bullhorn' : (conv.type === 'group' ? 'users' : 'user');
  updateAvatar(currentChatAvatar, currentChatAvatarPlaceholder, conv.avatar);
  if (!conv.avatar) {
    currentChatAvatarPlaceholder.innerHTML = `<i class="fas fa-${iconClass}"></i>`;
  }

  await loadMessages(conversationId);

  if (socket) socket.emit('mark_read', { conversationId });
  conv.unreadCount = 0;
  renderConversations();
}

async function loadMessages(conversationId) {
  try {
    const data = await apiRequest(`/api/conversations/${conversationId}/messages`);
    renderMessages(data.messages);
  } catch (error) {
    console.error('Erreur chargement messages:', error);
  }
}

function renderMessages(messages) {
  messagesContainer.innerHTML = '';

  const dateSeparator = document.createElement('div');
  dateSeparator.className = 'date-separator';
  dateSeparator.innerHTML = '<span>Aujourd\'hui</span>';
  messagesContainer.appendChild(dateSeparator);

  messages.forEach(msg => {
    const isOutgoing = msg.senderId === currentUser.id;
    const messageEl = document.createElement('div');
    messageEl.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
    messageEl.dataset.messageId = msg.id;

    const isRead = msg.readBy && msg.readBy.length > 0;

    messageEl.innerHTML = `
      <div class="message-text">${formatMessageContent(msg.content)}</div>
      <div class="message-time">
        ${msg.isSaved ? '<i class="fas fa-bookmark save-indicator"></i>' : ''}
        ${formatTime(msg.createdAt)}
        ${isOutgoing ? `<i class="fas fa-check-double ${isRead ? 'read' : ''}"></i>` : ''}
      </div>
    `;

    messageEl.addEventListener('contextmenu', (e) => showMessageContextMenu(e, msg));
    messagesContainer.appendChild(messageEl);
  });

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showNotification(title, body, iconUrl, conversationId) {
  // Utiliser IPC pour envoyer la notification via Electron (meilleure apparence)
  ipcRenderer.send('show-notification', {
    title: title,
    body: body,
    iconUrl: iconUrl,
    conversationId: conversationId
  });
}

// Écouter le clic sur la notification
ipcRenderer.on('notification-clicked', (event, conversationId) => {
  if (conversationId) {
    openConversation(conversationId);
  }
});

function handleNewMessage(message) {
  const conv = conversations.find(c => c.id === message.conversationId);
  if (conv) {
    conv.lastMessage = message;
    if (message.conversationId !== currentConversationId) {
      conv.unreadCount = (conv.unreadCount || 0) + 1;
    }
    conversations = conversations.filter(c => c.id !== message.conversationId);
    conversations.unshift(conv);
    renderConversations();
  } else {
    loadConversations();
  }

  // Notification pour les messages entrants (pas les siens)
  const isOutgoing = message.senderId === currentUser.id;
  if (!isOutgoing && (message.conversationId !== currentConversationId || !document.hasFocus())) {
    const convForNotif = conv || conversations.find(c => c.id === message.conversationId);
    if (convForNotif) {
      let title = '';
      let icon = null;

      if (convForNotif.type === 'group') {
        title = `${message.senderName || 'Quelqu\'un'} dans ${convForNotif.name}`;
        // Utiliser l'avatar de l'expéditeur pour les groupes
        icon = message.senderAvatar ? API_URL + message.senderAvatar : (convForNotif.avatar ? API_URL + convForNotif.avatar : null);
      } else if (convForNotif.type === 'channel') {
        title = convForNotif.name;
        icon = convForNotif.avatar ? API_URL + convForNotif.avatar : null;
      } else {
        // Message privé - utiliser l'avatar de l'expéditeur
        title = message.senderName || convForNotif.name || 'Nouveau message';
        icon = message.senderAvatar ? API_URL + message.senderAvatar : (convForNotif.avatar ? API_URL + convForNotif.avatar : null);
      }

      showNotification(title, message.content, icon, message.conversationId);
    }
  }

  if (message.conversationId === currentConversationId) {
    hideTypingIndicator();
    const messageEl = document.createElement('div');
    messageEl.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
    messageEl.dataset.messageId = message.id;

    messageEl.innerHTML = `
      <div class="message-text">${formatMessageContent(message.content)}</div>
      <div class="message-time">
        ${formatTime(message.createdAt)}
        ${isOutgoing ? '<i class="fas fa-check-double"></i>' : ''}
      </div>
    `;

    messageEl.addEventListener('contextmenu', (e) => showMessageContextMenu(e, message));
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (!isOutgoing && socket) socket.emit('mark_read', { conversationId: currentConversationId });
  }
}

async function sendMessage() {
  const content = messageInput.value.trim();

  // Si on a un fichier attaché, l'uploader d'abord
  if (attachedFile && currentConversationId && socket) {
    const uploadedFile = await uploadFile(attachedFile);
    if (uploadedFile) {
      // Créer un message avec le fichier
      let fileContent = '';
      if (uploadedFile.type === 'image') {
        fileContent = `[Image: ${uploadedFile.name}](${uploadedFile.url})`;
      } else if (uploadedFile.type === 'video') {
        fileContent = `[Vidéo: ${uploadedFile.name}](${uploadedFile.url})`;
      } else if (uploadedFile.type === 'audio') {
        fileContent = `[Audio: ${uploadedFile.name}](${uploadedFile.url})`;
      } else {
        fileContent = `[Fichier: ${uploadedFile.name}](${uploadedFile.url})`;
      }

      if (content) {
        fileContent = content + '\n' + fileContent;
      }

      const messageData = {
        conversationId: currentConversationId,
        content: fileContent,
        type: uploadedFile.type
      };

      if (replyingToMessage) {
        messageData.replyTo = replyingToMessage.id;
      }

      socket.emit('send_message', messageData);
    }

    cancelAttachment();
    messageInput.value = '';
    cancelReply();
    socket.emit('stop_typing', { conversationId: currentConversationId });
    return;
  }

  if (!content || !currentConversationId || !socket) return;

  const messageData = {
    conversationId: currentConversationId,
    content: content
  };

  if (replyingToMessage) {
    messageData.replyTo = replyingToMessage.id;
    messageData.content = `> ${replyingToMessage.senderName}: ${replyingToMessage.content}\n\n${content}`;
  }

  socket.emit('send_message', messageData);
  messageInput.value = '';
  cancelReply();
  socket.emit('stop_typing', { conversationId: currentConversationId });
}

// ==================== CONTACTS ====================
async function loadContacts() {
  try {
    const data = await apiRequest('/api/contacts');
    contacts = data.contacts;
  } catch (error) {
    console.error('Erreur chargement contacts:', error);
  }
}

function renderContacts() {
  const contactsList = document.getElementById('contactsList');

  if (contacts.length === 0) {
    contactsList.innerHTML = `<div class="search-hint"><i class="fas fa-user-friends"></i><p>Aucun contact pour le moment</p></div>`;
    return;
  }

  contactsList.innerHTML = '';
  contacts.forEach(contact => {
    const item = document.createElement('div');
    item.className = 'contact-item';
    item.innerHTML = `
      <div class="user-avatar">
        ${contact.avatar
          ? `<img src="${API_URL + contact.avatar}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'avatar-placeholder\\'><i class=\\'fas fa-user\\'></i></div>';">`
          : `<div class="avatar-placeholder"><i class="fas fa-user"></i></div>`}
      </div>
      <div class="contact-info">
        <div class="contact-name">${contact.displayName}</div>
        <div class="contact-username">@${contact.username}</div>
      </div>
      <div class="contact-actions">
        <button class="contact-action-btn" onclick="startConversationWithContact('${contact.id}')">
          <i class="fas fa-comment"></i>
        </button>
        <button class="contact-action-btn delete" onclick="deleteContact('${contact.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;
    contactsList.appendChild(item);
  });
}

async function addContact(userId) {
  try {
    await apiRequest('/api/contacts', {
      method: 'POST',
      body: JSON.stringify({ contactId: userId })
    });
    await loadContacts();
    renderContacts();
    document.getElementById('addContactModal').classList.remove('active');
  } catch (error) {
    alert(error.message);
  }
}

async function deleteContact(contactId) {
  const confirmed = await showConfirmModal({
    icon: 'user-minus',
    title: 'Supprimer ce contact ?',
    text: 'Le contact sera retiré de votre liste.',
    okText: 'Supprimer',
    okClass: 'danger'
  });

  if (!confirmed) return;

  try {
    await apiRequest(`/api/contacts/${contactId}`, { method: 'DELETE' });
    await loadContacts();
    renderContacts();
  } catch (error) {
    console.error('Erreur suppression contact:', error);
  }
}

async function startConversationWithContact(userId) {
  await startConversation(userId);
  document.getElementById('contactsModal').classList.remove('active');
}

// ==================== GROUPS ====================
async function createGroup() {
  const name = document.getElementById('groupNameInput').value.trim();
  const description = document.getElementById('groupDescInput').value.trim();

  if (!name) {
    alert('Veuillez entrer un nom pour le groupe');
    return;
  }

  const formData = new FormData();
  formData.append('name', name);
  formData.append('description', description);
  formData.append('members', JSON.stringify(selectedGroupMembers.map(m => m.id)));

  if (groupAvatarFile) {
    formData.append('avatar', groupAvatarFile);
  }

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/api/groups`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    const data = await response.json();
    if (data.success) {
      document.getElementById('newGroupModal').classList.remove('active');
      resetGroupForm();
      await loadConversations();
      if (socket) socket.emit('join_conversation', data.group.id);
      openConversation(data.group.id);
    }
  } catch (error) {
    console.error('Erreur création groupe:', error);
  }
}

function resetGroupForm() {
  document.getElementById('groupNameInput').value = '';
  document.getElementById('groupDescInput').value = '';
  document.getElementById('groupMemberSearch').value = '';
  document.getElementById('memberSearchResults').innerHTML = '';
  selectedGroupMembers = [];
  groupAvatarFile = null;
  renderSelectedMembers();
  document.getElementById('groupAvatarPreview').innerHTML = '<div class="avatar-placeholder"><i class="fas fa-users"></i></div>';
}

function renderSelectedMembers() {
  const container = document.getElementById('selectedMembers');
  container.innerHTML = '';

  selectedGroupMembers.forEach(member => {
    const chip = document.createElement('div');
    chip.className = 'selected-member';
    chip.innerHTML = `
      <span>${member.displayName}</span>
      <i class="fas fa-times remove-member" onclick="removeGroupMember('${member.id}')"></i>
    `;
    container.appendChild(chip);
  });
}

function addGroupMember(user) {
  if (!selectedGroupMembers.find(m => m.id === user.id)) {
    selectedGroupMembers.push(user);
    renderSelectedMembers();
  }
}

function removeGroupMember(userId) {
  selectedGroupMembers = selectedGroupMembers.filter(m => m.id !== userId);
  renderSelectedMembers();
}

// ==================== CHANNELS ====================
async function createChannel() {
  const name = document.getElementById('channelNameInput').value.trim();
  const description = document.getElementById('channelDescInput').value.trim();
  const isPublic = document.getElementById('channelPublic').checked;

  if (!name) {
    alert('Veuillez entrer un nom pour le canal');
    return;
  }

  const formData = new FormData();
  formData.append('name', name);
  formData.append('description', description);
  formData.append('isPublic', isPublic);

  if (channelAvatarFile) {
    formData.append('avatar', channelAvatarFile);
  }

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/api/channels`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    const data = await response.json();
    if (data.success) {
      document.getElementById('newChannelModal').classList.remove('active');
      resetChannelForm();
      await loadConversations();
      if (socket) socket.emit('join_conversation', data.channel.id);
      openConversation(data.channel.id);
    }
  } catch (error) {
    console.error('Erreur création canal:', error);
  }
}

function resetChannelForm() {
  document.getElementById('channelNameInput').value = '';
  document.getElementById('channelDescInput').value = '';
  document.getElementById('channelPublic').checked = true;
  channelAvatarFile = null;
  document.getElementById('channelAvatarPreview').innerHTML = '<div class="avatar-placeholder"><i class="fas fa-bullhorn"></i></div>';
}

// ==================== GROUP/CHANNEL MENU ====================
function showChatContextMenu(e) {
  e.preventDefault();
  e.stopPropagation();

  const conv = conversations.find(c => c.id === currentConversationId);
  if (!conv) return;

  const menu = document.getElementById('chatContextMenu');
  const isGroupOrChannel = conv.type === 'group' || conv.type === 'channel';
  const isAdmin = conv.participants?.find(p => p.id === currentUser.id)?.role === 'admin';

  // Show/hide menu items based on conversation type and admin status
  document.getElementById('chatMenuEdit').style.display = (isGroupOrChannel && isAdmin) ? 'flex' : 'none';
  document.getElementById('chatMenuMembers').style.display = (isGroupOrChannel && isAdmin) ? 'flex' : 'none';
  document.getElementById('chatMenuLeave').style.display = isGroupOrChannel ? 'flex' : 'none';

  // Position menu - rester dans les limites de la fenêtre
  menu.classList.add('active');
  const menuWidth = menu.offsetWidth || 200;
  const menuHeight = menu.offsetHeight || 250;
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  const rect = e.target.closest('.action-btn').getBoundingClientRect();
  let x = rect.left - menuWidth + rect.width;
  let y = rect.bottom + 5;

  // Ajuster si le menu dépasse à droite
  if (x + menuWidth > windowWidth) {
    x = windowWidth - menuWidth - 10;
  }
  // Ajuster si le menu dépasse à gauche
  if (x < 10) {
    x = 10;
  }
  // Ajuster si le menu dépasse en bas
  if (y + menuHeight > windowHeight) {
    y = rect.top - menuHeight - 5;
  }
  // Ajuster si le menu dépasse en haut
  if (y < 10) {
    y = 10;
  }

  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function hideChatContextMenu() {
  document.getElementById('chatContextMenu').classList.remove('active');
}

async function showGroupInfo() {
  hideChatContextMenu();
  const conv = conversations.find(c => c.id === currentConversationId);
  if (!conv) return;

  const isChannel = conv.type === 'channel';
  const endpoint = isChannel ? `/api/channels/${currentConversationId}` : `/api/groups/${currentConversationId}`;

  try {
    const data = await apiRequest(endpoint);
    const info = data.group || data.channel;
    currentGroupInfo = info;

    document.getElementById('groupInfoTitle').textContent = isChannel ? 'Infos du canal' : 'Infos du groupe';
    document.getElementById('groupInfoName').textContent = info.name;
    document.getElementById('groupInfoDesc').textContent = info.description || '';
    document.getElementById('groupInfoMemberCount').textContent = `${info.members?.length || info.subscriberCount || 0} ${isChannel ? 'abonnés' : 'membres'}`;

    const avatarContainer = document.getElementById('groupInfoAvatar');
    if (info.avatar) {
      avatarContainer.innerHTML = `<img src="${API_URL + info.avatar}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'avatar-placeholder\\'><i class=\\'fas fa-${isChannel ? 'bullhorn' : 'users'}\\'></i></div>';">`;
    } else {
      avatarContainer.innerHTML = `<div class="avatar-placeholder"><i class="fas fa-${isChannel ? 'bullhorn' : 'users'}"></i></div>`;
    }

    // Render members
    const membersList = document.getElementById('groupMembersList');
    const members = info.members || info.subscribers || [];
    membersList.innerHTML = '';

    members.forEach(member => {
      const item = document.createElement('div');
      item.className = 'group-member-item';
      item.innerHTML = `
        <div class="user-avatar">
          ${member.avatar
            ? `<img src="${API_URL + member.avatar}" alt="" onerror="this.style.display='none'; this.nextElementSibling ? this.nextElementSibling.style.display='flex' : this.parentElement.innerHTML='<div class=\\'avatar-placeholder\\'><i class=\\'fas fa-user\\'></i></div>';">`
            : `<div class="avatar-placeholder"><i class="fas fa-user"></i></div>`}
        </div>
        <div class="member-info">
          <span class="member-name">${member.displayName}</span>
          <span class="member-role">${member.role === 'admin' ? 'Admin' : (isChannel ? 'Abonné' : 'Membre')}</span>
        </div>
      `;
      membersList.appendChild(item);
    });

    // Afficher bouton modifier si admin
    const isAdmin = members.find(m => m.id === currentUser.id && m.role === 'admin');
    document.getElementById('groupInfoEditBtn').style.display = isAdmin ? 'block' : 'none';

    document.getElementById('groupInfoModal').classList.add('active');
  } catch (error) {
    console.error('Erreur chargement infos:', error);
  }
}

async function showUserProfile() {
  const conv = conversations.find(c => c.id === currentConversationId);
  if (!conv || conv.type !== 'private') return;

  try {
    const data = await apiRequest(`/api/users/${conv.recipientId}`);
    const user = data.user;

    const avatarContainer = document.getElementById('userProfileAvatar');
    if (user.avatar) {
      avatarContainer.innerHTML = `<img src="${API_URL + user.avatar}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'avatar-placeholder\\'><i class=\\'fas fa-user\\'></i></div>';">`;
    } else {
      avatarContainer.innerHTML = `<div class="avatar-placeholder"><i class="fas fa-user"></i></div>`;
    }

    document.getElementById('userProfileName').textContent = user.displayName;
    document.getElementById('userProfileUsername').textContent = user.username ? `@${user.username}` : '';
    document.getElementById('userProfileBio').textContent = user.bio || '';
    document.getElementById('userProfileStatus').textContent = user.status === 'online' ? 'En ligne' : 'Hors ligne';

    const phoneSection = document.getElementById('userProfilePhoneSection');
    if (user.phone) {
      document.getElementById('userProfilePhone').textContent = user.phone;
      phoneSection.style.display = 'flex';
    } else {
      phoneSection.style.display = 'none';
    }

    document.getElementById('userProfileModal').classList.add('active');
  } catch (error) {
    console.error('Erreur chargement profil:', error);
  }
}

async function openEditGroupModal() {
  hideChatContextMenu();
  const conv = conversations.find(c => c.id === currentConversationId);
  if (!conv) return;

  const isChannel = conv.type === 'channel';
  const endpoint = isChannel ? `/api/channels/${currentConversationId}` : `/api/groups/${currentConversationId}`;

  try {
    const data = await apiRequest(endpoint);
    const info = data.group || data.channel;
    currentGroupInfo = info;

    document.getElementById('editGroupTitle').textContent = isChannel ? 'Modifier le canal' : 'Modifier le groupe';
    document.getElementById('editGroupNameInput').value = info.name;
    document.getElementById('editGroupDescInput').value = info.description || '';

    const avatarContainer = document.getElementById('editGroupAvatarPreview');
    if (info.avatar) {
      avatarContainer.innerHTML = `<img src="${API_URL + info.avatar}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'avatar-placeholder\\'><i class=\\'fas fa-${isChannel ? 'bullhorn' : 'users'}\\'></i></div>';">`;
    } else {
      avatarContainer.innerHTML = `<div class="avatar-placeholder"><i class="fas fa-${isChannel ? 'bullhorn' : 'users'}"></i></div>`;
    }

    editGroupAvatarFile = null;
    document.getElementById('editGroupModal').classList.add('active');
  } catch (error) {
    console.error('Erreur chargement infos:', error);
  }
}

async function saveGroupChanges() {
  const conv = conversations.find(c => c.id === currentConversationId);
  if (!conv) return;

  const name = document.getElementById('editGroupNameInput').value.trim();
  const description = document.getElementById('editGroupDescInput').value.trim();

  if (!name) {
    alert('Le nom est requis');
    return;
  }

  const isChannel = conv.type === 'channel';
  const endpoint = isChannel ? `/api/channels/${currentConversationId}` : `/api/groups/${currentConversationId}`;

  const formData = new FormData();
  formData.append('name', name);
  formData.append('description', description);

  if (editGroupAvatarFile) {
    formData.append('avatar', editGroupAvatarFile);
  }

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    const data = await response.json();
    if (data.success) {
      document.getElementById('editGroupModal').classList.remove('active');
      await loadConversations();
      openConversation(currentConversationId);
    } else {
      alert(data.error || 'Erreur lors de la modification');
    }
  } catch (error) {
    console.error('Erreur modification:', error);
  }
}

async function openManageMembersModal() {
  hideChatContextMenu();
  const conv = conversations.find(c => c.id === currentConversationId);
  if (!conv) return;

  try {
    const data = await apiRequest(`/api/groups/${currentConversationId}`);
    currentGroupInfo = data.group;

    renderCurrentMembers(data.group.members);
    document.getElementById('addMemberSearch').value = '';
    document.getElementById('addMemberResults').innerHTML = '';
    document.getElementById('manageMembersModal').classList.add('active');
  } catch (error) {
    console.error('Erreur:', error);
  }
}

function renderCurrentMembers(members) {
  const list = document.getElementById('currentMembersList');
  list.innerHTML = '';

  members.forEach(member => {
    const isAdmin = member.role === 'admin';
    const item = document.createElement('div');
    item.className = 'member-manage-item';
    item.innerHTML = `
      <div class="user-avatar">
        ${member.avatar
          ? `<img src="${API_URL + member.avatar}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'avatar-placeholder\\'><i class=\\'fas fa-user\\'></i></div>';">`
          : `<div class="avatar-placeholder"><i class="fas fa-user"></i></div>`}
      </div>
      <div class="member-info">
        <span class="member-name">${member.displayName}</span>
        <span class="member-role">${isAdmin ? 'Admin' : 'Membre'}</span>
      </div>
      ${!isAdmin ? `<button class="remove-member-btn" onclick="removeMemberFromGroup('${member.id}')"><i class="fas fa-times"></i></button>` : ''}
    `;
    list.appendChild(item);
  });
}

async function removeMemberFromGroup(memberId) {
  const confirmed = await showConfirmModal({
    icon: 'user-times',
    title: 'Retirer ce membre ?',
    text: 'Le membre sera retiré du groupe.',
    okText: 'Retirer',
    okClass: 'danger'
  });

  if (!confirmed) return;

  try {
    await apiRequest(`/api/groups/${currentConversationId}/members/${memberId}`, { method: 'DELETE' });
    const data = await apiRequest(`/api/groups/${currentConversationId}`);
    currentGroupInfo = data.group;
    renderCurrentMembers(data.group.members);
    await loadConversations();
  } catch (error) {
    showConfirmModal({
      icon: 'exclamation-circle',
      iconClass: 'warning',
      title: 'Erreur',
      text: error.message,
      okText: 'OK',
      okClass: 'primary'
    });
  }
}

async function addMemberToGroup(user) {
  try {
    await apiRequest(`/api/groups/${currentConversationId}/members`, {
      method: 'POST',
      body: JSON.stringify({ memberIds: [user.id] })
    });
    const data = await apiRequest(`/api/groups/${currentConversationId}`);
    currentGroupInfo = data.group;
    renderCurrentMembers(data.group.members);
    document.getElementById('addMemberSearch').value = '';
    document.getElementById('addMemberResults').innerHTML = '';
    await loadConversations();
  } catch (error) {
    alert(error.message);
  }
}

async function leaveGroup() {
  hideChatContextMenu();
  const conv = conversations.find(c => c.id === currentConversationId);
  if (!conv) return;

  const isChannel = conv.type === 'channel';
  const confirmed = await showConfirmModal({
    icon: 'sign-out-alt',
    iconClass: 'warning',
    title: isChannel ? 'Quitter ce canal ?' : 'Quitter ce groupe ?',
    text: isChannel ? 'Vous ne recevrez plus les messages de ce canal.' : 'Vous ne recevrez plus les messages de ce groupe.',
    okText: 'Quitter',
    okClass: 'danger'
  });

  if (!confirmed) return;

  try {
    await apiRequest(`/api/groups/${currentConversationId}/leave`, { method: 'DELETE' });
    currentConversationId = null;
    chatContent.style.display = 'none';
    chatPlaceholder.style.display = 'flex';
    await loadConversations();
  } catch (error) {
    console.error('Erreur:', error);
  }
}

// ==================== CALLS ====================
async function loadCalls() {
  try {
    const data = await apiRequest('/api/calls');
    renderCalls(data.calls);
  } catch (error) {
    console.error('Erreur chargement appels:', error);
  }
}

function renderCalls(calls) {
  const callsList = document.getElementById('callsList');

  if (calls.length === 0) {
    callsList.innerHTML = `<div class="search-hint"><i class="fas fa-phone-slash"></i><p>Aucun appel récent</p></div>`;
    return;
  }

  callsList.innerHTML = '';
  calls.forEach(call => {
    const otherName = call.isOutgoing ? call.receiverName : call.callerName;
    const otherAvatar = call.isOutgoing ? call.receiverAvatar : call.callerAvatar;
    const statusClass = call.status === 'missed' ? 'missed' : (call.isOutgoing ? 'outgoing' : 'incoming');
    const statusIcon = call.status === 'missed' ? 'fa-phone-slash' : (call.isOutgoing ? 'fa-arrow-up' : 'fa-arrow-down');

    const item = document.createElement('div');
    item.className = 'call-item';
    item.innerHTML = `
      <div class="user-avatar">
        ${otherAvatar
          ? `<img src="${API_URL + otherAvatar}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'avatar-placeholder\\'><i class=\\'fas fa-user\\'></i></div>';">`
          : `<div class="avatar-placeholder"><i class="fas fa-user"></i></div>`}
      </div>
      <div class="call-item-info">
        <div class="call-item-name">${otherName}</div>
        <div class="call-item-details">
          <i class="fas ${statusIcon} ${statusClass}"></i>
          <span>${call.type === 'video' ? 'Vidéo' : 'Audio'}</span>
          ${call.duration ? `<span>• ${formatDuration(call.duration)}</span>` : ''}
        </div>
      </div>
      <span class="call-item-time">${formatTime(call.startedAt)}</span>
      <button class="call-item-action" onclick="initiateCall('${call.isOutgoing ? call.receiverId : call.callerId}', '${call.type}')">
        <i class="fas fa-${call.type === 'video' ? 'video' : 'phone'}"></i>
      </button>
    `;
    callsList.appendChild(item);
  });
}

async function initiateCall(receiverId, type = 'audio') {
  try {
    const data = await apiRequest('/api/calls', {
      method: 'POST',
      body: JSON.stringify({ receiverId, type })
    });

    currentCall = { ...data.call, otherUserId: receiverId };

    const conv = conversations.find(c =>
      c.type === 'private' && c.participants?.some(p => p.id === receiverId)
    );

    document.getElementById('activeCallName').textContent = conv?.name || 'Appel en cours';
    document.getElementById('activeCallDuration').textContent = 'Appel en cours...';
    document.getElementById('activeCallModal').classList.add('active');

    if (socket) {
      socket.emit('call_user', { receiverId, callId: data.call.id, type });
    }
  } catch (error) {
    console.error('Erreur appel:', error);
  }
}

function handleIncomingCall(data) {
  currentCall = {
    id: data.callId,
    callerId: data.callerId,
    type: data.type,
    otherUserId: data.callerId
  };

  document.getElementById('incomingCallerName').textContent = data.callerName;
  document.getElementById('incomingCallType').textContent = data.type === 'video' ? 'Appel vidéo' : 'Appel audio';
  document.getElementById('incomingCallModal').classList.add('active');
}

function handleCallAnswered(data) {
  if (data.accepted) {
    startCallTimer();
  } else {
    endCall();
    alert('Appel refusé');
  }
}

function handleCallEnded() {
  endCall();
}

function answerCall(accepted) {
  document.getElementById('incomingCallModal').classList.remove('active');

  if (socket && currentCall) {
    socket.emit('answer_call', {
      callId: currentCall.id,
      callerId: currentCall.callerId,
      accepted
    });
  }

  if (accepted) {
    const caller = conversations.find(c =>
      c.type === 'private' && c.participants?.some(p => p.id === currentCall.callerId)
    );
    document.getElementById('activeCallName').textContent = caller?.name || 'Appel';
    document.getElementById('activeCallModal').classList.add('active');
    startCallTimer();
  } else {
    currentCall = null;
  }
}

function endCall() {
  if (callTimer) clearInterval(callTimer);

  if (socket && currentCall) {
    socket.emit('end_call', {
      callId: currentCall.id,
      otherUserId: currentCall.otherUserId,
      duration: callDuration
    });
  }

  document.getElementById('activeCallModal').classList.remove('active');
  document.getElementById('incomingCallModal').classList.remove('active');
  currentCall = null;
  callDuration = 0;
}

function startCallTimer() {
  callDuration = 0;
  callTimer = setInterval(() => {
    callDuration++;
    document.getElementById('activeCallDuration').textContent = formatDuration(callDuration);
  }, 1000);
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Alias pour closeSidebar
function closeSideMenu() {
  closeSidebar();
}

// Custom confirm modal pour admin
// ==================== REPLY SYSTEM ====================
let replyingToMessage = null;

function startReply() {
  if (!selectedMessageId) return;

  const messageEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
  if (!messageEl) return;

  const messageText = messageEl.querySelector('.message-text').textContent;
  const messages = document.querySelectorAll(`[data-message-id="${selectedMessageId}"]`);

  // Trouver le nom de l'expéditeur
  let senderName = 'Message';
  const msgData = messagesContainer.querySelector(`[data-message-id="${selectedMessageId}"]`);
  if (msgData && msgData.classList.contains('outgoing')) {
    senderName = 'Vous';
  }

  replyingToMessage = {
    id: selectedMessageId,
    content: messageText.substring(0, 50) + (messageText.length > 50 ? '...' : ''),
    senderName: senderName
  };

  showReplyPreview();
  messageInput.focus();
}

function showReplyPreview() {
  let replyPreview = document.getElementById('replyPreview');
  if (!replyPreview) {
    replyPreview = document.createElement('div');
    replyPreview.id = 'replyPreview';
    replyPreview.className = 'reply-preview';
    const inputContainer = document.querySelector('.message-input-container');
    inputContainer.insertBefore(replyPreview, inputContainer.firstChild);
  }

  replyPreview.innerHTML = `
    <div class="reply-preview-content">
      <div class="reply-preview-bar"></div>
      <div class="reply-preview-text">
        <span class="reply-preview-name">${escapeHtml(replyingToMessage.senderName)}</span>
        <span class="reply-preview-message">${escapeHtml(replyingToMessage.content)}</span>
      </div>
    </div>
    <button class="reply-cancel-btn" onclick="cancelReply()">
      <i class="fas fa-times"></i>
    </button>
  `;
  replyPreview.style.display = 'flex';
}

function cancelReply() {
  replyingToMessage = null;
  const replyPreview = document.getElementById('replyPreview');
  if (replyPreview) {
    replyPreview.style.display = 'none';
  }
}

window.cancelReply = cancelReply;

// ==================== FILE ATTACHMENT ====================
let attachedFile = null;

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/api/upload/file`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    const data = await response.json();
    if (data.success) {
      return data.file;
    } else {
      throw new Error(data.error || 'Erreur upload');
    }
  } catch (error) {
    console.error('Erreur upload fichier:', error);
    alert('Erreur lors de l\'upload du fichier: ' + error.message);
    return null;
  }
}

function showAttachmentPreview(file) {
  let attachPreview = document.getElementById('attachPreview');
  if (!attachPreview) {
    attachPreview = document.createElement('div');
    attachPreview.id = 'attachPreview';
    attachPreview.className = 'attach-preview';
    const inputContainer = document.querySelector('.message-input-container');
    inputContainer.insertBefore(attachPreview, inputContainer.firstChild);
  }

  const isImage = file.type.startsWith('image/');
  const fileSize = (file.size / 1024).toFixed(1) + ' KB';

  if (isImage) {
    const reader = new FileReader();
    reader.onload = (e) => {
      attachPreview.innerHTML = `
        <div class="attach-preview-content">
          <img src="${e.target.result}" alt="" class="attach-preview-image">
          <div class="attach-preview-info">
            <span class="attach-preview-name">${escapeHtml(file.name)}</span>
            <span class="attach-preview-size">${fileSize}</span>
          </div>
        </div>
        <button class="attach-cancel-btn" onclick="cancelAttachment()">
          <i class="fas fa-times"></i>
        </button>
      `;
    };
    reader.readAsDataURL(file);
  } else {
    const iconClass = file.type.includes('pdf') ? 'file-pdf' :
                      file.type.includes('word') ? 'file-word' :
                      file.type.includes('excel') || file.type.includes('sheet') ? 'file-excel' :
                      file.type.includes('video') ? 'file-video' :
                      file.type.includes('audio') ? 'file-audio' :
                      file.type.includes('zip') || file.type.includes('rar') ? 'file-archive' : 'file';

    attachPreview.innerHTML = `
      <div class="attach-preview-content">
        <div class="attach-preview-icon">
          <i class="fas fa-${iconClass}"></i>
        </div>
        <div class="attach-preview-info">
          <span class="attach-preview-name">${escapeHtml(file.name)}</span>
          <span class="attach-preview-size">${fileSize}</span>
        </div>
      </div>
      <button class="attach-cancel-btn" onclick="cancelAttachment()">
        <i class="fas fa-times"></i>
      </button>
    `;
  }

  attachPreview.style.display = 'flex';
  attachedFile = file;
}

function cancelAttachment() {
  attachedFile = null;
  const attachPreview = document.getElementById('attachPreview');
  if (attachPreview) {
    attachPreview.style.display = 'none';
  }
}

window.cancelAttachment = cancelAttachment;

// ==================== MESSAGE SEARCH ====================
let searchResults = [];
let currentSearchIndex = 0;

async function searchMessagesInConversation(query) {
  if (!query || query.length < 2 || !currentConversationId) return;

  try {
    const data = await apiRequest(`/api/conversations/${currentConversationId}/search?q=${encodeURIComponent(query)}`);
    searchResults = data.messages;
    currentSearchIndex = 0;

    if (searchResults.length > 0) {
      updateSearchResults();
      highlightSearchResult(searchResults[0].id);
    } else {
      document.getElementById('searchResultsInfo').textContent = 'Aucun résultat';
    }
  } catch (error) {
    console.error('Erreur recherche:', error);
  }
}

function updateSearchResults() {
  const info = document.getElementById('searchResultsInfo');
  if (info) {
    info.textContent = `${currentSearchIndex + 1} / ${searchResults.length}`;
  }
}

function highlightSearchResult(messageId) {
  // Supprimer les surbrillances précédentes
  document.querySelectorAll('.message.search-highlight').forEach(el => {
    el.classList.remove('search-highlight');
  });

  // Trouver et surligner le message
  const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
  if (messageEl) {
    messageEl.classList.add('search-highlight');
    messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function nextSearchResult() {
  if (searchResults.length === 0) return;
  currentSearchIndex = (currentSearchIndex + 1) % searchResults.length;
  updateSearchResults();
  highlightSearchResult(searchResults[currentSearchIndex].id);
}

function prevSearchResult() {
  if (searchResults.length === 0) return;
  currentSearchIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
  updateSearchResults();
  highlightSearchResult(searchResults[currentSearchIndex].id);
}

function closeMessageSearch() {
  const searchBar = document.getElementById('messageSearchBar');
  if (searchBar) {
    searchBar.style.display = 'none';
  }
  document.querySelectorAll('.message.search-highlight').forEach(el => {
    el.classList.remove('search-highlight');
  });
  searchResults = [];
}

function showCustomConfirm(message, title, type = 'danger', okText = 'Confirmer', cancelText = 'Annuler') {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    const icon = document.getElementById('confirmIcon');
    const titleEl = document.getElementById('confirmTitle');
    const text = document.getElementById('confirmText');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');

    // Configure icon based on type
    const icons = {
      danger: 'trash-alt',
      warning: 'exclamation-triangle',
      success: 'check-circle',
      info: 'info-circle'
    };

    icon.className = 'confirm-icon ' + type;
    icon.innerHTML = `<i class="fas fa-${icons[type] || 'question-circle'}"></i>`;

    // Configure text
    titleEl.textContent = title || 'Confirmer ?';
    text.innerHTML = message || '';
    text.style.display = message ? 'block' : 'none';

    // Configure OK button
    okBtn.textContent = okText;
    okBtn.className = 'confirm-btn ' + type;

    // Hide cancel button if cancelText is null
    if (cancelText === null) {
      cancelBtn.style.display = 'none';
    } else {
      cancelBtn.style.display = 'block';
      cancelBtn.textContent = cancelText;
    }

    // Store resolve for later
    modal._resolve = resolve;

    // Remove old listeners
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    // Add new listeners
    newOkBtn.addEventListener('click', () => {
      modal.classList.remove('active');
      resolve(true);
    });
    newCancelBtn.addEventListener('click', () => {
      modal.classList.remove('active');
      resolve(false);
    });

    modal.classList.add('active');
  });
}

// ==================== SAVED MESSAGES ====================
async function loadSavedMessages() {
  try {
    const data = await apiRequest('/api/saved-messages');
    renderSavedMessages(data.savedMessages);
  } catch (error) {
    console.error('Erreur chargement messages enregistrés:', error);
  }
}

function renderSavedMessages(savedMessages) {
  const list = document.getElementById('savedMessagesList');

  if (savedMessages.length === 0) {
    list.innerHTML = `<div class="search-hint"><i class="fas fa-bookmark"></i><p>Aucun message enregistré</p></div>`;
    return;
  }

  list.innerHTML = '';
  savedMessages.forEach(sm => {
    const item = document.createElement('div');
    item.className = 'saved-message-item';
    item.innerHTML = `
      <div class="saved-message-header">
        <span class="saved-message-sender">${sm.senderName}</span>
        <span class="saved-message-time">${formatTime(sm.createdAt)}</span>
      </div>
      <div class="saved-message-content">${escapeHtml(sm.content)}</div>
      <div class="saved-message-actions">
        <button class="unsave-btn" onclick="unsaveMessage('${sm.messageId}')">
          <i class="fas fa-bookmark"></i> Retirer
        </button>
      </div>
    `;
    list.appendChild(item);
  });
}

async function saveMessage(messageId, conversationId) {
  try {
    await apiRequest('/api/saved-messages', {
      method: 'POST',
      body: JSON.stringify({ messageId, conversationId })
    });
    await loadMessages(currentConversationId);
  } catch (error) {
    console.error('Erreur enregistrement message:', error);
  }
}

async function unsaveMessage(messageId) {
  try {
    await apiRequest(`/api/saved-messages/${messageId}`, { method: 'DELETE' });
    await loadSavedMessages();
    if (currentConversationId) await loadMessages(currentConversationId);
  } catch (error) {
    console.error('Erreur suppression message enregistré:', error);
  }
}

async function deleteMessage(messageId) {
  const confirmed = await showConfirmModal({
    icon: 'trash-alt',
    title: 'Supprimer le message ?',
    text: 'Cette action est irréversible.',
    okText: 'Supprimer',
    okClass: 'danger'
  });

  if (!confirmed) return;

  try {
    await apiRequest(`/api/messages/${messageId}`, { method: 'DELETE' });
    // Supprimer le message de l'UI
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (msgEl) msgEl.remove();
    // Recharger les conversations pour mettre à jour le dernier message
    await loadConversations();
  } catch (error) {
    showConfirmModal({
      icon: 'exclamation-circle',
      iconClass: 'warning',
      title: 'Erreur',
      text: error.message || 'Erreur lors de la suppression',
      okText: 'OK',
      okClass: 'primary'
    });
  }
}

// ==================== CONTEXT MENU ====================
function showMessageContextMenu(e, message) {
  e.preventDefault();
  selectedMessageId = message.id;
  selectedMessageIsSaved = message.isSaved || false;

  const menu = document.getElementById('messageContextMenu');
  menu.classList.add('active');

  // Calculer la position pour rester dans les limites de la fenêtre
  const menuWidth = menu.offsetWidth || 180;
  const menuHeight = menu.offsetHeight || 200;
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  let x = e.clientX;
  let y = e.clientY;

  // Ajuster si le menu dépasse à droite
  if (x + menuWidth > windowWidth) {
    x = windowWidth - menuWidth - 10;
  }

  // Ajuster si le menu dépasse en bas
  if (y + menuHeight > windowHeight) {
    y = windowHeight - menuHeight - 10;
  }

  // S'assurer que le menu ne dépasse pas à gauche ou en haut
  if (x < 10) x = 10;
  if (y < 10) y = 10;

  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const saveBtn = document.getElementById('contextSave');
  saveBtn.innerHTML = message.isSaved
    ? '<i class="fas fa-bookmark"></i> Retirer des favoris'
    : '<i class="far fa-bookmark"></i> Enregistrer';
}

function hideContextMenu() {
  document.getElementById('messageContextMenu').classList.remove('active');
}

// ==================== CUSTOM CONFIRM MODAL ====================
let confirmResolve = null;

function showConfirmModal(options = {}) {
  return new Promise((resolve) => {
    confirmResolve = resolve;

    const modal = document.getElementById('confirmModal');
    const icon = document.getElementById('confirmIcon');
    const title = document.getElementById('confirmTitle');
    const text = document.getElementById('confirmText');
    const okBtn = document.getElementById('confirmOk');

    // Configure icon
    icon.className = 'confirm-icon ' + (options.iconClass || '');
    icon.innerHTML = `<i class="fas fa-${options.icon || 'trash-alt'}"></i>`;

    // Configure text
    title.textContent = options.title || 'Confirmer ?';
    text.textContent = options.text || '';
    text.style.display = options.text ? 'block' : 'none';

    // Configure OK button
    okBtn.textContent = options.okText || 'Confirmer';
    okBtn.className = 'confirm-btn ' + (options.okClass || 'danger');

    modal.classList.add('active');
  });
}

function hideConfirmModal(result) {
  document.getElementById('confirmModal').classList.remove('active');
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

// Event listeners for confirm modal
document.getElementById('confirmCancel').addEventListener('click', () => hideConfirmModal(false));
document.getElementById('confirmOk').addEventListener('click', () => hideConfirmModal(true));
document.getElementById('confirmModal').addEventListener('click', (e) => {
  if (e.target.id === 'confirmModal') hideConfirmModal(false);
});

// ==================== EMOJI PICKER ====================
const emojis = ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','👍','👎','👊','✊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✌️','🤞','🤟','🤘','👌','🤏','👈','👉','👆','👇','☝️','✋','🤚','🖐','🖖','👋','🤙','💪','🦾','🖕','✍️','🙏','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝'];

function initEmojiPicker() {
  const grid = document.getElementById('emojiGrid');
  grid.innerHTML = '';

  emojis.forEach(emoji => {
    const item = document.createElement('div');
    item.className = 'emoji-item';
    item.textContent = emoji;
    item.addEventListener('click', () => {
      messageInput.value += emoji;
      messageInput.focus();
      document.getElementById('emojiPicker').classList.remove('active');
    });
    grid.appendChild(item);
  });
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  const btn = document.getElementById('emojiBtn');
  const rect = btn.getBoundingClientRect();

  picker.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
  picker.style.right = (window.innerWidth - rect.right) + 'px';
  picker.classList.toggle('active');
}

// ==================== USER SEARCH ====================
async function searchUsers(query, resultsContainer, onSelect) {
  if (query.length < 2) {
    resultsContainer.innerHTML = `<div class="search-hint"><i class="fas fa-user-plus"></i><p>Recherchez un utilisateur</p></div>`;
    return;
  }

  try {
    const data = await apiRequest(`/api/users/search?q=${encodeURIComponent(query)}`);

    if (data.users.length === 0) {
      resultsContainer.innerHTML = `<div class="search-hint"><i class="fas fa-user-slash"></i><p>Aucun utilisateur trouvé</p></div>`;
      return;
    }

    resultsContainer.innerHTML = '';
    data.users.forEach(user => {
      const item = document.createElement('div');
      item.className = 'user-result-item';
      item.innerHTML = `
        <div class="user-avatar">
          ${user.avatar
            ? `<img src="${API_URL + user.avatar}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'avatar-placeholder\\'><i class=\\'fas fa-user\\'></i></div>';">`
            : `<div class="avatar-placeholder"><i class="fas fa-user"></i></div>`}
        </div>
        <div class="user-result-info">
          <div class="user-result-name">${user.displayName}</div>
          <div class="user-result-username">@${user.username}</div>
        </div>
        ${user.status === 'online' ? '<span class="status-online"><i class="fas fa-circle"></i></span>' : ''}
      `;
      item.addEventListener('click', () => onSelect(user));
      resultsContainer.appendChild(item);
    });
  } catch (error) {
    console.error('Erreur recherche:', error);
  }
}

async function startConversation(userOrId) {
  // Accepte soit un objet user, soit directement un userId
  const userId = typeof userOrId === 'object' ? userOrId.id : userOrId;

  try {
    const data = await apiRequest('/api/conversations/private', {
      method: 'POST',
      body: JSON.stringify({ userId })
    });

    document.getElementById('newChatModal').classList.remove('active');
    document.getElementById('userSearchInput').value = '';

    if (socket) socket.emit('join_conversation', data.conversationId);
    await loadConversations();
    openConversation(data.conversationId);
  } catch (error) {
    console.error('Erreur création conversation:', error);
  }
}

// ==================== SETTINGS ====================
function openSettings() {
  if (!currentUser) return;

  document.getElementById('settingsDisplayName').value = currentUser.displayName;
  document.getElementById('settingsBio').value = currentUser.bio || '';
  document.getElementById('settingsUsername').value = '@' + currentUser.username;
  document.getElementById('settingsPhone').value = currentUser.phone;
  document.getElementById('settingsShowPhone').checked = currentUser.showPhone;
  document.getElementById('settingsShowLastSeen').checked = currentUser.showLastSeen;
  document.getElementById('settingsShowProfilePhoto').checked = currentUser.showProfilePhoto;

  updateAvatar(document.getElementById('settingsAvatarImg'), document.getElementById('settingsAvatarPlaceholder'), currentUser.avatar);

  document.getElementById('settingsModal').classList.add('active');
  closeSidebar();
}

async function saveSettings() {
  try {
    await apiRequest('/api/users/profile', {
      method: 'PUT',
      body: JSON.stringify({
        displayName: document.getElementById('settingsDisplayName').value,
        bio: document.getElementById('settingsBio').value,
        showPhone: document.getElementById('settingsShowPhone').checked,
        showLastSeen: document.getElementById('settingsShowLastSeen').checked,
        showProfilePhoto: document.getElementById('settingsShowProfilePhoto').checked
      })
    });

    currentUser.displayName = document.getElementById('settingsDisplayName').value;
    currentUser.bio = document.getElementById('settingsBio').value;
    currentUser.showPhone = document.getElementById('settingsShowPhone').checked;
    currentUser.showLastSeen = document.getElementById('settingsShowLastSeen').checked;
    currentUser.showProfilePhoto = document.getElementById('settingsShowProfilePhoto').checked;

    updateMenuProfile();
    document.getElementById('settingsModal').classList.remove('active');
  } catch (error) {
    console.error('Erreur sauvegarde:', error);
  }
}

async function uploadAvatar(file) {
  const formData = new FormData();
  formData.append('avatar', file);

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/api/users/avatar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    const data = await response.json();
    if (data.success) {
      currentUser.avatar = data.avatar;
      updateMenuProfile();
      updateAvatar(document.getElementById('settingsAvatarImg'), document.getElementById('settingsAvatarPlaceholder'), data.avatar);
    }
  } catch (error) {
    console.error('Erreur upload avatar:', error);
  }
}

// ==================== HELPER FUNCTIONS ====================
function formatTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;

  if (diff < 86400000 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } else if (diff < 172800000) {
    return 'Hier';
  } else {
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  }
}

function formatLastSeen(dateString) {
  if (!dateString) return 'vu récemment';
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'vu à l\'instant';
  if (diff < 3600000) return `vu il y a ${Math.floor(diff / 60000)} min`;
  if (diff < 86400000) return `vu à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  return `vu le ${date.toLocaleDateString('fr-FR')}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Fonction pour formater le contenu des messages avec support des médias
function formatMessageContent(content) {
  // Regex pour détecter les liens vers des médias [Type: nom](url)
  const mediaRegex = /\[(Image|Vidéo|Audio|Fichier|Video):\s*([^\]]+)\]\(([^)]+)\)/gi;

  let result = content;
  let match;

  while ((match = mediaRegex.exec(content)) !== null) {
    const type = match[1].toLowerCase();
    const name = match[2];
    const url = match[3];
    const fullUrl = url.startsWith('http') ? url : API_URL + url;

    let mediaHtml = '';

    if (type === 'image') {
      mediaHtml = `
        <div class="message-media">
          <img src="${fullUrl}" alt="${escapeHtml(name)}" class="message-image" onclick="openImageViewer('${fullUrl}')" loading="lazy">
        </div>
      `;
    } else if (type === 'vidéo' || type === 'video') {
      mediaHtml = `
        <div class="message-media">
          <video src="${fullUrl}" class="message-video" controls preload="metadata">
            Votre navigateur ne supporte pas les vidéos.
          </video>
        </div>
      `;
    } else if (type === 'audio') {
      mediaHtml = `
        <div class="message-media message-audio">
          <i class="fas fa-music"></i>
          <audio src="${fullUrl}" controls preload="metadata"></audio>
          <span class="audio-name">${escapeHtml(name)}</span>
        </div>
      `;
    } else {
      // Fichier générique
      const iconClass = name.endsWith('.pdf') ? 'file-pdf' :
                        name.endsWith('.doc') || name.endsWith('.docx') ? 'file-word' :
                        name.endsWith('.xls') || name.endsWith('.xlsx') ? 'file-excel' :
                        name.endsWith('.zip') || name.endsWith('.rar') ? 'file-archive' : 'file';
      mediaHtml = `
        <div class="message-file" onclick="window.open('${fullUrl}', '_blank')">
          <div class="file-icon">
            <i class="fas fa-${iconClass}"></i>
          </div>
          <div class="file-info">
            <span class="file-name">${escapeHtml(name)}</span>
            <span class="file-download">Cliquez pour télécharger</span>
          </div>
        </div>
      `;
    }

    result = result.replace(match[0], mediaHtml);
  }

  // Pour le texte restant, échapper le HTML
  if (result === content) {
    return escapeHtml(content);
  }

  return result;
}

// Ouvrir la visionneuse d'images
function openImageViewer(imageUrl) {
  const viewer = document.createElement('div');
  viewer.className = 'image-viewer';
  viewer.innerHTML = `
    <div class="image-viewer-backdrop" onclick="closeImageViewer()"></div>
    <div class="image-viewer-content">
      <img src="${imageUrl}" alt="Image">
      <button class="image-viewer-close" onclick="closeImageViewer()">
        <i class="fas fa-times"></i>
      </button>
      <a href="${imageUrl}" download class="image-viewer-download">
        <i class="fas fa-download"></i>
      </a>
    </div>
  `;
  document.body.appendChild(viewer);
  setTimeout(() => viewer.classList.add('active'), 10);
}

function closeImageViewer() {
  const viewer = document.querySelector('.image-viewer');
  if (viewer) {
    viewer.classList.remove('active');
    setTimeout(() => viewer.remove(), 300);
  }
}

// Rendre les fonctions globales
window.openImageViewer = openImageViewer;
window.closeImageViewer = closeImageViewer;

// ==================== VOICE RECORDING ====================
async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.start();
    isRecording = true;
    recordingStartTime = Date.now();

    // Afficher l'interface d'enregistrement
    const voiceRecording = document.getElementById('voiceRecording');
    const voiceBtn = document.getElementById('voiceBtn');
    const inputContainer = document.querySelector('.message-input-container');

    if (voiceRecording) voiceRecording.classList.remove('hidden');
    if (voiceBtn) voiceBtn.classList.add('recording');
    if (inputContainer) inputContainer.style.display = 'none';

    // Démarrer le timer
    updateRecordingTime();
    recordingTimer = setInterval(updateRecordingTime, 1000);

  } catch (error) {
    console.error('Erreur accès microphone:', error);
    alert('Impossible d\'accéder au microphone. Veuillez autoriser l\'accès dans les paramètres.');
  }
}

function updateRecordingTime() {
  const recordingTimeEl = document.getElementById('recordingTime');
  if (recordingTimeEl && recordingStartTime) {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    recordingTimeEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;

  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
}

function cancelVoiceRecording() {
  stopVoiceRecording();
  audioChunks = [];
  hideVoiceRecordingUI();
}

function hideVoiceRecordingUI() {
  const voiceRecording = document.getElementById('voiceRecording');
  const voiceBtn = document.getElementById('voiceBtn');
  const inputContainer = document.querySelector('.message-input-container');

  if (voiceRecording) voiceRecording.classList.add('hidden');
  if (voiceBtn) voiceBtn.classList.remove('recording');
  if (inputContainer) inputContainer.style.display = 'flex';

  const recordingTimeEl = document.getElementById('recordingTime');
  if (recordingTimeEl) recordingTimeEl.textContent = '0:00';
}

async function sendVoiceMessage() {
  if (!mediaRecorder || audioChunks.length === 0) return;

  stopVoiceRecording();

  // Créer le blob audio
  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  const duration = Math.floor((Date.now() - recordingStartTime) / 1000);

  // Créer un fichier à partir du blob
  const file = new File([audioBlob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });

  // Uploader le fichier audio
  const formData = new FormData();
  formData.append('file', file);

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/api/upload/file`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    if (response.ok) {
      const data = await response.json();
      // Envoyer le message avec le fichier audio
      const voiceContent = `[Audio: Message vocal (${formatVoiceDuration(duration)})](${data.url})`;

      if (currentConversationId && socket) {
        socket.emit('send_message', {
          conversationId: currentConversationId,
          content: voiceContent,
          type: 'voice'
        });
      }
    }
  } catch (error) {
    console.error('Erreur upload audio:', error);
  }

  audioChunks = [];
  hideVoiceRecordingUI();
}

function formatVoiceDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Event listeners pour les boutons d'enregistrement vocal
document.getElementById('voiceBtn')?.addEventListener('click', () => {
  if (!isRecording) {
    startVoiceRecording();
  }
});

document.getElementById('cancelRecording')?.addEventListener('click', cancelVoiceRecording);
document.getElementById('sendRecording')?.addEventListener('click', sendVoiceMessage);

function showTypingIndicator() {
  let typingEl = document.getElementById('typingIndicator');
  if (!typingEl) {
    typingEl = document.createElement('div');
    typingEl.id = 'typingIndicator';
    typingEl.className = 'typing-indicator';
    typingEl.innerHTML = '<span></span><span></span><span></span>';
    messagesContainer.appendChild(typingEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function hideTypingIndicator() {
  const typingEl = document.getElementById('typingIndicator');
  if (typingEl) typingEl.remove();
}

function markMessagesAsRead() {
  document.querySelectorAll('.message.outgoing .message-time i').forEach(icon => icon.classList.add('read'));
}

function updateUserStatus(userId, status, lastSeen) {
  conversations.forEach(conv => {
    if (conv.participants?.some(p => p.id === userId)) {
      conv.status = status;
      conv.lastSeen = lastSeen;
    }
  });
  renderConversations();

  const currentConv = conversations.find(c => c.id === currentConversationId);
  if (currentConv?.participants?.some(p => p.id === userId)) {
    currentChatStatus.textContent = status === 'online' ? 'en ligne' : formatLastSeen(lastSeen);
    currentChatStatus.classList.toggle('offline', status !== 'online');
  }
}

// Sidebar
let menuOpen = false;
let overlay = null;

function openSidebar() {
  menuOpen = true;
  sidebarMenu.classList.add('open');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    document.querySelector('.main-container').appendChild(overlay);
    overlay.addEventListener('click', closeSidebar);
  }
  setTimeout(() => overlay.classList.add('active'), 10);
}

function closeSidebar() {
  menuOpen = false;
  sidebarMenu.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
}

// ==================== EVENT LISTENERS ====================
showRegister.addEventListener('click', (e) => { e.preventDefault(); loginPage.classList.add('hidden'); registerPage.classList.remove('hidden'); });
showLogin.addEventListener('click', (e) => { e.preventDefault(); registerPage.classList.add('hidden'); loginPage.classList.remove('hidden'); });

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  try {
    await login(document.getElementById('loginInput').value, document.getElementById('loginPassword').value);
  } catch (error) {
    loginError.textContent = error.message;
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  registerError.textContent = '';
  const password = document.getElementById('registerPassword').value;
  const confirmPassword = document.getElementById('registerConfirmPassword').value;

  if (password !== confirmPassword) { registerError.textContent = 'Les mots de passe ne correspondent pas'; return; }
  if (password.length < 6) { registerError.textContent = 'Le mot de passe doit contenir au moins 6 caractères'; return; }

  try {
    await register(
      document.getElementById('registerName').value,
      document.getElementById('registerUsername').value,
      document.getElementById('registerPhone').value,
      password
    );
  } catch (error) {
    registerError.textContent = error.message;
  }
});

menuBtn.addEventListener('click', () => menuOpen ? closeSidebar() : openSidebar());
menuLogout.addEventListener('click', () => { closeSidebar(); logout(); });
menuSettings.addEventListener('click', openSettings);

menuNewGroup.addEventListener('click', () => {
  closeSidebar();
  resetGroupForm();
  document.getElementById('newGroupModal').classList.add('active');
});

document.getElementById('menuNewChannel').addEventListener('click', () => {
  closeSidebar();
  resetChannelForm();
  document.getElementById('newChannelModal').classList.add('active');
});

menuContacts.addEventListener('click', () => {
  closeSidebar();
  renderContacts();
  document.getElementById('contactsModal').classList.add('active');
});

menuCalls.addEventListener('click', () => {
  closeSidebar();
  loadCalls();
  document.getElementById('callsModal').classList.add('active');
});

menuSaved.addEventListener('click', () => {
  closeSidebar();
  loadSavedMessages();
  document.getElementById('savedMessagesModal').classList.add('active');
});

menuAdmin.addEventListener('click', () => {
  closeSidebar();
  openAdminPanel();
});

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

messageInput.addEventListener('input', () => {
  if (socket && currentConversationId) {
    socket.emit('typing', { conversationId: currentConversationId });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stop_typing', { conversationId: currentConversationId }), 2000);
  }
});

searchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  document.querySelectorAll('.chat-item').forEach(item => {
    const name = item.querySelector('.chat-name').textContent.toLowerCase();
    const preview = item.querySelector('.chat-preview').textContent.toLowerCase();
    item.style.display = (name.includes(query) || preview.includes(query)) ? 'flex' : 'none';
  });
});

newChatBtn.addEventListener('click', () => {
  document.getElementById('newChatModal').classList.add('active');
  document.getElementById('userSearchInput').focus();
});

document.getElementById('closeNewChatModal').addEventListener('click', () => {
  document.getElementById('newChatModal').classList.remove('active');
});

document.getElementById('userSearchInput').addEventListener('input', (e) => {
  searchUsers(e.target.value, document.getElementById('userSearchResults'), startConversation);
});

// Group modal
document.getElementById('closeNewGroupModal').addEventListener('click', () => document.getElementById('newGroupModal').classList.remove('active'));
document.getElementById('createGroupBtn').addEventListener('click', createGroup);

document.getElementById('groupMemberSearch').addEventListener('input', (e) => {
  searchUsers(e.target.value, document.getElementById('memberSearchResults'), addGroupMember);
});

document.getElementById('groupAvatarInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    groupAvatarFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('groupAvatarPreview').innerHTML = `<img src="${ev.target.result}" alt="">`;
    };
    reader.readAsDataURL(file);
  }
});

// Contacts modal
document.getElementById('closeContactsModal').addEventListener('click', () => document.getElementById('contactsModal').classList.remove('active'));
document.getElementById('addContactBtn').addEventListener('click', () => document.getElementById('addContactModal').classList.add('active'));
document.getElementById('closeAddContactModal').addEventListener('click', () => document.getElementById('addContactModal').classList.remove('active'));

document.getElementById('addContactSearchInput').addEventListener('input', (e) => {
  searchUsers(e.target.value, document.getElementById('addContactResults'), addContact);
});

// Calls modal
document.getElementById('closeCallsModal').addEventListener('click', () => document.getElementById('callsModal').classList.remove('active'));

// Saved messages modal
document.getElementById('closeSavedMessagesModal').addEventListener('click', () => document.getElementById('savedMessagesModal').classList.remove('active'));

// Settings modal
document.getElementById('closeSettingsModal').addEventListener('click', () => document.getElementById('settingsModal').classList.remove('active'));
document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
document.getElementById('avatarInput').addEventListener('change', (e) => { if (e.target.files[0]) uploadAvatar(e.target.files[0]); });

// Call buttons
document.getElementById('callAudioBtn').addEventListener('click', () => {
  const conv = conversations.find(c => c.id === currentConversationId);
  if (conv?.type === 'private') {
    const otherUser = conv.participants?.find(p => p.id !== currentUser.id);
    if (otherUser) initiateCall(otherUser.id, 'audio');
  }
});

document.getElementById('callVideoBtn').addEventListener('click', () => {
  const conv = conversations.find(c => c.id === currentConversationId);
  if (conv?.type === 'private') {
    const otherUser = conv.participants?.find(p => p.id !== currentUser.id);
    if (otherUser) initiateCall(otherUser.id, 'video');
  }
});

document.getElementById('acceptCallBtn').addEventListener('click', () => answerCall(true));
document.getElementById('declineCallBtn').addEventListener('click', () => answerCall(false));
document.getElementById('endCallBtn').addEventListener('click', endCall);

// Emoji picker
document.getElementById('emojiBtn').addEventListener('click', toggleEmojiPicker);

// Attach button
document.getElementById('attachBtn').addEventListener('click', () => {
  // Créer un input file caché
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 25 * 1024 * 1024) {
        alert('Le fichier est trop volumineux (max 25MB)');
        return;
      }
      showAttachmentPreview(file);
    }
    document.body.removeChild(fileInput);
  });

  fileInput.click();
});

// Chat search button
document.getElementById('chatSearchBtn').addEventListener('click', () => {
  let searchBar = document.getElementById('messageSearchBar');

  if (!searchBar) {
    // Créer la barre de recherche
    searchBar = document.createElement('div');
    searchBar.id = 'messageSearchBar';
    searchBar.className = 'message-search-bar';
    searchBar.innerHTML = `
      <div class="search-bar-content">
        <i class="fas fa-search"></i>
        <input type="text" id="messageSearchInput" placeholder="Rechercher dans la conversation...">
        <span id="searchResultsInfo"></span>
        <button class="search-nav-btn" onclick="prevSearchResult()"><i class="fas fa-chevron-up"></i></button>
        <button class="search-nav-btn" onclick="nextSearchResult()"><i class="fas fa-chevron-down"></i></button>
        <button class="search-close-btn" onclick="closeMessageSearch()"><i class="fas fa-times"></i></button>
      </div>
    `;

    const chatContent = document.getElementById('chatContent');
    const chatHeader = chatContent.querySelector('.chat-header');
    chatHeader.insertAdjacentElement('afterend', searchBar);

    // Event listener pour la recherche
    document.getElementById('messageSearchInput').addEventListener('input', (e) => {
      clearTimeout(window.searchTimeout);
      window.searchTimeout = setTimeout(() => {
        searchMessagesInConversation(e.target.value);
      }, 300);
    });
  }

  searchBar.style.display = searchBar.style.display === 'none' ? 'flex' : 'none';
  if (searchBar.style.display !== 'none') {
    document.getElementById('messageSearchInput').focus();
  }
});

window.prevSearchResult = prevSearchResult;
window.nextSearchResult = nextSearchResult;
window.closeMessageSearch = closeMessageSearch;

// Chat menu (3 dots)
document.getElementById('chatMenuBtn').addEventListener('click', showChatContextMenu);
document.getElementById('chatMenuInfo').addEventListener('click', showGroupInfo);
document.getElementById('chatMenuEdit').addEventListener('click', openEditGroupModal);
document.getElementById('chatMenuMembers').addEventListener('click', openManageMembersModal);
document.getElementById('chatMenuLeave').addEventListener('click', leaveGroup);

// Group info modal
document.getElementById('closeGroupInfoModal').addEventListener('click', () => document.getElementById('groupInfoModal').classList.remove('active'));

// Click sur header pour afficher infos groupe/canal
document.getElementById('chatHeaderLeft').addEventListener('click', () => {
  const conv = conversations.find(c => c.id === currentConversationId);
  if (conv && (conv.type === 'group' || conv.type === 'channel')) {
    showGroupInfo();
  } else if (conv && conv.type === 'private') {
    showUserProfile();
  }
});

// Bouton modifier dans modal info groupe
document.getElementById('groupInfoEditBtn').addEventListener('click', () => {
  document.getElementById('groupInfoModal').classList.remove('active');
  openEditGroupModal();
});

// User profile modal
document.getElementById('closeUserProfileModal').addEventListener('click', () => document.getElementById('userProfileModal').classList.remove('active'));

// Edit group modal
document.getElementById('closeEditGroupModal').addEventListener('click', () => document.getElementById('editGroupModal').classList.remove('active'));
document.getElementById('saveGroupBtn').addEventListener('click', saveGroupChanges);
document.getElementById('editGroupAvatarInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    editGroupAvatarFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('editGroupAvatarPreview').innerHTML = `<img src="${ev.target.result}" alt="">`;
    };
    reader.readAsDataURL(file);
  }
});

// Manage members modal
document.getElementById('closeManageMembersModal').addEventListener('click', () => document.getElementById('manageMembersModal').classList.remove('active'));
document.getElementById('addMemberSearch').addEventListener('input', (e) => {
  searchUsers(e.target.value, document.getElementById('addMemberResults'), addMemberToGroup);
});

// Channel modal
document.getElementById('closeNewChannelModal').addEventListener('click', () => document.getElementById('newChannelModal').classList.remove('active'));
document.getElementById('createChannelBtn').addEventListener('click', createChannel);
document.getElementById('channelAvatarInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    channelAvatarFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('channelAvatarPreview').innerHTML = `<img src="${ev.target.result}" alt="">`;
    };
    reader.readAsDataURL(file);
  }
});

// Context menu
document.getElementById('contextCopy').addEventListener('click', () => {
  const msg = document.querySelector(`[data-message-id="${selectedMessageId}"] .message-text`);
  if (msg) navigator.clipboard.writeText(msg.textContent);
  hideContextMenu();
});

document.getElementById('contextSave').addEventListener('click', async () => {
  if (selectedMessageId && currentConversationId) {
    if (selectedMessageIsSaved) {
      await unsaveMessage(selectedMessageId);
    } else {
      await saveMessage(selectedMessageId, currentConversationId);
    }
  }
  hideContextMenu();
});

document.getElementById('contextDelete').addEventListener('click', async () => {
  if (selectedMessageId) {
    await deleteMessage(selectedMessageId);
  }
  hideContextMenu();
});

document.getElementById('contextReply').addEventListener('click', () => {
  startReply();
  hideContextMenu();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.context-menu')) hideContextMenu();
  if (!e.target.closest('.context-menu') && !e.target.closest('#chatMenuBtn')) hideChatContextMenu();
  if (!e.target.closest('.emoji-picker') && !e.target.closest('#emojiBtn')) {
    document.getElementById('emojiPicker').classList.remove('active');
  }
});

// Close modals on outside click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });
});

// Make functions available globally
window.removeGroupMember = removeGroupMember;
window.deleteContact = deleteContact;
window.startConversationWithContact = startConversationWithContact;
window.initiateCall = initiateCall;
window.unsaveMessage = unsaveMessage;
window.removeMemberFromGroup = removeMemberFromGroup;

// ==================== ADMIN PANEL ====================

// Event listener pour le menu admin
document.getElementById('menuAdmin')?.addEventListener('click', () => {
  console.log('Menu Admin clicked!');
  closeSideMenu();
  openAdminPanel();
});

// Event listener pour fermer le modal admin
document.getElementById('closeAdminPanelModal')?.addEventListener('click', () => {
  document.getElementById('adminPanelModal').classList.remove('active');
});

// Event listeners pour les tabs admin
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;

    // Activer le tab
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Afficher le contenu correspondant
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));

    switch(tabName) {
      case 'dashboard':
        document.getElementById('adminDashboard').classList.add('active');
        loadAdminStats();
        break;
      case 'users':
        document.getElementById('adminUsers').classList.add('active');
        loadAdminUsers();
        break;
      case 'conversations':
        document.getElementById('adminConversations').classList.add('active');
        loadAdminConversations();
        break;
      case 'messages':
        document.getElementById('adminMessages').classList.add('active');
        loadAdminMessages();
        break;
      case 'logs':
        document.getElementById('adminLogs').classList.add('active');
        loadAdminLogs();
        break;
    }
  });
});

function openAdminPanel() {
  console.log('openAdminPanel called');

  // Ouvrir le modal admin
  document.getElementById('adminPanelModal').classList.add('active');

  // Charger le dashboard par défaut
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.admin-tab[data-tab="dashboard"]').classList.add('active');
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('adminDashboard').classList.add('active');

  loadAdminStats();
}

async function loadAdminStats() {
  try {
    const response = await fetch(`${API_URL}/api/admin/stats`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await response.json();

    document.getElementById('statTotalUsers').textContent = data.totalUsers;
    document.getElementById('statOnlineUsers').textContent = data.onlineUsers;
    document.getElementById('statTotalMessages').textContent = data.totalMessages;
    document.getElementById('statMessagesToday').textContent = data.messagesToday;
    document.getElementById('statTotalGroups').textContent = data.totalGroups;
    document.getElementById('statTotalChannels').textContent = data.totalChannels;
    document.getElementById('statTotalCalls').textContent = data.totalCalls;
    document.getElementById('statActiveUsers').textContent = data.activeUsers;
  } catch (error) {
    console.error('Erreur chargement stats:', error);
  }
}

async function loadAdminUsers() {
  try {
    const response = await fetch(`${API_URL}/api/admin/users`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await response.json();

    const tbody = document.getElementById('adminUsersTableBody');
    tbody.innerHTML = '';

    data.users.forEach(user => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="user-avatar">
            ${user.avatar
              ? `<img src="${API_URL}${user.avatar}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'avatar-placeholder\\'><i class=\\'fas fa-user\\'></i></div>';">`
              : `<div class="avatar-placeholder"><i class="fas fa-user"></i></div>`
            }
          </div>
        </td>
        <td>
          ${user.displayName}
          ${user.isAdmin ? '<span class="admin-badge">ADMIN</span>' : ''}
        </td>
        <td>@${user.username}</td>
        <td>
          <span class="status-badge ${user.status}">${user.status === 'online' ? 'En ligne' : 'Hors ligne'}</span>
        </td>
        <td>${user.messageCount}</td>
        <td>${formatDate(user.createdAt)}</td>
        <td>
          <button class="admin-action-btn view" onclick="viewAdminUser('${user.id}')" title="Voir détails">
            <i class="fas fa-eye"></i>
          </button>
          <button class="admin-action-btn ${user.isAdmin ? 'warning' : 'promote'}" onclick="toggleAdminUser('${user.id}', ${!user.isAdmin})" title="${user.isAdmin ? 'Retirer admin' : 'Promouvoir admin'}">
            <i class="fas fa-${user.isAdmin ? 'user-minus' : 'user-shield'}"></i>
          </button>
          ${!user.isAdmin ? `
            <button class="admin-action-btn delete" onclick="deleteAdminUser('${user.id}', '${user.displayName}')" title="Supprimer">
              <i class="fas fa-trash"></i>
            </button>
          ` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Erreur chargement utilisateurs:', error);
  }
}

async function loadAdminConversations() {
  try {
    const response = await fetch(`${API_URL}/api/admin/conversations`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await response.json();

    const tbody = document.getElementById('adminConversationsTableBody');
    tbody.innerHTML = '';

    data.conversations.forEach(conv => {
      const tr = document.createElement('tr');
      const typeLabel = conv.type === 'group' ? 'Groupe' : conv.type === 'channel' ? 'Canal' : 'Privé';
      tr.innerHTML = `
        <td>
          <div class="user-avatar">
            ${conv.avatar
              ? `<img src="${API_URL}${conv.avatar}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'avatar-placeholder\\'><i class=\\'fas fa-${conv.type === 'group' ? 'users' : conv.type === 'channel' ? 'bullhorn' : 'user'}\\'></i></div>';">`
              : `<div class="avatar-placeholder"><i class="fas fa-${conv.type === 'group' ? 'users' : conv.type === 'channel' ? 'bullhorn' : 'user'}"></i></div>`
            }
          </div>
        </td>
        <td>${conv.name || 'Conversation privée'}</td>
        <td><span class="type-badge ${conv.type}">${typeLabel}</span></td>
        <td>${conv.memberCount}</td>
        <td>${conv.messageCount}</td>
        <td>${conv.creatorName || '-'}</td>
        <td>
          <button class="admin-action-btn delete" onclick="deleteAdminConversation('${conv.id}', '${conv.name || 'cette conversation'}')" title="Supprimer">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Erreur chargement conversations:', error);
  }
}

async function loadAdminMessages() {
  try {
    const response = await fetch(`${API_URL}/api/admin/messages/recent`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await response.json();

    const container = document.getElementById('adminMessagesList');

    if (data.messages.length === 0) {
      container.innerHTML = `
        <div class="admin-empty-state">
          <i class="fas fa-envelope"></i>
          <p>Aucun message récent</p>
        </div>
      `;
      return;
    }

    container.innerHTML = data.messages.map(msg => `
      <div class="admin-message-item">
        <div class="admin-message-header">
          <div class="admin-message-sender">
            <div class="user-avatar">
              ${msg.senderAvatar
                ? `<img src="${API_URL}${msg.senderAvatar}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'avatar-placeholder\\'><i class=\\'fas fa-user\\'></i></div>';">`
                : `<div class="avatar-placeholder"><i class="fas fa-user"></i></div>`
              }
            </div>
            <div class="admin-message-sender-info">
              <span class="admin-message-sender-name">${msg.senderName}</span>
              <span class="admin-message-conv">${msg.conversationName || 'Conversation privée'} (${msg.conversationType === 'group' ? 'Groupe' : msg.conversationType === 'channel' ? 'Canal' : 'Privé'})</span>
            </div>
          </div>
          <span class="admin-message-time">${formatDateTime(msg.createdAt)}</span>
        </div>
        <div class="admin-message-content">${escapeHtml(msg.content)}</div>
        <div class="admin-message-actions">
          <button class="admin-action-btn delete" onclick="deleteAdminMessage('${msg.id}')" title="Supprimer">
            <i class="fas fa-trash"></i> Supprimer
          </button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Erreur chargement messages:', error);
  }
}

async function loadAdminLogs() {
  try {
    const response = await fetch(`${API_URL}/api/admin/logs`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await response.json();

    const container = document.getElementById('adminLogsList');

    if (data.logs.length === 0) {
      container.innerHTML = `
        <div class="admin-empty-state">
          <i class="fas fa-history"></i>
          <p>Aucune activité enregistrée</p>
        </div>
      `;
      return;
    }

    container.innerHTML = data.logs.map(log => {
      const iconClass = log.action.includes('delete') ? 'delete' : log.action.includes('create') ? 'create' : 'edit';
      const icon = log.action.includes('delete') ? 'trash' : log.action.includes('create') ? 'plus' : 'edit';
      const actionLabel = getActionLabel(log.action);

      return `
        <div class="admin-log-item">
          <div class="admin-log-icon ${iconClass}">
            <i class="fas fa-${icon}"></i>
          </div>
          <div class="admin-log-info">
            <span class="admin-log-action">${actionLabel}</span>
            <span class="admin-log-details">Par ${log.adminName || 'Admin'} ${log.details ? `- ${JSON.stringify(log.details)}` : ''}</span>
          </div>
          <span class="admin-log-time">${formatDateTime(log.createdAt)}</span>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Erreur chargement logs:', error);
  }
}

function getActionLabel(action) {
  const labels = {
    'delete_user': 'Utilisateur supprimé',
    'delete_message': 'Message supprimé',
    'delete_conversation': 'Conversation supprimée',
    'create_user': 'Utilisateur créé',
    'edit_user': 'Utilisateur modifié'
  };
  return labels[action] || action;
}

async function viewAdminUser(userId) {
  try {
    const response = await fetch(`${API_URL}/api/admin/users/${userId}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await response.json();
    const user = data.user;

    showCustomConfirm(
      `<strong>${user.displayName}</strong><br>
       @${user.username}<br><br>
       <small>Téléphone: ${user.phone || 'Non visible'}</small><br>
       <small>Bio: ${user.bio || 'Aucune'}</small><br>
       <small>Messages: ${user.messageCount}</small><br>
       <small>Conversations: ${user.conversationCount}</small><br>
       <small>Inscrit le: ${formatDate(user.createdAt)}</small>`,
      'Détails utilisateur',
      'info',
      'Fermer',
      null
    ).catch(() => {});
  } catch (error) {
    console.error('Erreur chargement détails utilisateur:', error);
  }
}

async function deleteAdminUser(userId, userName) {
  try {
    const confirmed = await showCustomConfirm(
      `Voulez-vous vraiment supprimer l'utilisateur "${userName}" ? Cette action est irréversible.`,
      'Supprimer l\'utilisateur',
      'danger'
    );

    if (!confirmed) return;

    const response = await fetch(`${API_URL}/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });

    if (response.ok) {
      loadAdminUsers();
      loadAdminStats();
    } else {
      const error = await response.json();
      alert(error.error || 'Erreur lors de la suppression');
    }
  } catch (error) {
    console.error('Erreur suppression utilisateur:', error);
  }
}

async function toggleAdminUser(userId, makeAdmin) {
  try {
    const action = makeAdmin ? 'promouvoir administrateur' : 'retirer le statut administrateur de';
    const confirmed = await showCustomConfirm(
      `Voulez-vous vraiment ${action} cet utilisateur ?`,
      makeAdmin ? 'Promouvoir admin' : 'Retirer admin',
      makeAdmin ? 'success' : 'warning'
    );

    if (!confirmed) return;

    const response = await fetch(`${API_URL}/api/admin/users/${userId}/admin`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ isAdmin: makeAdmin })
    });

    if (response.ok) {
      loadAdminUsers();
      loadAdminStats();
    } else {
      const error = await response.json();
      alert(error.error || 'Erreur lors de la modification');
    }
  } catch (error) {
    console.error('Erreur toggle admin:', error);
  }
}
window.toggleAdminUser = toggleAdminUser;

async function deleteAdminConversation(convId, convName) {
  try {
    const confirmed = await showCustomConfirm(
      `Voulez-vous vraiment supprimer "${convName}" ? Tous les messages seront perdus.`,
      'Supprimer la conversation',
      'danger'
    );

    if (!confirmed) return;

    const response = await fetch(`${API_URL}/api/admin/conversations/${convId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });

    if (response.ok) {
      loadAdminConversations();
      loadAdminStats();
      loadConversations();
    } else {
      const error = await response.json();
      alert(error.error || 'Erreur lors de la suppression');
    }
  } catch (error) {
    console.error('Erreur suppression conversation:', error);
  }
}

async function deleteAdminMessage(messageId) {
  try {
    const confirmed = await showCustomConfirm(
      'Voulez-vous vraiment supprimer ce message ?',
      'Supprimer le message',
      'danger'
    );

    if (!confirmed) return;

    const response = await fetch(`${API_URL}/api/admin/messages/${messageId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });

    if (response.ok) {
      loadAdminMessages();
      loadAdminStats();
    } else {
      const error = await response.json();
      alert(error.error || 'Erreur lors de la suppression');
    }
  } catch (error) {
    console.error('Erreur suppression message:', error);
  }
}

function formatDateTime(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR') + ' ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Recherche admin users
document.getElementById('adminUserSearch')?.addEventListener('input', async (e) => {
  const query = e.target.value.toLowerCase();
  const rows = document.querySelectorAll('#adminUsersTableBody tr');
  rows.forEach(row => {
    const name = row.querySelector('td:nth-child(2)')?.textContent.toLowerCase() || '';
    const username = row.querySelector('td:nth-child(3)')?.textContent.toLowerCase() || '';
    row.style.display = name.includes(query) || username.includes(query) ? '' : 'none';
  });
});

// Recherche admin conversations
document.getElementById('adminConvSearch')?.addEventListener('input', async (e) => {
  const query = e.target.value.toLowerCase();
  const rows = document.querySelectorAll('#adminConversationsTableBody tr');
  rows.forEach(row => {
    const name = row.querySelector('td:nth-child(2)')?.textContent.toLowerCase() || '';
    row.style.display = name.includes(query) ? '' : 'none';
  });
});

// Export admin functions
window.viewAdminUser = viewAdminUser;
window.deleteAdminUser = deleteAdminUser;
window.deleteAdminConversation = deleteAdminConversation;
window.deleteAdminMessage = deleteAdminMessage;

// ==================== INITIALIZATION ====================
async function init() {
  console.log('Connexion au serveur:', API_URL);

  initEmojiPicker();
  setupUpdateHandlers();
  displayAppVersion();

  // Demander permission pour les notifications
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  const token = localStorage.getItem('token');
  if (token) {
    const valid = await verifyToken();
    if (!valid) {
      showAuth();
    } else {
      // Vérifier le statut admin après connexion
      checkAdminStatus();
    }
  } else {
    showAuth();
  }
}

init();
