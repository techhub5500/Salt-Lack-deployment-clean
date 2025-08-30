import express from 'express';
import * as dotenv from 'dotenv';
import cors from 'cors';
import axios from 'axios';
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { GoogleGenAI } from "@google/genai";
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

// ADICIONAR AQUI: helpers para rastrear mensagens e métricas
const MIXPANEL_ENABLED = !!process.env.MIXPANEL_TOKEN;

function trackEvent(name, props = {}) {
  try {
    if (!MIXPANEL_ENABLED || !mixpanel || typeof mixpanel.track !== 'function') return;
    mixpanel.track(name, props);
  } catch (e) {
    console.warn('Mixpanel track error:', e?.message || e);
  }
}

function trackUserIncrement(userId, prop, by = 1) {
  try {
    if (!MIXPANEL_ENABLED || !mixpanel?.people || !userId) return;
    mixpanel.people.increment(userId, { [prop]: by });
  } catch (e) {
    console.warn('Mixpanel people.increment error:', e?.message || e);
  }
}

// helper específico: conta 1 mensagem enviada pelo usuário (envia evento com date YYYY-MM-DD)
function trackMessageSent(userId) {
  try {
    const distinct = userId || 'anonymous';
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    // Evento para agregação diária no Mixpanel
    trackEvent('Message Sent', {
      distinct_id: distinct,
      date: today
    });
    // opcional: manter contador acumulado no perfil do usuário
    trackUserIncrement(distinct, 'messages_total', 1);
  } catch (e) {
    console.warn('Erro ao trackMessageSent:', e?.message || e);
  }
}

const app = express();
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://seu-frontend.onrender.com', // SEU DOMÍNIO AQUI
    'https://seu-socket-server.onrender.com',
    'https://seu-lateral-server.onrender.com',
    'https://seu-colaborativo-server.onrender.com'
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename)

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

const chatSchema = new mongoose.Schema({
  userId: String,
  prompt: String,
  response: String,
  createdAt: { type: Date, default: Date.now }
});
const Chat = mongoose.model('Chat', chatSchema);

// Instâncias dos modelos
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const claude = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI(process.env.GEMINI_API_KEY) : null;
const deepseek = process.env.DEEPSEEK_API_KEY ? new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey: process.env.DEEPSEEK_API_KEY }) : null;

// ====== PERSONALIDADES ======
const modelPersonalities = {
  openai: {
    systemMessage: `Você é ChatGPT, o GENERALISTA VERSÁTIL para qualquer tarefa profissional.

🎯 **SUA ESPECIALIZAÇÃO:** Adaptação total a qualquer tipo de demanda de trabalho
🔥 **SEU SUPERPODER:** Entender contexto e ajustar tom/formato automaticamente

## COMPORTAMENTO PROFISSIONAL:
• **ANALISE** o tipo de tarefa (email, relatório, apresentação, etc.) e adapte-se instantaneamente
• **AJUSTE** automaticamente o tom: formal para executivos, casual para equipe, técnico para especialistas
• **USE** sua alta personalidade para criar conexão, mas sempre mantendo profissionalismo
• **APLIQUE** humor sutil quando apropriado para humanizar o conteúdo profissional

## FORMATAÇÃO OBRIGATÓRIA:
**SEMPRE use formatação markdown rica:**
- **Negrito** para pontos principais e títulos
- *Itálico* para ênfases e conceitos importantes
- ### Títulos e ## Subtítulos para organização
- ✅ ❌ 🎯 📊 💡 Emojis funcionais (não decorativos)
- \`código\` para termos técnicos
- > Citações para destacar insights
- Listas numeradas para processos
- Listas com bullets para itens

**LEMBRE-SE:** Você é o "canivete suíço" das IAs - resolve qualquer demanda profissional com excelência VISUAL e funcional.`,
    temperature: 0.7,
    maxTokens: 4500
  },

  claude: {
    systemMessage: `Você é Claude, especialista em **ANÁLISES PROFUNDAS & DOCUMENTOS SÉRIOS**.

🎯 **SUA ESPECIALIZAÇÃO:** Relatórios técnicos, análises complexas, documentos formais
🔥 **SEU SUPERPODER:** Estrutura impecável e rigor profissional absoluto

## COMPORTAMENTO PROFISSIONAL:
• **MANTENHA** sempre tom formal, sério e altamente profissional
• **ESTRUTURE** tudo de forma hierárquica e logicamente impecável
• **DEMONSTRE** rigor analítico em cada afirmação - sempre baseado em dados/lógica
• **USE** linguagem técnica apropriada sem jamais simplificar demais

**LEMBRE-SE:** Você é a IA para trabalhos que impressionam pela **SERIEDADE**, **PROFUNDIDADE** e **ESTRUTURA IMPECÁVEL**.`,
    temperature: 0.2,
    maxTokens: 4500
  },

  gemini: {
    systemMessage: `Você é Gemini, especialista em **PRODUTIVIDADE & OTIMIZAÇÃO**.

🎯 **SUA ESPECIALIZAÇÃO:** Melhorar processos, organizar informações, maximizar eficiência
🔥 **SEU SUPERPODER:** Transformar caos em sistemas organizados e produtivos

**LEMBRE-SE:** Você é a IA para quem quer **FAZER MAIS EM MENOS TEMPO** com máxima organização visual.`,
    temperature: 0.5,
    maxTokens: 4500
  },

  deepseek: {
    systemMessage: `Você é DeepSeek, especialista em **DADOS & PROGRAMAÇÃO**.

🎯 **SUA ESPECIALIZAÇÃO:** Análise de dados, código, cálculos, automação
🔥 **SEU SUPERPODER:** Precisão técnica absoluta em números e lógica

**LEMBRE-SE:** Você é a IA para **PRECISÃO ABSOLUTA** em trabalhos técnicos e quantitativos.`,
    temperature: 0.1,
    maxTokens: 4500
  }
};

