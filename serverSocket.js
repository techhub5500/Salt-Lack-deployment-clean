// ======================== IMPORTS E CONFIGURAÇÃO ========================
// Importação de módulos e configuração do Express, Socket.io, MongoDB
import express from 'express';
import http from 'http';
import { Server as SocketIo } from 'socket.io';
import path from 'path';
import { promises as fs } from 'fs';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Mixpanel from 'mixpanel';


 dotenv.config();

let mixpanel;
if (process.env.MIXPANEL_TOKEN) {
  mixpanel = Mixpanel.init(process.env.MIXPANEL_TOKEN);
} else {
  console.warn('MIXPANEL_TOKEN não definido — eventos Mixpanel desativados');
  // no-op para evitar checagens espalhadas
  mixpanel = {
    track: () => {},
    people: { set: () => {}, increment: () => {} }
  };
}

// ADICIONAR AQUI: helpers para iniciar/finalizar sessões e enviar métricas de duração ao Mixpanel
const sessionStarts = new Map(); // Map<userId, Array<{id: string, start: Date}>>

function recordSessionStart(userId, sessionId) {
  if (!userId || !sessionId) return;
  const list = sessionStarts.get(userId) || [];
  list.push({ id: sessionId, start: new Date() });
  sessionStarts.set(userId, list);
}

async function recordSessionEnd(userId, sessionId) {
  try {
    if (!userId || !sessionId) return;
    const list = sessionStarts.get(userId) || [];
    const idx = list.findIndex(s => s.id === sessionId);
    if (idx === -1) return; // sessão não encontrada (idempotente)
    const [session] = list.splice(idx, 1);
    if (list.length === 0) sessionStarts.delete(userId); else sessionStarts.set(userId, list);

    const durationMs = Date.now() - session.start.getTime();
    const durationSec = Math.max(1, Math.round(durationMs / 1000));

    // Envia evento de sessão finalizada para Mixpanel
    try {
      mixpanel.track('Session Ended', {
        distinct_id: userId,
        session_id: sessionId,
        duration_seconds: durationSec,
        date: new Date().toISOString().slice(0, 10) // YYYY-MM-DD (útil para agregações diárias)
      });
      // Incrementa total acumulado no perfil (opcional)
      if (mixpanel.people && typeof mixpanel.people.increment === 'function') {
        mixpanel.people.increment(userId, { total_time_seconds: durationSec });
      }
    } catch (e) {
      console.warn('Mixpanel error:', e?.message || e);
    }
  } catch (e) {
    console.error('Erro ao registrar fim de sessão:', e);
  }
}

// ====== MONGODB SETUP ======
mongoose.connect(process.env.MONGO_URI, {
  ssl: true,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
}).then(() => {
  console.log('✅ MongoDB conectado com sucesso');
}).catch((err) => {
  console.error('❌ Erro ao conectar MongoDB:', err.message);
});

// ======================== SCHEMAS MONGOOSE ========================
// Usuário, Mensagem e Chat
const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  currentChatId: String,
  createdAt: { type: Date, default: Date.now },
  lastLogin: Date
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  userId: String,
  username: String,
  message: String,
  type: { type: String, default: 'text' },
  content: String,
  displayText: String,
  preview: String,
  timestamp: { type: Date, default: Date.now }
});

const chatSchema = new mongoose.Schema({
  name: String,
  participants: [String],
  createdAt: { type: Date, default: Date.now },
  messages: [messageSchema]
});
const Chat = mongoose.model('Chat', chatSchema);

