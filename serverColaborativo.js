import express from 'express';
import * as dotenv from 'dotenv';
import cors from 'cors';
import mongoose from 'mongoose';
import Mixpanel from 'mixpanel';

 dotenv.config();

const app = express();
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://127.0.0.1:5173', 
    'https://salt-lack-frontend.onrender.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

const documentoSchema = new mongoose.Schema({
  infos: {
    titulo: String,
    objetivo: String,
    prazo: String,
    observacoes: String
  },
  mensagens: [
    {
      role: String,
      text: String,
      timestamp: String,
      selected: Boolean
    }
  ],
  documento: String,
  comentarios: [
    {
      id: String,
      text: String,
      comment: String
    }
  ],
  criadoEm: { type: Date, default: Date.now }
});

const Documento = mongoose.model('Documento', documentoSchema);

// ====== HELPERS ======
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// converte um texto simples com sintaxe Markdown mínima para HTML seguro
function markdownToHtml(text) {
  if (!text) return '';
  let t = String(text).replace(/\r\n/g, '\n');

  // extrai blocos de código tripla crase e substitui por placeholders
  const codeBlocks = [];
  t = t.replace(/```([\s\S]*?)```/g, (m, p1) => {
    codeBlocks.push(p1);
    return `@@CODEBLOCK${codeBlocks.length - 1}@@`;
  });

  const lines = t.split('\n');
  let out = '';
  let inUl = false;
  let inOl = false;
  let inP = false;

  const closeParagraph = () => { if (inP) { out += '</p>\n'; inP = false; } };
  const closeLists = () => {
    if (inUl) { out += '</ul>\n'; inUl = false; }
    if (inOl) { out += '</ol>\n'; inOl = false; }
  };

  const inlineFormat = (s) => {
    if (!s) return '';
    let x = escapeHtml(s);
    x = x.replace(/`([^`]+)`/g, (m, p) => `<code>${escapeHtml(p)}</code>`);
    x = x.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    x = x.replace(/(^|[^*])\*([^*][\s\S]*?)\*(?!\*)/g, (m, p1, p2) => `${p1}<em>${p2}</em>`);
    x = x.replace(/_([^_]+)_/g, '<em>$1</em>');
    return x;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      closeParagraph();
      const level = Math.min(6, h[1].length);
      out += `<h${level}>${inlineFormat(h[2])}</h${level}>\n`;
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (!inUl) { closeParagraph(); closeLists(); out += '<ul>\n'; inUl = true; }
      out += `<li>${inlineFormat(ul[1])}</li>\n`;
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (!inOl) { closeParagraph(); closeLists(); out += '<ol>\n'; inOl = true; }
      out += `<li>${inlineFormat(ol[1])}</li>\n`;
      continue;
    }

    if (line.trim() === '') {
      closeParagraph();
      closeLists();
      continue;
    }

    if (!inP) {
      closeLists();
      out += '<p>';
      inP = true;
    } else {
      out += ' ';
    }
    out += inlineFormat(line.trim());
  }

  closeParagraph();
  closeLists();

  out = out.replace(/@@CODEBLOCK(\d+)@@/g, (m, idx) => {
    const content = codeBlocks[Number(idx)] || '';
    return `<pre><code>${escapeHtml(content)}</code></pre>`;
  });

  return out;
}

// renderiza mensagem preservando HTML ou convertendo Markdown -> HTML seguro
function renderMessageHTML(m) {
  const roleLabel = (m.role === 'user') ? 'Remetente' : (m.role === 'assistant') ? 'IA' : escapeHtml(m.role || '');
  const text = m.text || '';
  const isHtml = /<[^>]+>/.test(text);
  const content = isHtml ? text : markdownToHtml(text);
  return `<div class="chat-message"><div class="chat-message-role" style="font-weight:600;margin-bottom:4px;">${escapeHtml(roleLabel)}</div><div class="chat-message-text">${content}</div></div>`;
}

// ====== STYLES EMBUTIDOS PARA DOCUMENTO ======
const docStyles = `
<style>
:root {
  --bg: #ffffff;
  --text: #1a1a1a;
  --text-muted: #6b7280;
  --primary: #2563eb;
  --border: #e5e7eb;
  --card-bg: #fafafa;
  --code-bg: #f5f5f5;
  --code-text: #374151;
  --max-width: 1150px;
  --font-mono: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.documento-gerado {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  line-height: 1.6;
  padding: 40px;
  max-width: var(--max-width);
  margin: 0 auto;
  font-size: 15px;
}

/* Header */
.doc-header {
  margin-bottom: 40px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}

.doc-title {
  font-size: 28px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 16px 0;
  letter-spacing: -0.02em;
}

.doc-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.meta-item {
  background: var(--card-bg);
  color: var(--text-muted);
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  font-size: 13px;
  font-weight: 500;
}

/* Sections */
.section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 16px 0;
  letter-spacing: -0.01em;
}

/* Observações */
.observacoes {
  background: var(--card-bg);
  border: 1px solid var(--border);
  padding: 20px;
  border-radius: 8px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
}

/* Messages */
.mensagens-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.chat-message {
  padding: 20px;
  border-radius: 8px;
  background: var(--card-bg);
  border: 1px solid var(--border);
}

.chat-message-role {
  font-weight: 600;
  color: var(--primary);
  margin-bottom: 8px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.chat-message-text {
  color: var(--text);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Typography */
.chat-message-text h1,
.chat-message-text h2,
.chat-message-text h3,
.chat-message-text h4,
.chat-message-text h5,
.chat-message-text h6 {
  color: var(--text);
  font-weight: 600;
  margin: 20px 0 12px 0;
  line-height: 1.3;
}

.chat-message-text h1 { font-size: 20px; }
.chat-message-text h2 { font-size: 18px; }
.chat-message-text h3 { font-size: 16px; }
.chat-message-text h4 { font-size: 15px; }
.chat-message-text h5 { font-size: 14px; }
.chat-message-text h6 { font-size: 13px; }

.chat-message-text p {
  margin: 12px 0;
}

.chat-message-text ul,
.chat-message-text ol {
  margin: 12px 0;
  padding-left: 24px;
}

.chat-message-text li {
  margin: 4px 0;
}

.chat-message-text strong {
  font-weight: 600;
}

.chat-message-text em {
  font-style: italic;
}

/* Code */
.chat-message-text code {
  font-family: var(--font-mono);
  background: var(--code-bg);
  color: var(--code-text);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  border: 1px solid var(--border);
}

.chat-message-text pre {
  background: var(--code-bg);
  color: var(--code-text);
  padding: 16px;
  border-radius: 6px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  border: 1px solid var(--border);
  margin: 16px 0;
}

.chat-message-text pre code {
  background: none;
  border: none;
  padding: 0;
}

/* Tables */
.chat-message-text table {
  border-collapse: collapse;
  width: 100%;
  margin: 16px 0;
  font-size: 13px;
}

.chat-message-text th,
.chat-message-text td {
  border: 1px solid var(--border);
  padding: 8px 12px;
  text-align: left;
}

.chat-message-text th {
  background: var(--card-bg);
  font-weight: 600;
  color: var(--text);
}

/* Utilities */
.hr {
  height: 1px;
  background: var(--border);
  border: none;
  margin: 24px 0;
}

.footer-note {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 24px;
  text-align: center;
}

/* Responsive */
@media (max-width: 768px) {
  .documento-gerado {
    padding: 20px 16px;
    font-size: 14px;
  }

  .doc-title {
    font-size: 24px;
  }

  .section-title {
    font-size: 16px;
  }

  .doc-meta {
    flex-direction: column;
  }

  .chat-message {
    padding: 16px;
  }

  .observacoes {
    padding: 16px;
  }
}

/* Print */
@media print {
  :root {
    --bg: #ffffff;
    --text: #000000;
    --text-muted: #666666;
    --primary: #000000;
    --border: #cccccc;
    --card-bg: #ffffff;
  }

  .documento-gerado {
    padding: 20px;
    box-shadow: none;
    max-width: none;
  }

  .chat-message {
    break-inside: avoid;
    background: transparent;
    border: 1px solid var(--border);
  }

  .doc-header {
    break-after: avoid;
  }

  .section-title {
    break-after: avoid;
  }
}
</style>
`;

// ====== ROUTES ======

// ROTA: gerar + salvar documento (SEM USO DE IA) — insere mensagens verbatim no documento
app.post('/api/documento', async (req, res) => {
  try {
    const { infos, mensagens, documento, comentarios } = req.body;

    if (!infos || !mensagens || !Array.isArray(mensagens)) {
      return res.status(400).json({ error: 'Infos e mensagens são obrigatórios.' });
    }
    if (!infos.titulo || !infos.titulo.trim()) {
      return res.status(400).json({ error: 'Título é obrigatório.' });
    }

    // filtra mensagens selecionadas se houver flag `selected`, senão usa todas
    let mensagensParaUsar = mensagens;
    if (mensagens.some(m => m.selected !== undefined)) {
      mensagensParaUsar = mensagens.filter(m => Boolean(m.selected));
    }

    const mensagensOrdenadas = mensagensParaUsar.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // se frontend enviou documento pronto, salva direto
    if (documento && documento.trim()) {
      const docSaved = await Documento.create({
        infos,
        mensagens: mensagensOrdenadas,
        documento: documento.trim(),
        comentarios: comentarios || []
      });
      return res.json({ documento: docSaved.documento, id: docSaved._id });
    }

    // monta cabeçalho com todas as infos do modal
    const metaParts = [];
    if (infos.objetivo) metaParts.push(`<span class="meta-item">Objetivo: ${escapeHtml(infos.objetivo)}</span>`);
    if (infos.prazo) metaParts.push(`<span class="meta-item">Prazo: ${escapeHtml(infos.prazo)}</span>`);
    if (infos.observacoes) metaParts.push(`<span class="meta-item">Observações: ${escapeHtml(infos.observacoes).length > 80 ? escapeHtml(infos.observacoes).slice(0,77) + '...' : escapeHtml(infos.observacoes)}</span>`);
    metaParts.push(`<span class="meta-item">Mensagens: ${mensagensOrdenadas.length}</span>`);
    metaParts.push(`<span class="meta-item">Gerado em: ${new Date().toLocaleString('pt-BR')}</span>`);

    const headerHtml = `
      <header class="doc-header">
        <h1 class="doc-title">${escapeHtml(infos.titulo)}</h1>
        <div class="doc-meta">
          ${metaParts.join('\n')}
        </div>
      </header>
    `;

    const observacoesHtml = infos.observacoes ? `<section><h2 class="section-title">Observações</h2><div class="observacoes">${escapeHtml(infos.observacoes).replace(/\n/g, '<br/>')}</div></section>` : '';

    const mensagensHtml = mensagensOrdenadas.map(renderMessageHTML).join('\n');
    const mensagensSection = `<section class="mensagens-wrap"><h2 class="section-title">Mensagens Selecionadas</h2>${mensagensHtml}</section>`;

    const documentoFinal = `${docStyles}<div class="documento-gerado">${headerHtml}\n${observacoesHtml}\n${mensagensSection}</div>`.trim();

    const doc = await Documento.create({
      infos,
      mensagens: mensagensOrdenadas,
      documento: documentoFinal,
      comentarios: comentarios || []
    });

    return res.json({ documento: documentoFinal, id: doc._id });

  } catch (err) {
    console.error('Erro /api/documento:', err);
    return res.status(500).json({ error: 'Erro ao salvar documento', details: err.message });
  }
});

// ROTA: apenas gerar (não salva) — monta documento sem IA e retorna HTML
app.post('/api/documento/gerar', async (req, res) => {
  try {
    const { infos, mensagens } = req.body;
    if (!infos || !mensagens || !Array.isArray(mensagens)) {
      return res.status(400).json({ error: 'Infos e mensagens são obrigatórios.' });
    }
    if (!infos.titulo || !infos.titulo.trim()) {
      return res.status(400).json({ error: 'Título é obrigatório.' });
    }

    // filtra mensagens selecionadas se houver flag `selected`, senão usa todas
    let mensagensParaUsar = mensagens;
    if (mensagens.some(m => m.selected !== undefined)) {
      mensagensParaUsar = mensagens.filter(m => Boolean(m.selected));
    }

    const mensagensOrdenadas = mensagensParaUsar.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const metaParts = [];
    if (infos.objetivo) metaParts.push(`<span class="meta-item">Objetivo: ${escapeHtml(infos.objetivo)}</span>`);
    if (infos.prazo) metaParts.push(`<span class="meta-item">Prazo: ${escapeHtml(infos.prazo)}</span>`);
    if (infos.observacoes) metaParts.push(`<span class="meta-item">Observações: ${escapeHtml(infos.observacoes).length > 80 ? escapeHtml(infos.observacoes).slice(0,77) + '...' : escapeHtml(infos.observacoes)}</span>`);
    metaParts.push(`<span class="meta-item">Mensagens: ${mensagensOrdenadas.length}</span>`);
    metaParts.push(`<span class="meta-item">Gerado em: ${new Date().toLocaleString('pt-BR')}</span>`);

    const headerHtml = `
      <header class="doc-header">
        <h1 class="doc-title">${escapeHtml(infos.titulo)}</h1>
        <div class="doc-meta">
          ${metaParts.join('\n')}
        </div>
      </header>
    `;

    const observacoesHtml = infos.observacoes ? `<section><h2 class="section-title">Observações</h2><div class="observacoes">${escapeHtml(infos.observacoes).replace(/\n/g, '<br/>')}</div></section>` : '';
    const mensagensHtml = mensagensOrdenadas.map(renderMessageHTML).join('\n');
    const mensagensSection = `<section class="mensagens-wrap"><h2 class="section-title">Mensagens Selecionadas</h2>${mensagensHtml}</section>`;

    const documentoFinal = `${docStyles}<div class="documento-gerado">${headerHtml}\n${observacoesHtml}\n${mensagensSection}</div>`.trim();

    return res.json({ documento: documentoFinal });
  } catch (err) {
    console.error('Erro ao gerar documento:', err);
    return res.status(500).json({ error: 'Erro ao gerar documento', details: err.message });
  }
});

// Atualizar documento
app.put('/api/documento/:id', async (req, res) => {
  try {
    const { infos, mensagens, documento, comentarios } = req.body;
    const doc = await Documento.findByIdAndUpdate(
      req.params.id,
      {
        infos,
        mensagens: mensagens || [],
        documento,
        comentarios: comentarios || []
      },
      { new: true }
    );
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar documento', details: err.message });
  }
});

// Listar documentos
app.get('/api/documento', async (req, res) => {
  try {
    const docs = await Documento.find().sort({ criadoEm: -1 }).limit(50);
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar documentos', details: err.message });
  }
});

// Buscar por id
app.get('/api/documento/:id', async (req, res) => {
  try {
    const doc = await Documento.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Documento não encontrado' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar documento', details: err.message });
  }
});

// Excluir
app.delete('/api/documento/:id', async (req, res) => {
  try {
    await Documento.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir documento', details: err.message });
  }
});

// ====== SERVIDOR ======
const PORT = process.env.PORT_COLABORATIVO || 5002;
app.listen(PORT, () => {
  console.log(`🚀 Backend de geração de documento rodando em http://localhost:5002`);
});