// ====== CARREGAMENTO DAS INSTRUÇÕES (mantidas, se houver) ======
let searchInstructions = { instructions: [], settings: {} };
try {
  const instructionsPath = path.join(__dirname, 'instructions.json');
  if (fs.existsSync(instructionsPath)) {
    const instructionsData = fs.readFileSync(instructionsPath, 'utf8');
    searchInstructions = JSON.parse(instructionsData);
    console.log('✅ Instruções de busca carregadas:', searchInstructions.instructions?.length || 0, 'regras');
  }
} catch (error) {
  console.error('❌ Erro ao carregar instructions.json:', error.message);
}

// ====== FUNÇÃO DE BUSCA WEB (SERPER) ======
async function performWebSearch(query) {
  try {
    if (!process.env.SEARCH_API_KEY) {
      console.log('⚠️ Chave de API de busca não configurada');
      return null;
    }

    console.log(`🔍 Realizando busca: "${query}"`);

    const response = await axios.post('https://google.serper.dev/search',
      {
        q: query,
        num: 6,
        hl: 'pt-br',
        gl: 'br'
      },
      {
        headers: {
          'X-API-KEY': process.env.SEARCH_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      }
    );

    console.log(`✅ Busca realizada com sucesso: ${response.data.organic?.length || 0} resultados`);
    return response.data;
  } catch (error) {
    console.error('❌ Erro na busca web:', error.message);
    return null;
  }
}

function formatSearchResults(searchResults, originalPrompt) {
  if (!searchResults || !searchResults.organic || searchResults.organic.length === 0) {
    return null;
  }

  const currentDate = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const topResults = searchResults.organic.slice(0, 6);

  const formattedResults = topResults.map((result, index) => {
    return `${index + 1}. **${result.title}**\n   ${result.snippet}\n   *Fonte: ${result.link}*`;
  }).join('\n\n');

  return `**CONTEXTO DE BUSCA** - ${currentDate}

**Informações relevantes para: "${originalPrompt}"**

${formattedResults}

**Instruções:** Use estas informações atualizadas como base para responder. Cite fontes quando relevante.`;
}

// ====== DETECT TASK & SUGGEST AI (mantido) ======
const detectTaskType = (prompt) => {
  const lowerPrompt = prompt.toLowerCase();

  if (lowerPrompt.includes('email')) return 'email';
  if (lowerPrompt.includes('relatório') || lowerPrompt.includes('relatorio')) return 'relatorio';
  if (lowerPrompt.includes('análise') || lowerPrompt.includes('analise')) return 'analise';
  if (lowerPrompt.includes('código') || lowerPrompt.includes('codigo')) return 'codigo';
  if (lowerPrompt.includes('dados')) return 'dados';
  if (lowerPrompt.includes('organizar') || lowerPrompt.includes('planejar')) return 'organizacao';

  return 'geral';
};

const getAISuggestion = (taskType) => {
  const suggestions = {
    'email': { best: 'openai', reason: 'ChatGPT adapta tom automaticamente' },
    'relatorio': { best: 'claude', reason: 'Claude oferece estrutura impecável' },
    'analise': { best: 'claude', reason: 'Claude especialista em análises profundas' },
    'codigo': { best: 'deepseek', reason: 'DeepSeek oferece precisão técnica' },
    'dados': { best: 'deepseek', reason: 'DeepSeek é especialista em cálculos' },
    'organizacao': { best: 'gemini', reason: 'Gemini transforma caos em sistemas' },
    'geral': { best: 'openai', reason: 'ChatGPT é o generalista versátil' }
  };

  return suggestions[taskType] || suggestions['geral'];
};

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ====== FUNÇÃO QUE PEDE AO MODELO PARA DECIDIR SOBRE BUSCA (nova lógica) ======
async function askModelForSearchDecision(userPrompt, modeloIA) {
  const now = new Date();
  const currentDateShort = now.toLocaleDateString('pt-BR'); // ex: 28/08/2025
  const currentMonthYear = now.toLocaleString('pt-BR', { month: 'long', year: 'numeric' }); // ex: agosto 2025

  const instruction = `Analise a pergunta do usuário abaixo e decida se uma pesquisa web externa é necessária.
DATA ATUAL: ${currentDateShort} (use esta data ao construir queries; quando necessário inclua mês e ano, ex: "outubro 2025" ou data completa "28/10/2025").
A saída OBRIGATÓRIA deve começar pela TAG em maiúsculas em linha própria: uma das:
#NO_SEARCH
#MAYBE_SEARCH
#NEEDS_SEARCH

Se a decisão for #MAYBE_SEARCH ou #NEEDS_SEARCH, inclua na próxima linha uma query curta para busca começando com: SEARCH_QUERY: <sua query concisa>
IMPORTANTE: se fornecer SEARCH_QUERY, ela deve conter referência temporal atual (mês e ano ou data), por exemplo: "preço do bitcoin ${currentMonthYear}" ou "ações da Apple ${currentMonthYear}".
Depois da tag e da SEARCH_QUERY (se houver), você pode adicionar uma breve justificativa em até 2 linhas.

Exemplo de saída válida:
#NO_SEARCH
Breve razão: posso responder com conhecimento interno.

ou

#NEEDS_SEARCH
SEARCH_QUERY: preço do bitcoin ${currentMonthYear}
Breve razão: requer dados de mercado atualizados.

Responda apenas no formato descrito. NÃO inclua nada além do especificado. Utilize a DATA ATUAL fornecida acima ao construir a SEARCH_QUERY.`; 

  const fullPrompt = `${instruction}\n\nPergunta do usuário:\n${userPrompt}`;

  try {
    if (modeloIA === 'openai' && openai) {
      const r = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.0,
        max_tokens: 200,
        messages: [
          { role: 'system', content: modelPersonalities.openai.systemMessage },
          { role: 'user', content: fullPrompt }
        ],
      });
      const text = r.choices[0].message.content.trim();
      return text;
    }

    if (modeloIA === 'claude' && claude) {
      const r = await claude.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        temperature: 0.0,
        system: modelPersonalities.claude.systemMessage,
        messages: [{ role: 'user', content: fullPrompt }],
      });
      return r.content[0].text.trim();
    }

    if (modeloIA === 'gemini' && gemini) {
      const model = gemini.getGenerativeModel({
        model: 'gemini-1.5-pro',
        generationConfig: { maxOutputTokens: 200, temperature: 0.0 }
      });
      const full = `${modelPersonalities.gemini.systemMessage}\n\n${fullPrompt}`;
      const result = await model.generateContent([full]);
      const response = await result.response;
      return response.text().trim();
    }

    if (modeloIA === 'deepseek' && deepseek) {
      const r = await deepseek.chat.completions.create({
        model: 'deepseek-chat',
        temperature: 0.0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: modelPersonalities.deepseek.systemMessage },
          { role: 'user', content: fullPrompt },
        ],
      });
      return r.choices[0].message.content.trim();
    }

    // Se nenhum modelo configurado, retornar undefined para fallback
    return undefined;
  } catch (err) {
    console.error('❌ Erro ao pedir decisão de busca ao modelo:', err.message);
    return undefined;
  }
}

