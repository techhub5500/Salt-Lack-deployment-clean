// ======================== VARIÁVEIS GLOBAIS ========================
// Controle de socket, usuário, chat, convites, sessão e digitação
let socket = null;
let currentUser = null;
let currentChat = null;
let selectedUserForInvite = null;
let currentInvite = null;
let typingTimer = null;
let isTyping = false;
let sessionId = null; // Nova variável para controle de sessão

function getApiUrl(service) {
    const isProduction = window.location.hostname !== 'localhost';
    const urls = {
        socket: isProduction ? 'https://seu-socket-server.onrender.com' : 'http://localhost:3000',
        lateral: isProduction ? 'https://seu-lateral-server.onrender.com' : 'http://localhost:5001', 
        colaborativo: isProduction ? 'https://seu-colaborativo-server.onrender.com' : 'http://localhost:5002'
    };
    return urls[service];
}

// ======================== SISTEMA DE CACHE HÍBRIDO ========================
// Mantém cache local para performance, mas sempre sincroniza com MongoDB
class CacheManager {
    constructor() {
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutos
    }
    // Cache para dados do usuário atual
    cacheUserData(userData) {
        const cacheData = {
            data: userData,
            timestamp: Date.now()
        };
        localStorage.setItem('userCache', JSON.stringify(cacheData));
    }
    getCachedUserData() {
        try {
            const cached = localStorage.getItem('userCache');
            if (cached) {
                const cacheData = JSON.parse(cached);
                const isExpired = (Date.now() - cacheData.timestamp) > this.cacheTimeout;
                if (!isExpired) {
                    return cacheData.data;
                }
            }
        } catch (e) {
            localStorage.removeItem('userCache');
        }
        return null;
    }
    clearUserCache() {
        localStorage.removeItem('userCache');
    }
    // Cache para lista de chats
    cacheUserChats(chats) {
        const cacheData = {
            data: chats,
            timestamp: Date.now()
        };
        localStorage.setItem('chatsCache', JSON.stringify(cacheData));
    }
    getCachedChats() {
        try {
            const cached = localStorage.getItem('chatsCache');
            if (cached) {
                const cacheData = JSON.parse(cached);
                const isExpired = (Date.now() - cacheData.timestamp) > this.cacheTimeout;
                if (!isExpired) {
                    return cacheData.data;
                }
            }
        } catch (e) {
            localStorage.removeItem('chatsCache');
        }
        return null;
    }
    // Cache para mensagens de chat específico
    cacheChatMessages(chatId, messages) {
        const cacheData = {
            data: messages,
            timestamp: Date.now()
        };
        localStorage.setItem(`chatCache_${chatId}`, JSON.stringify(cacheData));
    }
    getCachedMessages(chatId) {
        try {
            const cached = localStorage.getItem(`chatCache_${chatId}`);
            if (cached) {
                const cacheData = JSON.parse(cached);
                const isExpired = (Date.now() - cacheData.timestamp) > this.cacheTimeout;
                if (!isExpired) {
                    return cacheData.data;
                }
            }
        } catch (e) {
            localStorage.removeItem(`chatCache_${chatId}`);
        }
        return [];
    }
    clearChatCache(chatId) {
        localStorage.removeItem(`chatCache_${chatId}`);
    }
    clearAllCache() {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('userCache') || 
                key.startsWith('chatsCache') || 
                key.startsWith('chatCache_')) {
                localStorage.removeItem(key);
            }
        });
    }
}
const cacheManager = new CacheManager();

// ======================== GERENCIAMENTO DE USUÁRIO E SESSÃO ========================
async function saveCurrentUser() {
    if (currentUser) {
        cacheManager.cacheUserData(currentUser);
        if (currentChat) {
            try {
                // USAR URL DINÂMICA
                await fetch(`${getApiUrl('socket')}/api/users/${currentUser.id}/current-chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chatId: currentChat })
                });
            } catch (error) {
                console.error('Erro ao salvar chat atual:', error);
            }
        }
    }
}
async function restoreCurrentUser() {
    const cachedUser = cacheManager.getCachedUserData();
    if (cachedUser) {
        currentUser = cachedUser;
        return true;
    }
    return false;
}
async function clearCurrentUser() {
    if (currentUser && sessionId) {
        try {
            // USAR URL DINÂMICA
            await fetch(`${getApiUrl('socket')}/api/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    userId: currentUser.id,
                    sessionId: sessionId 
                })
            });
        } catch (error) {
            console.error('Erro no logout:', error);
        }
    }
    cacheManager.clearAllCache();
    currentUser = null;
    currentChat = null;
    sessionId = null;
}