// ======================== CONFIGURAÇÃO DE PATHS E APP ========================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIo(server, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://your-frontend-app.onrender.com', // Adicione seu domínio
      'https://your-socket-server.onrender.com'
    ],
    methods: ['GET', 'POST'],
    credentials: true
  }
});
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));
app.use(cors({
  origin: [
    'http://localhost:5173', 
    'http://127.0.0.1:5173',
    'https://salt-lack-frontend.onrender.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.options('*', cors());

// ======================== ARQUIVOS DE DADOS ========================
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
async function ensureDataDir() {
  try {
    await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
  } catch (error) {
    console.error('Erro ao criar diretório data:', error);
  }
}

// ======================== VARIÁVEIS EM MEMÓRIA ========================
let users = [];
let connectedUsers = new Map();
let userInvites = new Map();

// ======================== ROTAS HTTP ========================

// --- Página inicial ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/frontend/html/index.html'));
});

// --- Cadastro de usuário ---
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Nome de usuário deve ter entre 3 e 20 caracteres' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
    }
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Usuário ou email já existe' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      createdAt: new Date(),
      lastLogin: null
    });
    await newUser.save();
    res.status(201).json({
      message: 'Usuário cadastrado com sucesso!',
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email
      }
    });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// --- Login de usuário ---
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username e senha são obrigatórios' });
    }
    const user = await User.findOne({ $or: [{ username }, { email: username }] });
    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    user.lastLogin = new Date();
    await user.save();

    // INICIAR SESSÃO (fluxo HTTP) para rastrear tempo até logout/disconnect
    const sessionId = `http-${Date.now()}`;
    // CORREÇÃO: usar user._id (não user._1)
    recordSessionStart(user._id.toString(), sessionId);

    // === Mixpanel (server-side) ===
    try {
      const distinctId = user._id.toString();
      // atualiza perfil (people)
      mixpanel.people.set(distinctId, {
        $name: user.username,
        $email: user.email,
        plan: user.plan || 'free',
        $last_login: user.lastLogin
      });
      // evento de login
      mixpanel.track('User Logged In', {
        distinct_id: distinctId,
        username: user.username
      });
    } catch (e) {
      console.warn('Mixpanel error:', e?.message || e);
    }

    // ==============================

    res.json({
      message: 'Login realizado com sucesso!',
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      },
      sessionId // <-- devolver sessionId para o cliente usar em logout (ou para correlacionar)
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// --- Compartilhamento de documento no chat ---
app.post('/api/share-document', async (req, res) => {
  try {
    const { chatId, userId, documentData } = req.body;
    if (!chatId || !userId || !documentData) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }
    // Verifica se o chat existe e se o usuário tem acesso
    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(403).json({ error: 'Acesso negado ao chat' });
    }
    // Busca username do usuário
    const user = await User.findById(userId);
    const username = user ? user.username : 'Usuário desconhecido';
    // Cria mensagem do documento
    const documentMessage = {
      userId: userId,
      username: username,
      type: 'document',
      content: JSON.stringify(documentData),
      displayText: `📄 ${documentData.title}`,
      preview: documentData.preview,
      timestamp: new Date()
    };
    chat.messages.push(documentMessage);
    await chat.save();
    // Emite para todos os participantes do chat
    const savedMessage = chat.messages[chat.messages.length - 1];
    savedMessage.id = savedMessage._id.toString();
    await chat.save();
    io.to(chatId).emit('receive_message', savedMessage);
    res.json({ success: true, messageId: savedMessage._id });
  } catch (error) {
    console.error('Erro ao compartilhar documento:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Adicione estas rotas ANTES da seção "SOCKET.IO - EVENTOS EM TEMPO REAL"

// --- Contador de não lidas ---
app.post('/api/chats/:chatId/unread', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { userId, count } = req.body;
    
    // Como você não tem tabela separada, pode usar localStorage do cliente
    // ou implementar uma coleção separada se quiser persistir no MongoDB
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar contador.' });
  }
});

app.get('/api/users/:userId/unread-counts', async (req, res) => {
  try {
    // Retorna contadores zerados por enquanto
    res.json({});
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar contadores.' });
  }
});

// --- Salvar chat atual do usuário ---
app.post('/api/users/:userId/current-chat', async (req, res) => {
  try {
    const { userId } = req.params;
    const { chatId } = req.body;
    
    // Atualiza o usuário com o chat atual
    await User.findByIdAndUpdate(userId, { currentChatId: chatId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar chat atual.' });
  }
});

// --- Logout ---
app.post('/api/logout', async (req, res) => {
  try {
    const { userId, sessionId } = req.body;
    if (!userId || !sessionId) {
      return res.status(400).json({ error: 'userId e sessionId são obrigatórios' });
    }
    // Finaliza a sessão (gera métrica de duração)
    await recordSessionEnd(userId, sessionId);
    // (opcional) atualizar lastLogout no usuário
    try { await User.findByIdAndUpdate(userId, { lastLogout: new Date() }); } catch (_) {}
    res.json({ success: true });
  } catch (error) {
    console.error('Erro no logout.', error);
    res.status(500).json({ error: 'Erro no logout.' });
  }
});

// --- Listagem de chats do usuário ---
app.get('/api/chats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const chats = await Chat.find({ participants: userId });
    // Busca todos os usuários envolvidos nos chats
    const allUserIds = Array.from(new Set(chats.flatMap(chat => chat.participants)));
    const users = await User.find({ _id: { $in: allUserIds } });
    const usersMap = {};
    users.forEach(u => { usersMap[u._id.toString()] = u.username; });
    res.json(chats.map(chat => {
      const otherParticipantId = chat.participants.find(id => id !== userId);
      const otherParticipantName = usersMap[otherParticipantId] || 'Usuário';
      return {
        chatId: chat._id.toString(),
        chatName: chat.name,
        participant: otherParticipantName,
        participantId: otherParticipantId,
        messages: chat.messages,
        createdAt: chat.createdAt
      };
    }));
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar chats do usuário.' });
  }
});

// --- Busca de usuários para convite ---
app.get('/api/users/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 2) {
      return res.json([]);
    }
    const searchResults = await User.find({
      username: { $regex: query, $options: 'i' }
    }).limit(10);
    res.json(searchResults.map(user => ({
      id: user._id,
      username: user.username
    })));
  } catch (error) {
    console.error('Erro na busca:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// --- Apagar chat ---
app.delete('/api/chats/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    await Chat.findByIdAndDelete(chatId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao apagar chat.' });
  }
});