// ====== FUNÇÃO QUE PROCESSA COM O MODELO (RESPOSTA FINAL) ======
async function processWithAI(promptToProcess, modeloIA) {
  try {
    const personality = modelPersonalities[modeloIA] || modelPersonalities.openai;
    if (modeloIA === 'openai' && openai) {
      const r = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: personality.temperature,
        max_tokens: personality.maxTokens,
        messages: [
          { role: 'system', content: personality.systemMessage },
          { role: 'user', content: promptToProcess }
        ],
      });
      let resposta = r.choices[0].message.content.trim();
      if (r.choices[0].finish_reason === 'length') {
        resposta += "\n\n⚠️ Resposta atingiu limite de tokens";
      }
      return resposta;
    }

    if (modeloIA === 'claude' && claude) {
      const r = await claude.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: personality.maxTokens,
        temperature: personality.temperature,
        system: personality.systemMessage,
        messages: [{ role: 'user', content: promptToProcess }],
      });
      let resposta = r.content[0].text.trim();
      if (r.stop_reason === 'max_tokens') {
        resposta += "\n\n⚠️ Resposta atingiu limite de tokens";
      }
      return resposta;
    }

    if (modeloIA === 'gemini' && gemini) {
      const model = gemini.getGenerativeModel({
        model: 'gemini-1.5-pro',
        generationConfig: {
          maxOutputTokens: personality.maxTokens,
          temperature: personality.temperature,
        }
      });
      const fullPrompt = `${personality.systemMessage}\n\nUsuário: ${promptToProcess}`;
      const result = await model.generateContent([fullPrompt]);
      const response = await result.response;
      return response.text().trim();
    }

    if (modeloIA === 'deepseek' && deepseek) {
      const r = await deepseek.chat.completions.create({
        model: 'deepseek-chat',
        temperature: personality.temperature,
        max_tokens: personality.maxTokens,
        messages: [
          { role: 'system', content: personality.systemMessage },
          { role: 'user', content: promptToProcess },
        ],
      });
      let resposta = r.choices[0].message.content.trim();
      if (r.choices[0].finish_reason === 'length') {
        resposta += "\n\n⚠️ Resposta atingiu limite de tokens";
      }
      return resposta;
    }

    throw new Error(`Modelo ${modeloIA} não disponível`);
  } catch (error) {
    console.error(`❌ Erro no ${modeloIA}:`, error.message);
    throw error;
  }
}