// ======================== GERENCIAMENTO DE CHATS ========================
async function saveUserChats(chats) {
    if (currentUser && Array.isArray(chats)) {
        cacheManager.cacheUserChats(chats);
    }
}
async function restoreUserChats() {
    if (!currentUser) return [];
    const cachedChats = cacheManager.getCachedChats();
    if (cachedChats) {
        return cachedChats;
    }
    try {
        // USAR URL DINÂMICA
        const response = await fetch(`${getApiUrl('socket')}/api/chats/${currentUser.id}`);
        const chats = await response.json();
        cacheManager.cacheUserChats(chats);
        return chats;
    } catch (error) {
        console.error('Erro ao buscar chats:', error);
        return [];
    }
}

async function saveCurrentChatId() {
    if (currentUser && currentChat) {
        try {
            // USAR URL DINÂMICA
            await fetch(`${getApiUrl('socket')}/api/users/${currentUser.id}/current-chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId: currentChat })
            });
        } catch (error) {
            console.error('Erro ao salvar chat atual:', error);
        }
    }
}

async function restoreCurrentChatId() {
    if (currentUser && currentUser.currentChatId) {
        return currentUser.currentChatId;
    }
    return null;
}

// ======================== GERENCIAMENTO DE MENSAGENS ========================
function saveChatMessages(chatId, messages) {
    cacheManager.cacheChatMessages(chatId, messages);
}
function restoreChatMessages(chatId) {
    return cacheManager.getCachedMessages(chatId);
}

// ======================== SISTEMA DE CONTADORES (MONGODB) ========================
async function saveUnreadCount(chatId, count) {
    if (!currentUser) return;
    try {
        // USAR URL DINÂMICA
        await fetch(`${getApiUrl('socket')}/api/chats/${chatId}/unread`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId: currentUser.id, 
                count: count 
            })
        });
    } catch (error) {
        console.error('Erro ao salvar contador:', error);
        localStorage.setItem(`unreadCount_${chatId}`, count);
    }
}

async function restoreUnreadCount(chatId) {
    if (!currentUser) return 0;
    try {
        // USAR URL DINÂMICA
        const response = await fetch(`${getApiUrl('socket')}/api/users/${currentUser.id}/unread-counts`);
        const unreadCounts = await response.json();
        return unreadCounts[chatId] || 0;
    } catch (error) {
        console.error('Erro ao buscar contador:', error);
        const saved = localStorage.getItem(`unreadCount_${chatId}`);
        return saved ? parseInt(saved, 10) : 0;
    }
}
async function resetUnreadCount(chatId) {
    await saveUnreadCount(chatId, 0);
}
async function incrementUnreadCount(chatId) {
    const currentCount = await restoreUnreadCount(chatId);
    await saveUnreadCount(chatId, currentCount + 1);
}

// ======================== DOM ELEMENTS ========================
const authModal = document.getElementById('authModal');
const chatContainer = document.getElementById('chatContainer');
const inviteModal = document.getElementById('inviteModal');
const inviteReceivedModal = document.getElementById('inviteReceivedModal');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authTitle = document.getElementById('authTitle');
const authError = document.getElementById('authError');
const showRegister = document.getElementById('showRegister');
const showLogin = document.getElementById('showLogin');
const currentUserSpan = document.getElementById('currentUser');
const chatsList = document.getElementById('chatsList');
const messagesContainer = document.getElementById('messagesContainer');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const typingIndicator = document.getElementById('typingIndicator');
const typingText = document.getElementById('typingText');
const invitesSection = document.getElementById('invitesSection');
const invitesList = document.getElementById('invitesList');
const logoutBtn = document.getElementById('logoutBtn');
const inviteBtn = document.getElementById('inviteBtn');
const searchUserInput = document.getElementById('searchUserInput');
const searchResults = document.getElementById('searchResults');
const chatNameInput = document.getElementById('chatNameInput');
const sendInviteBtn = document.getElementById('sendInviteBtn');
const cancelInvite = document.getElementById('cancelInvite');
const inviteMessage = document.getElementById('inviteMessage');
const acceptInvite = document.getElementById('acceptInvite');
const rejectInvite = document.getElementById('rejectInvite');
const connectionStatus = document.getElementById('connectionStatus');
const logoutConfirmModal = document.getElementById('logoutConfirmModal');
const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');
const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');

// ======================== EVENT LISTENERS ========================
showRegister.addEventListener('click', (e) => {
    e.preventDefault();
    showRegisterForm();
});
showLogin.addEventListener('click', (e) => {
    e.preventDefault();
    showLoginForm();
});
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (username && password) {
        await handleLogin(username, password);
    }
});
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;
    if (password !== confirmPassword) {
        showError('As senhas não coincidem');
        return;
    }
    if (username && email && password) {
        await handleRegister(username, email, password);
    }
});
logoutBtn.addEventListener('click', () => {
    if (currentUser) {
        // Usuário logado: mostra modal de confirmação
        logoutConfirmModal.classList.remove('hidden');
    } else {
        // Usuário não logado: mostra formulário de login
        if (authModal) authModal.classList.remove('hidden');
    }
});

if (confirmLogoutBtn) {
    confirmLogoutBtn.onclick = async () => {
        logoutConfirmModal.classList.add('hidden');
        await handleLogout();
    };
}
if (cancelLogoutBtn) {
    cancelLogoutBtn.onclick = () => {
        logoutConfirmModal.classList.add('hidden');
    };
}
inviteBtn.addEventListener('click', () => {
    inviteModal.classList.remove('hidden');
    searchUserInput.focus();
});
cancelInvite.addEventListener('click', () => {
    closeInviteModal();
});
sendInviteBtn.addEventListener('click', () => {
    handleSendInvite();
});
searchUserInput.addEventListener('input', debounce(handleUserSearch, 300));
acceptInvite.addEventListener('click', () => {
    if (currentInvite) {
        socket.emit('accept_invite', currentInvite.id);
        inviteReceivedModal.classList.add('hidden');
    }
});
rejectInvite.addEventListener('click', () => {
    if (currentInvite) {
        socket.emit('reject_invite', currentInvite.id);
        inviteReceivedModal.classList.add('hidden');
    }
});
messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = messageInput.value.trim();
    if (message && currentChat && socket && socket.connected) {
        displayMessage({
            message: message,
            username: currentUser.username,
            userId: currentUser.id,
            timestamp: new Date().toISOString()
        }, 'own');
        socket.emit('send_message', { 
            chatId: currentChat,
            message: message 
        });
        messageInput.value = '';
        clearTimeout(typingTimer);
        if (isTyping) {
            socket.emit('typing', { isTyping: false, chatId: currentChat });
            isTyping = false;
        }
    } else {
        console.error('Não é possível enviar mensagem:', { 
            message: !!message, 
            currentChat: !!currentChat, 
            socket: !!socket, 
            connected: socket?.connected 
        });
    }
});
messageInput.addEventListener('input', () => {
    if (!currentChat || !socket || !socket.connected) return;
    if (!isTyping) {
        isTyping = true;
        socket.emit('typing', { isTyping: true, chatId: currentChat });
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        isTyping = false;
        socket.emit('typing', { isTyping: false, chatId: currentChat });
    }, 1000);
});

// ======================== FUNÇÕES DE AUTENTICAÇÃO ========================
function showRegisterForm() {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    authTitle.textContent = 'Cadastrar no Chat';
    clearError();
}
function showLoginForm() {
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    authTitle.textContent = 'Entrar no Chat';
    clearError();
}
async function handleLogin(username, password) {
    try {
        // USAR URL DINÂMICA
        const response = await fetch(`${getApiUrl('socket')}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
        });
        const data = await response.json();
         if (response.ok) {
            currentUser = data.user;
            // SALVAR userId no localStorage SEMPRE que fizer login
            localStorage.setItem('userId', currentUser.id);
            console.log('userId salvo no localStorage:', currentUser.id); // debug
            
            // opcional: salvar token se o backend retornar
            if (data.token) { 
                localStorage.setItem('token', data.token); 
                console.log('token salvo no localStorage'); // debug
            }
            
            sessionId = data.sessionId;
            cacheManager.cacheUserData(currentUser);
            if (data.userChats) {
                cacheManager.cacheUserChats(data.userChats);
            }
            initializeChat(data);
            if (typeof loadHistory === 'function') loadHistory();
            if (typeof loadSharingData === 'function') loadSharingData();
        } else {
            showError(data.error);
        }
    } catch (error) {
        console.error('Erro no login:', error);
        showError('Erro de conexão. Tente novamente.');
    }
}