// ...existing code...

// ======================== SCHEMA DE DOCUMENTOS RECEBIDOS ========================
const documentoRecebidoSchema = new mongoose.Schema({
  userId: String, // Quem recebeu
  documento: Object, // Conteúdo completo do documento
  origemId: { type: String, default: null }, // opcional: id de origem para evitar duplicados
  recebidoEm: { type: Date, default: Date.now }
});
const DocumentoRecebido = mongoose.model('DocumentoRecebido', documentoRecebidoSchema);


// ======================== ENDPOINTS DOCUMENTOS RECEBIDOS ========================

// Salvar documento recebido (quando usuário clica "Adicionar em documentos recebidos")
app.post('/api/documentos-recebidos/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { documento, origemId } = req.body;
    if (!userId || !documento) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }

    // 1) Se veio origemId do cliente, checa por ele (mais confiável)
    if (origemId) {
      const existePorOrigem = await DocumentoRecebido.findOne({ userId, origemId });
      if (existePorOrigem) {
        return res.status(409).json({ error: 'Documento já recebido' });
      }
    }

    // 2) Se documento.id existir, checa por documento.id
    if (documento && documento.id) {
      const existePorId = await DocumentoRecebido.findOne({ userId, 'documento.id': documento.id });
      if (existePorId) {
        return res.status(409).json({ error: 'Documento já recebido' });
      }
    }

    // 3) Fallback: compara conteúdo normalizado (stringify) com os existentes do usuário
    const normalized = JSON.stringify(documento);
    const allDocs = await DocumentoRecebido.find({ userId }).lean();
    const dup = allDocs.find(d => JSON.stringify(d.documento) === normalized);
    if (dup) {
      return res.status(409).json({ error: 'Documento já recebido' });
    }

    // Se não encontrou duplicado, salva incluindo origemId (se houver)
    const novoDoc = new DocumentoRecebido({ userId, documento, origemId: origemId || null });
    await novoDoc.save();
    res.json({ success: true, documento: novoDoc });
  } catch (error) {
    console.error('Erro ao salvar documento recebido:', error);
    res.status(500).json({ error: 'Erro ao salvar documento recebido.' });
  }
});

// Listar todos documentos recebidos do usuário
app.get('/api/documentos-recebidos/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const docs = await DocumentoRecebido.find({ userId }).sort({ recebidoEm: -1 });
    res.json(docs);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar documentos recebidos.' });
  }
});

// Buscar documento recebido por ID
app.get('/api/documentos-recebidos/:userId/:docId', async (req, res) => {
  try {
    const { userId, docId } = req.params;
    const doc = await DocumentoRecebido.findOne({ userId, _id: docId });
    if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
    res.json(doc);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar documento recebido.' });
  }
});