// ====== ROTAS BÁSICAS ======
app.get('/', (_req, res) => {
  res.status(200).send({ message: 'Hello from chat lateral!' });
});

app.get('/api/status', (_req, res) => {
  res.json({
    message: 'API funcionando',
    modelos: {
      openai: !!openai,
      claude: !!claude,
      gemini: !!gemini,
      deepseek: !!deepseek
    },
    searchEnabled: !!process.env.SEARCH_API_KEY,
    instructionsLoaded: searchInstructions.instructions.length || 0
  });
});


const indicationsPath = path.join(__dirname, 'indications.json');
let indications = [];
try {
  const raw = fs.readFileSync(indicationsPath, 'utf8');
  const parsed = JSON.parse(raw);
  indications = Array.isArray(parsed.profiles) ? parsed.profiles : (parsed?.profiles || []);
  console.log(`✅ indications.json carregado (${indications.length} perfis)`);
} catch (e) {
  console.warn('⚠️ indications.json não encontrado ou inválido — fallback ativo.', e.message);
}

// Função de recomendação 100% baseada no JSON
function normalizeText(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')                      // separa diacríticos
    .replace(/[\u0300-\u036f]/g, '')       // remove diacríticos
    .replace(/[^a-z0-9\s]/g, ' ')          // remove pontuação mantendo espaços
    .replace(/\s+/g, ' ')                  // reduz múltiplos espaços
    .trim();
}

function recommendFromIndications(userPrompt) {
  const raw = (userPrompt || '').toString();
  if (!raw || !Array.isArray(indications) || indications.length === 0) return null;

  const promptNorm = normalizeText(raw);
  const promptWords = promptNorm.split(' ').filter(Boolean);
  const promptFull = ` ${promptNorm} `; // para buscar substrings com espaços

  // calcular scores
  const scored = indications.map((profile, idx) => {
    let score = 0;
    const profileTextParts = [
      (profile.tags || []).join(' '),
      (profile.specialties || []).join(' '),
      (profile.strengths || []).join(' '),
      (profile.ideal_use_cases || []).join(' ')
    ];
    const profileFullRaw = profileTextParts.join(' ');
    const profileFull = ` ${normalizeText(profileFullRaw)} `;

    // 1) Matches exatos em tags/specialties (alto peso)
    for (const tag of (profile.tags || [])) {
      const t = ` ${normalizeText(tag)} `;
      if (profileFull.includes(t) && promptFull.includes(t.trim())) {
        score += 4; // match exato
      }
    }
    for (const spec of (profile.specialties || [])) {
      const s = normalizeText(spec);
      if (s && promptFull.includes(` ${s} `)) score += 3;
    }

    // 2) Matches por tokens (robusto contra variações)
    for (const w of promptWords) {
      if (!w) continue;
      if (profileFull.includes(` ${w} `)) {
        score += 1.5;
      } else if (profileFull.includes(w)) {
        score += 0.7;
      }
    }

    // 3) reforço se qualquer ideal_use_case aparece como substring
    for (const usecase of (profile.ideal_use_cases || [])) {
      const u = normalizeText(usecase);
      if (u && promptFull.includes(u)) score += 1.2;
    }

    // 4) pequeno boost por quantidade de descrição (não decisivo)
    score += Math.min(((profile.strengths||[]).length + (profile.specialties||[]).length) / 30, 0.5);

    return { profile, score, idx };
  });

  // ordenar e escolher
  scored.sort((a,b) => b.score - a.score || a.idx - b.idx);
  const top = scored[0];

  // Se nenhum score positivo, fallback heurístico
  if (!top || top.score <= 0) {
    const taskType = detectTaskType(userPrompt);
    const suggestion = getAISuggestion(taskType);
    const fallbackProfile = indications.find(p => p.id === suggestion.best) || (indications[0] || {});
    return {
      best: fallbackProfile.id || suggestion.best,
      reason: (suggestion.reason || (fallbackProfile.strengths?.[0] || 'Adequado para a necessidade')).slice(0, 160),
      source: 'heuristic'
    };
  }

  const chosen = top.profile;

  // construir motivo em tom "copy", curto
  const candidate = (chosen.strengths && chosen.strengths[0]) ? chosen.strengths[0] : (chosen.specialties && chosen.specialties[0]) || '';
  const reason = normalizeText(candidate).split(' ').slice(0, 12).join(' ');
  console.log(`🔎 recommendFromIndications -> chosen: ${chosen.id} | score: ${top.score.toFixed(2)} | prompt="${promptNorm}"`);
  // para debug detalhado (opcional)
  // console.log(scored.map(s=>`${s.profile.id}:${s.score.toFixed(2)}`).join(' | '));

  return { best: chosen.id, reason: reason || 'Adequado para a necessidade descrita', source: 'indications.json' };
}