async function handleRegister(username, email, password) {
    try {
        // USAR URL DINÂMICA
        const response = await fetch(`${getApiUrl('socket')}/api/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, email, password }),
        });
        const data = await response.json();
        if (response.ok) {
            showSuccess('Cadastro realizado com sucesso! Faça login para continuar.');
            setTimeout(() => {
                showLoginForm();
                document.getElementById('loginUsername').value = username;
            }, 2000);
        } else {
            showError(data.error);
        }
    } catch (error) {
        console.error('Erro no cadastro:', error);
        showError('Erro de conexão. Tente novamente.');
    }
}
async function handleLogout() {
    if (socket) {
        socket.disconnect();
    }
    await clearCurrentUser();
    location.reload();
}

// ======================== FUNÇÕES DO CHAT ========================
async function initializeChat(loginData = null) {
    authModal.classList.add('hidden');
    currentUserSpan.textContent = `Olá, ${currentUser.username}!`;
    initializeSocket();
    let userChats = [];
    if (loginData && loginData.userChats) {
        userChats = loginData.userChats;
    } else {
        userChats = await restoreUserChats();
    }
    chatsList.innerHTML = '';
    for (const chat of userChats) {
        await addChatToList(chat);
    }
    const lastChatId = await restoreCurrentChatId();
    if (lastChatId) {
        const chatElement = Array.from(document.querySelectorAll('.chat-item')).find(
            el => el.dataset.chatId === lastChatId
        );
        if (chatElement) {
            await selectChat(lastChatId, chatElement);
        }
    }
}
function initializeSocket() {
    // USAR URL DINÂMICA PARA SOCKET.IO
    const socketUrl = getApiUrl('socket');
    socket = io(socketUrl, {
        autoConnect: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        maxReconnectionAttempts: 5,
        timeout: 20000,
        forceNew: true
    });

    socket.on('connect', () => {
        connectionStatus.textContent = '🟢 Conectado';
        connectionStatus.className = 'connection-status connected';
        socket.emit('authenticate', currentUser);
        if (currentChat) {
            socket.emit('join_chat', currentChat);
        }
    });
    socket.on('disconnect', (reason) => {
        connectionStatus.textContent = '🔴 Desconectado';
        connectionStatus.className = 'connection-status disconnected';
    });
    socket.on('connect_error', (error) => {
        connectionStatus.textContent = '🟡 Erro de conexão';
        connectionStatus.className = 'connection-status error';
    });
    socket.on('authenticated', (data) => {
        if (data.user.currentChatId) {
            currentUser.currentChatId = data.user.currentChatId;
        }
    });
    socket.on('pending_invites', (invites) => {
        displayInvites(invites);
    });
    socket.on('new_invite', (invite) => {
        showInviteNotification(invite);
    });
    socket.on('invite_sent', () => {
        showSuccess('Convite enviado com sucesso!');
        closeInviteModal();
    });
    socket.on('chat_created', async (data) => {
        await addChatToList(data);
        showSuccess(`Chat "${data.chatName}" criado!`);
    });
    socket.on('chat_joined', async (data) => {
        await addChatToList(data);
        showSuccess(`Você entrou no chat "${data.chatName}"!`);
    });
    socket.on('joined_chat', (data) => {});
    socket.on('chat_history', (messages) => {
        saveChatMessages(currentChat, messages);
        displayChatHistory(messages);
    });
    socket.on('receive_message', async (message) => {
        if (message.userId !== currentUser.id) {
            let msgs = restoreChatMessages(currentChat);
            if (!message.id && message._id) {
                message.id = message._id;
            }
            msgs.push(message);
            saveChatMessages(currentChat, msgs);
            displayMessage(message, 'other');
        }
        if (message.userId !== currentUser.id && message.chatId !== currentChat) {
            await incrementUnreadCount(message.chatId);
            const chatElement = document.querySelector(`[data-chat-id="${message.chatId}"]`);
            if (chatElement) {
                const newCount = await restoreUnreadCount(message.chatId);
                updateNotificationIndicator(chatElement, newCount);
            }
        }
    });
    socket.on('message_sent', (data) => {
        let msgs = restoreChatMessages(currentChat);
        msgs.push(data.message);
        saveChatMessages(currentChat, msgs);
    });
    socket.on('user_typing', (data) => {
        if (data.chatId === currentChat && data.userId !== currentUser.id) {
            if (data.isTyping) {
                typingText.textContent = `${data.username} está digitando...`;
                typingIndicator.classList.remove('hidden');
            } else {
                typingIndicator.classList.add('hidden');
            }
        }
    });
    socket.on('messages_read', ({ chatId, userId, username }) => {
        if (chatId === currentChat && userId !== currentUser.id) {
            showSuccess(`${username} leu suas mensagens`);
        }
    });
    socket.on('user_online', ({ userId, username }) => {
        const statusSpan = document.getElementById(`status_${userId}`);
        if (statusSpan) statusSpan.textContent = '🟢 Online';
    });
    socket.on('user_offline', ({ userId, username, lastSeen }) => {
        const statusSpan = document.getElementById(`status_${userId}`);
        if (statusSpan) statusSpan.textContent = '🔴 Offline';
        const lastSeenSpan = document.getElementById(`lastseen_${userId}`);
        if (lastSeenSpan) lastSeenSpan.textContent = `Última vez online: ${formatTime(lastSeen)}`;
    });
    socket.on('user_last_seen', ({ userId, lastSeen }) => {
        const lastSeenSpan = document.getElementById(`lastseen_${userId}`);
        if (lastSeenSpan) lastSeenSpan.textContent = `Última vez online: ${formatTime(lastSeen)}`;
    });
    socket.on('user_left_chat', ({ chatId, userId, username }) => {
        if (chatId === currentChat) {
            showSuccess(`${username} saiu do chat`);
        }
    });
    socket.on('error', (error) => {
        showError(`Erro: ${error.message || error}`);
    });
}

// ======================== FUNÇÕES DE CONVITES ========================
async function handleUserSearch() {
    const query = searchUserInput.value.trim();
    if (query.length < 2) {
        searchResults.innerHTML = '';
        return;
    }
    try {
        // USAR URL DINÂMICA
        const response = await fetch(`${getApiUrl('socket')}/api/users/search?query=${encodeURIComponent(query)}`);
        const users = await response.json();
        displaySearchResults(users);
    } catch (error) {
        console.error('Erro na busca:', error);
    }
}

function displaySearchResults(users) {
    if (users.length === 0) {
        searchResults.innerHTML = '<div class="no-results">Nenhum usuário encontrado</div>';
        return;
    }
    const html = users.map(user => `
        <div class="search-result-item" onclick="selectUserForInvite('${user.id}', '${user.username}')">
            👤 ${user.username}
            <span class="user-status">${user.onlineStatus ? '🟢 Online' : '🔴 Offline'}</span>
        </div>
    `).join('');
    searchResults.innerHTML = html;
}
function selectUserForInvite(userId, username) {
    selectedUserForInvite = { id: userId, username };
    document.querySelectorAll('.search-result-item').forEach(item => {
        item.classList.remove('selected');
    });
    event.target.classList.add('selected');
    sendInviteBtn.disabled = false;
    if (!chatNameInput.value.trim()) {
        chatNameInput.value = `Chat com ${username}`;
    }
}
function handleSendInvite() {
    if (!selectedUserForInvite) return;
    const chatName = chatNameInput.value.trim() || `Chat com ${selectedUserForInvite.username}`;
    socket.emit('send_invite', {
        targetUserId: selectedUserForInvite.id,
        chatName: chatName
    });
}
function closeInviteModal() {
    inviteModal.classList.add('hidden');
    searchUserInput.value = '';
    chatNameInput.value = '';
    searchResults.innerHTML = '';
    selectedUserForInvite = null;
    sendInviteBtn.disabled = true;
}
function displayInvites(invites) {
    if (invites.length === 0) {
        invitesSection.classList.add('hidden');
        return;
    }
    invitesSection.classList.remove('hidden');
    const html = invites.map(invite => `
        <div class="invite-item">
            <div class="invite-from">De: ${invite.from.username}</div>
            <div>Chat: ${invite.chatName}</div>
            <div class="invite-actions">
                <button class="accept-btn" onclick="acceptInviteFromList('${invite.id}')">Aceitar</button>
                <button class="reject-btn" onclick="rejectInviteFromList('${invite.id}')">Recusar</button>
            </div>
        </div>
    `).join('');
    invitesList.innerHTML = html;
}
function acceptInviteFromList(inviteId) {
    socket.emit('accept_invite', inviteId);
    removeInviteFromList(inviteId);
}
function rejectInviteFromList(inviteId) {
    socket.emit('reject_invite', inviteId);
    removeInviteFromList(inviteId);
}
function removeInviteFromList(inviteId) {
    const inviteItems = document.querySelectorAll('.invite-item');
    inviteItems.forEach(item => {
        const acceptBtn = item.querySelector('.accept-btn');
        if (acceptBtn && acceptBtn.onclick.toString().includes(inviteId)) {
            item.remove();
        }
    });
    if (invitesList.children.length === 0) {
        invitesSection.classList.add('hidden');
    }
}
function showInviteNotification(invite) {
    currentInvite = invite;
    inviteMessage.textContent = `${invite.from.username} convidou você para "${invite.chatName}"`;
    inviteReceivedModal.classList.remove('hidden');
}

// ======================== FUNÇÕES DOS CHATS ========================
async function addChatToList(chatData) {
    const noChats = document.querySelector('.no-chats');
    if (noChats) {
        noChats.remove();
    }
    if (Array.from(chatsList.children).some(el => el.dataset.chatId === chatData.chatId)) return;
    const chatItem = document.createElement('div');
    chatItem.className = 'chat-item';
    chatItem.dataset.chatId = chatData.chatId;
    const unreadCount = await restoreUnreadCount(chatData.chatId);
    const notificationHTML = unreadCount > 0 ? 
        `<div class="notification-indicator">
            <span class="notification-dot"></span>
            <span class="notification-count">${unreadCount}</span>
        </div>` : 
        `<div class="notification-indicator hidden">
            <span class="notification-dot"></span>
            <span class="notification-count">0</span>
        </div>`;
    let participantDisplay = '';
    let participantId = '';
    if (chatData.participants && Array.isArray(chatData.participants)) {
        const otherParticipants = chatData.participants.filter(p => p.id !== currentUser.id);
        if (otherParticipants.length > 0) {
            const participant = otherParticipants[0];
            participantDisplay = participant.username;
            participantId = participant.id;
        }
    } else if (chatData.participant) {
        participantDisplay = chatData.participant;
        participantId = chatData.participantId || chatData.participant;
    }
    let chatDisplayName = chatData.chatName;
    if (!chatDisplayName || chatDisplayName.match(/^[a-f0-9]{20,}$/i) || chatDisplayName.includes('_')) {
        chatDisplayName = participantDisplay ? `Chat com ${participantDisplay}` : 'Chat sem nome';
    }
    chatItem.innerHTML = `
        <div class="chat-item-name">${chatDisplayName}</div>
        <div class="chat-item-participant">
            Com: ${participantDisplay}
        </div>
        <div class="chat-item-bottom">
            <span class="user-status" id="status_${participantId}">🔴 Offline</span>
            <span class="last-seen" id="lastseen_${participantId}"></span>
            <button class="delete-chat-btn" title="Apagar chat">🗑️</button>
        </div>
        ${notificationHTML}
    `;
    chatItem.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-chat-btn')) return;
        selectChat(chatData.chatId, chatItem);
    });
    chatItem.querySelector('.delete-chat-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDeleteChat(chatData.chatId, chatItem);
    });
    chatsList.appendChild(chatItem);
    const currentChats = cacheManager.getCachedChats() || [];
    if (!currentChats.some(c => c.chatId === chatData.chatId)) {
        currentChats.push(chatData);
        cacheManager.cacheUserChats(currentChats);
    }
}
function confirmDeleteChat(chatId, chatElement) {
    if (window.confirm('Tem certeza que deseja apagar este chat?')) {
        deleteChat(chatId, chatElement);
        if (socket) {
            socket.emit('leave_chat', { chatId });
        }
    }
}
async function deleteChat(chatId, chatElement) {
    chatElement.remove();
    const currentChats = (cacheManager.getCachedChats() || []).filter(c => c.chatId !== chatId);
    cacheManager.cacheUserChats(currentChats);
    cacheManager.clearChatCache(chatId);
    try {
        // USAR URL DINÂMICA
        await fetch(`${getApiUrl('socket')}/api/chats/${chatId}`, { method: 'DELETE' });
    } catch (e) {
        console.error('Erro ao apagar chat no backend:', e);
    }
    if (currentChat === chatId) {
        currentChat = null;
        await saveCurrentChatId();
        messagesContainer.innerHTML = '';
        messageInput.disabled = true;
        sendBtn.disabled = true;
        messageInput.placeholder = 'Selecione um chat';
    }
}

async function selectChat(chatId, chatElement) {
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    chatElement.classList.add('active');
    currentChat = chatId;
    await saveCurrentChatId();
    if (socket && socket.connected) {
        socket.emit('join_chat', chatId);
    }
    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.placeholder = 'Digite sua mensagem...';
    messageInput.focus();
    messagesContainer.innerHTML = '';
    const msgs = restoreChatMessages(chatId);
    msgs.forEach(msg => displayMessage(msg, msg.userId === currentUser.id ? 'own' : 'other'));
    await resetUnreadCount(chatId);
    updateNotificationIndicator(chatElement, 0);
    if (socket && socket.connected) {
        socket.emit('read_messages', { chatId });
    }
}
function displayChatHistory(messages) {
    saveChatMessages(currentChat, messages);
    messages.forEach(message => {
        displayMessage(message, message.userId === currentUser.id ? 'own' : 'other');
    });
}
function displayMessage(message, type) {
    if (message.type === 'document') {
        displayDocumentMessage(message, type);
    } else {
        displayTextMessage(message, type);
    }
}
function displayTextMessage(message, type) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', type);
    const isOwn = type === 'own';
    messageDiv.innerHTML = `
        ${!isOwn ? `<div class="message-header">${message.username}</div>` : ''}
        <div>${escapeHtml(message.message)}</div>
        <div class="message-time">${formatTime(message.timestamp)}</div>
        ${message.readBy && message.readBy.length > 0 ? `<div class="message-read">Lida por: ${message.readBy.map(u => u.username).join(', ')}</div>` : ''}
    `;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    setTimeout(() => {
        messageDiv.classList.add('show');
    }, 10);
}

// ======================== SISTEMA DE NOTIFICAÇÃO ========================
async function updateNotificationIndicator(chatElement, count) {
    const indicator = chatElement.querySelector('.notification-indicator');
    const countElement = chatElement.querySelector('.notification-count');
    if (count > 0) {
        indicator.classList.remove('hidden');
        countElement.textContent = count;
    } else {
        indicator.classList.add('hidden');
        countElement.textContent = '0';
    }
}

// ======================== FUNÇÕES DE DOCUMENTOS ========================
// ...existing code...
// ...existing code...
function displayDocumentMessage(message, type) {
    const isOwn = type === 'own';
    let documentData = {};
    try {
        documentData = typeof message.content === 'string' ? JSON.parse(message.content) : (message.content || {});
    } catch (e) {
        documentData = message.content || {};
    }
    const messageId = message.id || message._id || '';

    const template = document.getElementById('document-message-template');
    let messageNode;

    if (template && template.content) {
        messageNode = template.content.firstElementChild.cloneNode(true);
    } else {
        // fallback minimal DOM if template missing
        messageNode = document.createElement('div');
        messageNode.classList.add('message', 'document-message');

        const header = document.createElement('div');
        header.className = 'message-header';
        header.hidden = true;
        messageNode.appendChild(header);

        const preview = document.createElement('div');
        preview.className = 'document-preview';
        const inner = document.createElement('div');
        inner.className = 'document-preview-inner';

        const icon = document.createElement('div');
        icon.className = 'document-icon';
        icon.textContent = '📄';

        const info = document.createElement('div');
        info.className = 'document-info';

        const titleEl = document.createElement('div');
        titleEl.className = 'document-title';

        const previewEl = document.createElement('div');
        previewEl.className = 'document-preview-text';

        info.appendChild(titleEl);
        info.appendChild(previewEl);

        const action = document.createElement('div');
        action.className = 'document-action';
        action.innerHTML = '<i class="fa fa-external-link" aria-hidden="true"></i> Abrir';

        inner.appendChild(icon);
        inner.appendChild(info);
        inner.appendChild(action);
        preview.appendChild(inner);
        messageNode.appendChild(preview);

        const timeEl = document.createElement('div');
        timeEl.className = 'message-time';
        messageNode.appendChild(timeEl);
    }

    // alignment class: 'own' -> right, 'other' -> left
    messageNode.classList.remove('own', 'other');
    messageNode.classList.add(isOwn ? 'own' : 'other');

    // header (show only for others)
    const header = messageNode.querySelector('.message-header');
    if (header) {
        if (!isOwn) {
            header.hidden = false;
            header.textContent = message.username || '';
        } else {
            header.hidden = true;
            header.textContent = '';
        }
    }

    // populate preview content and events
    const previewEl = messageNode.querySelector('.document-preview');
    if (previewEl) {
        previewEl.dataset.messageId = messageId;
        const titleEl = previewEl.querySelector('.document-title');
        const previewTextEl = previewEl.querySelector('.document-preview-text');
        if (titleEl) titleEl.innerHTML = escapeHtml(String(documentData.title || 'Sem título'));
        if (previewTextEl) previewTextEl.innerHTML = escapeHtml(String(documentData.preview || ''));
        // click opens modal (no inline handlers)
        previewEl.addEventListener('click', () => openDocumentModal(messageId));
    }

    // time
    const timeNode = messageNode.querySelector('.message-time');
    if (timeNode) {
        timeNode.textContent = formatTime(message.timestamp);
    }

    messagesContainer.appendChild(messageNode);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    setTimeout(() => messageNode.classList.add('show'), 10);
}
// ...existing code...


function openDocumentModal(messageId) {
    const chatMessages = restoreChatMessages(currentChat);
    const documentMessage = chatMessages.find(msg => {
        const msgId = msg.id || msg._id;
        const msgIdStr = msgId ? msgId.toString() : null;
        const searchIdStr = messageId ? messageId.toString() : null;
        return msgIdStr === searchIdStr;
    });
    if (!documentMessage) {
        const docByType = chatMessages.find(msg => msg.type === 'document');
        if (docByType) {
            showDocumentModal(JSON.parse(docByType.content), docByType);
            return;
        }
        alert('Erro: Documento não encontrado');
        return;
    }
    try {
        const documentData = JSON.parse(documentMessage.content);
        showDocumentModal(documentData, documentMessage); // <-- Passe o objeto aqui!
    } catch (error) {
        alert('Erro ao abrir documento');
    }
}


let currentDocumentContent = '';

function showDocumentModal(documentData, documentMessageOriginal) {
    const modal = document.getElementById('documentModal');
    
    console.log('documentData recebido:', documentData);
    
    document.getElementById('docTitle').textContent = documentData.title || 'Sem título';
    document.getElementById('docDate').textContent = formatTime(documentData.createdAt || new Date().toISOString());
    
    const content = documentData.content || {};
    document.getElementById('docObjective').textContent = content.objetivo || 'Não especificado';
    document.getElementById('docDeadline').textContent = formatDisplayDate(content.prazo) || 'Não definido';
    document.getElementById('docObservations').textContent = content.observacoes || 'Nenhuma observação';
    
    currentDocumentContent = content.documento || '';
    
    const btnAcessar = document.getElementById('btnAcessarDocumento');
    btnAcessar.onclick = () => openFullscreenDocument(documentData.title, currentDocumentContent, documentMessageOriginal);
    
    modal.style.display = 'block';
}

function adicionarDocumentoRecebido(documentMessage) {
    const userId = localStorage.getItem('userId');
    if (!userId) {
        alert('Usuário não identificado.');
        return;
    }
    // Garante que o documento é um objeto puro
    let documentoCompleto = documentMessage.content;
    // Se for string JSON, converte para objeto
    if (typeof documentoCompleto === 'string') {
        try {
            documentoCompleto = JSON.parse(documentoCompleto);
        } catch {
            // Se não for JSON, mantém como string
        }
    }
    // Adiciona metadados se quiser
    documentoCompleto._originalMessage = {
        userId: documentMessage.userId,
        username: documentMessage.username,
        timestamp: documentMessage.timestamp,
        id: documentMessage.id || documentMessage._id,
        preview: documentMessage.preview,
        displayText: documentMessage.displayText
    };
    // USAR URL DINÂMICA
    fetch(`${getApiUrl('socket')}/api/documentos-recebidos/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento: documentoCompleto })
    })
    .then(async res => {
        if (res.ok) {
            alert('Documento adicionado em Documentos Recebidos!');
        } else {
            const data = await res.json();
            alert(data.error || 'Erro ao adicionar documento.');
        }
        closeFullscreenDocument();
    })
    .catch(() => {
        alert('Erro ao conectar com o backend.');
        closeFullscreenDocument();
    });
}