// Excluir documento recebido
app.delete('/api/documentos-recebidos/:userId/:docId', async (req, res) => {
  try {
    const { userId, docId } = req.params;
    await DocumentoRecebido.deleteOne({ userId, _id: docId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir documento recebido.' });
  }
});

// ...existing code...

// ======================== SOCKET.IO - EVENTOS EM TEMPO REAL ========================
io.on('connection', (socket) => {
  console.log('Nova conexão:', socket.id);

  // --- Autenticação do usuário via socket ---
  socket.on('authenticate', async (userData) => {
    try {
      const user = await User.findById(userData.id);
      if (user) {
        connectedUsers.set(socket.id, {
          id: user._id.toString(),
          username: user.username,
          socketId: socket.id
        });
        socket.userId = user._id.toString();
        socket.username = user.username;
        socket.broadcast.emit('user_online', { userId: user._id.toString() });
        const pendingInvites = userInvites.get(user._id.toString()) || [];
        if (pendingInvites.length > 0) {
          socket.emit('pending_invites', pendingInvites);
        }
        console.log(`${user.username} autenticado`);

          const distinctId = user._id.toString();
        // Fecha sessões HTTP pendentes (caso o cliente tenha feito login HTTP antes de conectar o socket)
        const pending = sessionStarts.get(distinctId) || [];
        for (const s of [...pending]) {
          if (typeof s.id === 'string' && s.id.startsWith('http-')) {
            // finaliza a sessão HTTP anterior (será registrada como Session Ended)
            await recordSessionEnd(distinctId, s.id);
          }
        }
        // registra nova sessão ligada ao socket.id
        recordSessionStart(distinctId, socket.id);

        // === Mixpanel: marcar última conexão e evento de socket ===
        try {
          mixpanel.people.set(distinctId, { $last_seen: new Date() });
          mixpanel.track('Socket Authenticated', { distinct_id: distinctId });
        } catch (e) {
          console.warn('Mixpanel error:', e?.message || e);
        }
        // ========================================================
      }
    } catch (error) {
      console.error('Erro na autenticação via socket:', error);
    }
  });

  // --- Envio de convite para chat ---
  socket.on('send_invite', async (data) => {
    try {
      const { targetUserId, chatName } = data;
      if (!socket.userId) return;
      const inviter = await User.findById(socket.userId);
      const target = await User.findById(targetUserId);
      if (!inviter || !target) return;
      const invite = {
        id: Date.now().toString(),
        from: { id: inviter._id.toString(), username: inviter.username },
        to: { id: target._id.toString(), username: target.username },
        chatName: chatName || `Chat com ${inviter.username}`,
        timestamp: new Date()
      };
      if (!userInvites.has(targetUserId)) userInvites.set(targetUserId, []);
      userInvites.get(targetUserId).push(invite);
      const targetSocket = Array.from(connectedUsers.entries())
        .find(([socketId, user]) => user.id === targetUserId);
      if (targetSocket) {
        io.to(targetSocket[0]).emit('new_invite', invite);
      }
      socket.emit('invite_sent', { success: true });
    } catch (error) {
      console.error('Erro ao enviar convite:', error);
    }
  });

  // --- Aceitar convite ---
  socket.on('accept_invite', async (inviteId) => {
    try {
      if (!socket.userId) return;
      const userInviteList = userInvites.get(socket.userId) || [];
      const inviteIndex = userInviteList.findIndex(inv => inv.id === inviteId);
      if (inviteIndex === -1) return;
      const invite = userInviteList[inviteIndex];
      const newChat = new Chat({
        name: invite.chatName,
        participants: [invite.from.id, invite.to.id],
        createdAt: new Date(),
        messages: []
      });
      await newChat.save();
      userInviteList.splice(inviteIndex, 1);
      socket.join(newChat._id.toString());
      const inviterSocket = Array.from(connectedUsers.entries())
        .find(([socketId, user]) => user.id === invite.from.id);
      if (inviterSocket) {
        io.sockets.sockets.get(inviterSocket[0])?.join(newChat._id.toString());
        io.to(inviterSocket[0]).emit('chat_created', {
          chatId: newChat._id.toString(),
          chatName: newChat.name,
          participant: invite.to.username
        });
      }
      socket.emit('chat_joined', {
        chatId: newChat._id.toString(),
        chatName: newChat.name,
        participant: invite.from.username
      });
    } catch (error) {
      console.error('Erro ao aceitar convite:', error);
    }
  });

  // --- Recusar convite ---
  socket.on('reject_invite', (inviteId) => {
    try {
      if (!socket.userId) return;
      const userInviteList = userInvites.get(socket.userId) || [];
      const inviteIndex = userInviteList.findIndex(inv => inv.id === inviteId);
      if (inviteIndex !== -1) {
        userInviteList.splice(inviteIndex, 1);
        socket.emit('invite_rejected', { inviteId });
      }
    } catch (error) {
      console.error('Erro ao rejeitar convite:', error);
    }
  });

  // --- Entrar em chat ---
  socket.on('join_chat', async (chatId) => {
    try {
      const chat = await Chat.findById(chatId);
      if (chat && chat.participants.includes(socket.userId)) {
        socket.join(chatId);
        socket.currentChat = chatId;
        socket.emit('chat_history', chat.messages);
      }
    } catch (error) {
      console.error('Erro ao entrar no chat:', error);
    }
  });

  // --- Enviar mensagem de texto ---
  socket.on('send_message', async (data) => {
    try {
      if (!socket.currentChat || !socket.userId) return;
      const chat = await Chat.findById(socket.currentChat);
      if (!chat || !chat.participants.includes(socket.userId)) return;
      const message = {
        userId: socket.userId,
        username: socket.username,
        message: data.message,
        type: 'text',
        timestamp: new Date()
      };
      chat.messages.push(message);
      await chat.save();
      const savedMessage = chat.messages[chat.messages.length - 1];
      savedMessage.id = savedMessage._id;
      await chat.save();
      io.to(socket.currentChat).emit('receive_message', savedMessage);
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
    }
  });

  // --- Enviar mensagem de documento ---
  socket.on('send_document_message', async (data) => {
    if (!socket.userId) {
      socket.emit('document_error', { message: 'Usuário não autenticado' });
      return;
    }
    const chatId = data.chatId;
    if (!chatId) {
      socket.emit('document_error', { message: 'Chat ID não fornecido' });
      return;
    }
    try {
      const chat = await Chat.findById(chatId);
      if (!chat) {
        socket.emit('document_error', { message: 'Chat não encontrado' });
        return;
      }
      if (!chat.participants.includes(socket.userId)) {
        socket.emit('document_error', { message: 'Acesso negado ao chat' });
        return;
      }
      const documentMessage = {
        userId: socket.userId,
        username: socket.username,
        type: 'document',
        content: data.documentData.content,
        displayText: data.documentData.displayText,
        preview: data.documentData.preview,
        timestamp: new Date()
      };
      chat.messages.push(documentMessage);
      await chat.save();
      const savedMessage = chat.messages[chat.messages.length - 1];
      savedMessage.id = savedMessage._id.toString();
      await chat.save();
      console.log('Documento salvo com ID:', savedMessage.id);
      io.to(chatId).emit('receive_message', savedMessage);
      socket.emit('document_sent', { success: true });
    } catch (error) {
      console.error('Erro ao salvar documento:', error);
      socket.emit('document_error', { message: 'Erro interno do servidor' });
    }
  });

  // --- Sair do chat ---
  socket.on('leave_chat', (chatId) => {
    try {
      socket.leave(chatId);
      socket.currentChat = null;
      socket.to(chatId).emit('user_left_chat', {
        userId: socket.userId,
        username: socket.username
      });
    } catch (error) {
      console.error('Erro ao sair do chat:', error);
    }
  });

  // --- Evento de digitação ---
  socket.on('typing', (data) => {
    try {
      if (socket.currentChat) {
        socket.to(socket.currentChat).emit('user_typing', {
          username: socket.username,
          isTyping: data.isTyping
        });
      }
    } catch (error) {
      console.error('Erro no evento de digitação:', error);
    }
  });

  // --- Desconexão ---
  socket.on('disconnect', () => {
    try {
      if (socket.userId) {
        // Finaliza sessão vinculada a este socket (gera evento de duração)
        recordSessionEnd(socket.userId, socket.id);
        connectedUsers.delete(socket.id);
        socket.broadcast.emit('user_offline', {
          userId: socket.userId,
          lastSeen: new Date()
        });
        console.log(`${socket.username || 'Usuário'} desconectado`);
      }
    } catch (error) {
      console.error('Erro na desconexão:', error);
    }
  });
});

// ======================== INICIALIZAÇÃO DO SERVIDOR ========================
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📱 Acesse: http://localhost:${PORT}`);
});