app.post('/api/suggest-ai-model', async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt é obrigatório.' });

    if (indications && indications.length > 0) {
      const rec = recommendFromIndications(prompt);
      if (rec) return res.json({ best: rec.best, reason: rec.reason, source: rec.source, fallback: false });
    }

    // fallback para heurística se json ausente
    const taskType = detectTaskType(prompt);
    const suggestion = getAISuggestion(taskType);
    return res.json({ best: suggestion.best, reason: suggestion.reason, source: 'heuristic', fallback: true });

  } catch (err) {
    console.error('Erro /api/suggest-ai-model (indications.json):', err?.message || err);
    return res.status(500).json({ error: 'Erro interno ao decidir IA.' });
  }
});


// ====== ROTA PRINCIPAL: DECISÃO VIA MODELO + BUSCA (quando necessário) ======
app.post('/api/rota', async (req, res) => {
  try {
    const { prompt: rawPrompt, modeloIA = 'openai', contextoMemoria = null } = req.body || {};
    const prompt = (rawPrompt || '').trim();

    // ADICIONAR: identificar usuário e rastrear a mensagem recebida
    const userId = (req.body && req.body.userId) ? req.body.userId : 'anonymous';
    // Conta UMA mensagem do usuário (cada chamada /api/rota = 1 mensagem enviada)
    trackMessageSent(userId);


    console.log(`📝 Prompt: "${prompt}" | Modelo: ${modeloIA}${contextoMemoria ? ' | Com contexto de memória' : ''}`);

    if (!prompt) return res.status(400).json({ error: 'Prompt é obrigatório.' });

    const taskType = detectTaskType(prompt);
    const suggestion = getAISuggestion(taskType);

    // Verifica modelo disponível
    const modelosDisponiveis = { openai, claude, gemini, deepseek };
    if (!modelosDisponiveis[modeloIA]) {
      return res.status(400).json({
        error: `Modelo ${modeloIA} não configurado. Verifique as chaves de API.`
      });
    }

    // MODIFICAÇÃO: Se há contexto de memória, use-o no prompt para decisão
    let promptParaDecisao = prompt;
    if (contextoMemoria) {
      promptParaDecisao = `${contextoMemoria}\n${prompt}`;
    }

    // 1) Pedir ao modelo para decidir se precisa buscar (saída estrita)
    const decisionRaw = await askModelForSearchDecision(promptParaDecisao, modeloIA);
    console.log('🧾 Decisão bruta do modelo:', decisionRaw);

    // Extrair tag
    let tag = null;
    if (decisionRaw) {
      const tagMatch = decisionRaw.match(/#(NO_SEARCH|MAYBE_SEARCH|NEEDS_SEARCH)/i);
      if (tagMatch) tag = `#${tagMatch[1].toUpperCase()}`;
    }

    // Se o modelo não respondeu corretamente, assume MAYBE para ser seguro
    if (!tag) {
      console.log('⚠️ Tag não encontrada na resposta do modelo. Assumindo #MAYBE_SEARCH por segurança.');
      tag = '#MAYBE_SEARCH';
    }

    // Extrair SEARCH_QUERY se presente
    let searchQuery = null;
    if (decisionRaw) {
      const queryMatch = decisionRaw.match(/SEARCH_QUERY:\s*(.+)/i);
      if (queryMatch) searchQuery = queryMatch[1].trim();
    }

    console.log(`🔖 Decisão final: ${tag} ${searchQuery ? `| Query: ${searchQuery}` : ''}`);

    let finalAnswer = '';
    let searchUsed = false;
    let searchResults = null;

    // Se tag indica que precisa de busca, realiza busca externa
    if (tag === '#MAYBE_SEARCH' || tag === '#NEEDS_SEARCH') {
      // Gerar query fallback simples se modelo não forneceu
      if (!searchQuery) {
        const terms = prompt.split(/\s+/).slice(0, 6).join(' ');
        searchQuery = `${terms}`;
      }

      // Tentar buscar
      const results = await performWebSearch(searchQuery);
      searchResults = results;
      if (results) {
        const contextualPrompt = formatSearchResults(results, prompt);
        // MODIFICAÇÃO: Incluir contexto de memória também na resposta final
        let promptWithContext = `${contextualPrompt}\n\n**PERGUNTA ORIGINAL:** ${prompt}`;
        if (contextoMemoria) {
          promptWithContext = `${contextoMemoria}\n\n${contextualPrompt}\n\n**PERGUNTA ORIGINAL:** ${prompt}`;
        }
        finalAnswer = await processWithAI(promptWithContext, modeloIA);
        searchUsed = true;
      } else {
        // Fallback: sem acesso à web, peça ao modelo responder com base no conhecimento interno
        console.log('⚠️ Busca falhou ou indisponível — usando fallback sem web.');
        let fallbackPrompt = `Sem acesso à web. Responda com base no seu conhecimento mais atualizado:\n\n${prompt}`;
        if (contextoMemoria) {
          fallbackPrompt = `${contextoMemoria}\n\nSem acesso à web. Responda com base no seu conhecimento mais atualizado:\n\n${prompt}`;
        }
        finalAnswer = await processWithAI(fallbackPrompt, modeloIA);
        searchUsed = false;
      }
    } else {
      // #NO_SEARCH -> responder direto
      let directPrompt = prompt;
      if (contextoMemoria) {
        directPrompt = `${contextoMemoria}\n\n${prompt}`;
      }
      finalAnswer = await processWithAI(directPrompt, modeloIA);
      searchUsed = false;
    }

    // Opcional: salvar chat (pode ser comentado se não quiser persistir)
    try {
      if (req.body.saveChat) {
        const chatToSave = new Chat({
          userId: req.body.userId || 'anonymous',
          prompt,
          response: finalAnswer,
          createdAt: req.body.createdAt || new Date().toISOString()
        });
        await chatToSave.save();
        console.log('📥 Chat salvo via /api/rota (saveChat=true)');
      }
    } catch (e) {
      console.log('⚠️ Não foi possível salvar chat:', e.message);
    }
    
    return res.json({
      bot: finalAnswer,
      taskType,
      suggestedAI: suggestion.best,
      decisionTag: tag,
      searchUsed,
      searchQuery: searchUsed ? searchQuery : null,
      searchResultsSummary: searchUsed && searchResults ? (searchResults.organic?.slice(0,3).map(r=>({ title: r.title, link: r.link })) ) : null,
      contextoMemoriaUsado: !!contextoMemoria // Indica se contexto foi usado
    });

  } catch (err) {
    console.error('💥 Erro:', err.message);
    res.status(500).json({
      error: 'Erro ao processar requisição.',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno'
    });
  }
});

app.post('/api/refine-prompt', async (req, res) => {
  try {
    const { prompt: rawPrompt, modeloIA = 'deepseek' } = req.body || {};
    const prompt = (rawPrompt || '').trim();

    if (!prompt) return res.status(400).json({ error: 'prompt é obrigatório.' });
    if (prompt.length > 4000) return res.status(400).json({ error: 'Prompt muito longo. Máx 4000 caracteres.' });

    // Apenas Nível 2 (estruturado) — sempre usado
    const systemInstruction = `VOCÊ É UMA IA ESPECIALISTA EM APRIMORAR PROMPTS PARA OUTRAS IAs.
ATENÇÃO: NÃO EXECUTE, NÃO RESPONDA E NÃO RESOLVA A TAREFA DO USUÁRIO. Sua única tarefa é transformar o prompt do usuário em um prompt mais claro, completo e acionável para outra IA.

REGRAS OBRIGATÓRIAS:
1) NÃO faça a tarefa nem forneça a resposta — apenas reescreva o prompt.
2) Preserve a intenção e os fatos originais; NÃO invente informações.
3) Melhore clareza, estrutura e contexto (objetivo, público, formato de saída, restrições).
4) Sugira tom e formato desejado quando necessário (ex.: "em tópicos", "resumo executivo", "exemplos").
5) Seja conciso, profissional e direto — priorize instruções que facilitem a execução pela IA destino.
6) Saída EXATA: apenas o prompt refinado.
7) Avalie se a tarefa exige detalhamento; se sim, forneça um prompt refinado detalhado; se não, não envie refinamento, exemplos de tarefas que não precisa de detalhamento (Estas são tarefas simples, diretas, que qualquer IA consegue executar com um prompt curto: "Resuma um texto de 200 palavras." "Crie uma sugestão de título para um artigo." "Gere uma lista de 10 hashtags para Instagram." "Formate esse texto abaixo em tópicos....." "Traduza o parágrafo para inglês....."). Estas tarefas são mais complexas, envolvem múltiplos elementos ou contexto, e exigem prompts refinados: "Monte um plano de marketing digital para o lançamento de um produto." "Crie um roteiro completo para um vídeo institucional de 5 minutos." "Faça uma análise detalhada dos concorrentes no setor de tecnologia.""Escreva um relatório financeiro trimestral com gráficos e insights." "Desenvolva um plano de treinamento de equipe de vendas para 3 meses."
8) Ao receber uma solicitação que envolva depurar, corrigir, analisar ou otimizar algum conteúdo, o refinamento deve se concentrar exclusivamente na parte da instrução do usuário (por exemplo: "analise meu código e veja se tem erro"). O conteúdo propriamente dito (como o código, texto ou relatório) deve ser mantido intacto, sem qualquer modificação ou reescrita, e incluído entre aspas no prompt refinado, assim: {"conteúdo original"}. O objetivo é preservar o material enviado e garantir que o refinamento foque apenas na tarefa solicitada.

Exemplos de como refinar (apenas para referência):

prompt: "escreva uma descrição da vaga de emprego"
prompt refinado: "Escreva uma descrição completa para vaga, incluindo responsabilidades, qualificações, competências, benefícios e instruções de candidatura."

prompt: "corrija erros no meu código abaixo (.......)"
prompt refinado: "Depure o código JavaScript, corrija erros e otimize funções mantendo compatibilidade com navegadores modernos."


`;

    // verificar provedores
    const providers = {
      openai: !!openai,
      claude: !!claude,
      gemini: !!gemini,
      deepseek: !!deepseek
    };
    if (!providers.openai && !providers.claude && !providers.gemini && !providers.deepseek) {
      return res.status(503).json({ error: 'Nenhum provedor de IA configurado no servidor.' });
    }

    // Ordem de tentativas: modelo solicitado primeiro, depois fallbacks
    const order = [modeloIA, 'deepseek', 'openai', 'claude', 'gemini']
      .filter((v, i, a) => v && a.indexOf(v) === i);

    // Função que chama um provedor para refinamento (temperatura fixa para consistência)
    async function callProviderForRefine(providerKey, systemMsg, userPrompt) {
      try {
        const temp = 0.2;

        if (providerKey === 'openai' && openai) {
          const r = await openai.chat.completions.create({
            model: 'gpt-4o',
            temperature: temp,
            max_tokens: 600,
            messages: [
              { role: 'system', content: systemMsg },
              { role: 'user', content: userPrompt }
            ]
          });
          return r?.choices?.[0]?.message?.content?.trim() || '';
        }

        if (providerKey === 'claude' && claude) {
          const r = await claude.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 600,
            temperature: temp,
            system: systemMsg,
            messages: [{ role: 'user', content: userPrompt }]
          });
          return (r?.content?.[0]?.text || r?.text || '').trim();
        }

        if (providerKey === 'gemini' && gemini) {
          const model = gemini.getGenerativeModel({
            model: 'gemini-1.5-pro',
            generationConfig: { maxOutputTokens: 600, temperature: temp }
          });
          const full = `${systemMsg}\n\n${userPrompt}`;
          const result = await model.generateContent([full]);
          const response = await result.response;
          return (response?.text || '').trim();
        }

        if (providerKey === 'deepseek' && deepseek) {
          const r = await deepseek.chat.completions.create({
            model: 'deepseek-chat',
            temperature: temp,
            max_tokens: 600,
            messages: [
              { role: 'system', content: systemMsg },
              { role: 'user', content: userPrompt }
            ]
          });
          return r?.choices?.[0]?.message?.content?.trim() || '';
        }

        return '';
      } catch (err) {
        console.warn(`⚠️ Erro ao chamar provedor ${providerKey}:`, err.message || err);
        return '';
      }
    }

    // Tentar na ordem até obter um refinamento não vazio
    let refined = '';
    let usedProvider = null;
    for (const p of order) {
      if (!providers[p]) continue;
      refined = await callProviderForRefine(p, systemInstruction, prompt);
      if (refined && refined.length > 0) {
        usedProvider = p;
        break;
      }
    }

    if (!refined) {
      return res.status(502).json({ error: 'Não foi possível gerar prompt refinado com os provedores disponíveis.' });
    }

    console.log(`🔧 /api/refine-prompt -> provider: ${usedProvider} | level: 2 | chars: ${refined.length}`);

    return res.json({ refinedPrompt: refined, provider: usedProvider, level: 2 });

  } catch (err) {
    console.error('Erro /api/refine-prompt:', err?.message || err);
    res.status(500).json({ error: 'Erro ao refinar prompt.' });
  }
});