function openFullscreenDocument(title, content, documentMessage = null) {
    const modal = document.getElementById('documentFullscreenModal');
    document.getElementById('docFullscreenTitle').textContent = title;
    const contentDiv = document.getElementById('docFullscreenContent');
    if (content && content.includes('<')) {
        contentDiv.innerHTML = content;
    } else {
        if (typeof marked !== 'undefined' && content) {
            contentDiv.innerHTML = marked.parse(content);
        } else {
            contentDiv.innerHTML = content ? content.replace(/\n/g, '<br>') : 'Conteúdo não disponível';
        }
    }
    contentDiv.style.cssText += `
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.6;
        color: #333;
        padding: 20px;
    `;

    // Mostrar botão "Adicionar em documentos recebidos" apenas para quem recebeu
    const btnAdd = document.getElementById('btnAddToReceivedDocuments');
    if (documentMessage && documentMessage.userId !== currentUser.id) {
        btnAdd.style.display = '';
        btnAdd.onclick = function() {
            adicionarDocumentoRecebido(documentMessage);
        };
    } else {
        btnAdd.style.display = 'none';
        btnAdd.onclick = null;
    }

    modal.style.display = 'block';
}

function closeFullscreenDocument() {
    const modal = document.getElementById('documentFullscreenModal');
    if (modal) {
        modal.style.display = 'none';
    }
}
function downloadDocument() {
    const contentDiv = document.getElementById('docFullscreenContent');
    if (!contentDiv) {
        alert('Nenhum conteúdo disponível para download');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });
    doc.html(contentDiv, {
        x: 10,
        y: 20,
        width: 180,
        windowWidth: contentDiv.scrollWidth,
        callback: function (doc) {
            const title = document.getElementById('docFullscreenTitle').textContent || 'Documento';
            doc.save(`${title.replace(/\s+/g, '_')}_${Date.now()}.pdf`);
        }
    });
}
function closeDocumentModal() {
    const modal = document.getElementById('documentModal');
    if (modal) {
        modal.style.display = 'none';
    }
}
function replyToDocument() {
    closeDocumentModal();
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.focus();
        messageInput.placeholder = 'Responder ao documento...';
        setTimeout(() => {
            messageInput.placeholder = 'Digite sua mensagem...';
        }, 3000);
    }
}