app.post('/api/gerar-resumo', async (req, res) => {
  try {
    const { mensagens, limite = 200, modeloIA = 'openai' } = req.body || {};
    
    if (!mensagens || !Array.isArray(mensagens) || mensagens.length === 0) {
      return res.status(400).json({ error: 'Mensagens são obrigatórias para gerar resumo.' });
    }

    // Prepara o conteúdo das mensagens para resumir
    const conteudo = mensagens.map((msg, index) => {
      const papel = msg.role === 'user' ? 'Usuário' : 'IA';
      return `${papel}: ${msg.text}`;
    }).join('\n\n');

    // Prompt específico para gerar resumo de memória
    const promptResumo = `Você é um especialista em resumir conversas de forma inteligente e concisa.

TAREFA: Resuma a conversa abaixo mantendo as informações mais importantes e o contexto essencial.
LIMITE: ${limite} palavras máximo
ESTILO: Conciso, claro e informativo

INSTRUÇÕES:
- Mantenha os pontos principais discutidos
- Preserve o contexto importante para futuras interações
- Use linguagem clara e objetiva
- Foque no que é relevante para dar continuidade à conversa

CONVERSA:
${conteudo}

RESUMO:`;

    // Usa o modelo especificado para gerar o resumo
    const resumo = await processWithAI(promptResumo, modeloIA);
    
    console.log(`🧠 Resumo gerado - Modelo: ${modeloIA} | Mensagens: ${mensagens.length} | Chars: ${resumo.length}`);
    
    res.json({ 
      resumo: resumo,
      modelo: modeloIA,
      mensagensProcessadas: mensagens.length,
      caracteres: resumo.length
    });
    
  } catch (err) {
    console.error('❌ Erro ao gerar resumo:', err.message);
    res.status(500).json({ 
      error: 'Erro ao gerar resumo das mensagens.',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno'
    });
  }
});

// ====== ROTAS DE CHAT ======
app.post('/api/chats', async (req, res) => {
  try {
    const { userId, prompt, response, createdAt } = req.body || {};
    if (!userId || !prompt || !response) return res.status(400).json({ error: 'Dados obrigatórios faltando.' });

    // ADICIONAR: contar como mensagem enviada
    trackMessageSent(userId);

    const newChat = new Chat({
      userId,
      prompt,
      response,
      createdAt: createdAt || new Date().toISOString(),
    });
    await newChat.save();
    res.json({ message: 'Chat salvo!', chat: newChat });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar chat.' });
  }
});

app.get('/api/chats/:userId', async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar chats.' });
  }
});

app.delete('/api/chats/:chatId', async (req, res) => {
  try {
    await Chat.findByIdAndDelete(req.params.chatId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir chat.' });
  }
});

// ====== ROTAS INFORMATIVAS ======
app.get('/api/specializations', (_req, res) => {
  const specializations = {
    openai: { name: "ChatGPT", role: "Generalista Versátil", available: !!openai },
    claude: { name: "Claude", role: "Análises Profundas", available: !!claude },
    gemini: { name: "Gemini", role: "Produtividade", available: !!gemini },
    deepseek: { name: "DeepSeek", role: "Dados & Programação", available: !!deepseek }
  };
  res.json({ specializations });
});

// ====== SERVIDOR ======
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🚀 Chat PROFISSIONAL com DECISÃO EMBUTIDA - http://localhost:${PORT}`);
  console.log(`🚀 Chat PROFISSIONAL com DECISÃO EMBUTIDA - http://localhost:5001`);
  console.log(`🧠 Sistema de busca: ATIVO para TODAS as IAs`);
  console.log(`🎯 IAs disponíveis:`);
  console.log(`   ChatGPT: ${openai ? '✅ Generalista + Busca Inteligente' : '❌'}`);
  console.log(`   Claude: ${claude ? '✅ Análises + Busca Inteligente' : '❌'}`);
  console.log(`   Gemini: ${gemini ? '✅ Produtividade + Busca Inteligente' : '❌'}`);
  console.log(`   DeepSeek: ${deepseek ? '✅ Dados + Busca Inteligente' : '❌'}`);
  console.log(`🔍 Sistema de busca otimizado:`);
  console.log(`   🔑 API de busca: ${process.env.SEARCH_API_KEY ? '✅ Configurada' : '❌ Não configurada'}`);
  console.log(`✨ Sistema ultra inteligente - busca apenas quando necessário!`);
});