// ======================== FUNÇÕES UTILITÁRIAS ========================
function showError(message) {
    authError.textContent = message;
    authError.classList.remove('hidden');
}
function clearError() {
    authError.classList.add('hidden');
    authError.textContent = '';
}
function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.textContent = message;
    const activeModal = document.querySelector('.modal:not(.hidden) .modal-content');
    if (activeModal) {
        activeModal.appendChild(successDiv);
        setTimeout(() => {
            successDiv.remove();
        }, 3000);
    }
}
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
    });
}
function formatDisplayDate(dateString) {
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('pt-BR');
    } catch {
        return dateString;
    }
}
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
function showChatNotification(message, chatName) {
    const notification = document.getElementById('chatNotification');
    if (notification) {
        notification.textContent = `Nova mensagem em "${chatName}": ${message}`;
        notification.classList.remove('hidden');
        setTimeout(() => {
            notification.classList.add('hidden');
        }, 3500);
    }
}

// ======================== FUNÇÕES GLOBAIS ========================
window.selectUserForInvite = selectUserForInvite;
window.acceptInviteFromList = acceptInviteFromList;
window.rejectInviteFromList = rejectInviteFromList;
window.openDocumentModal = openDocumentModal;
window.closeDocumentModal = closeDocumentModal;
window.replyToDocument = replyToDocument;
window.openFullscreenDocument = openFullscreenDocument;
window.closeFullscreenDocument = closeFullscreenDocument;
window.downloadDocument = downloadDocument;

// ======================== INICIALIZAÇÃO ========================
document.addEventListener('DOMContentLoaded', async () => {
    chatContainer.classList.remove('hidden');
    if (await restoreCurrentUser()) {
        await initializeChat();
    }
    document.getElementById('loginUsername').value = '';
});

// ======================== FECHAR MODAL ========================
authModal.addEventListener('click', function(event) {
    if (event.target === authModal) {
        authModal.classList.add('hidden');
        clearError();
    }
});