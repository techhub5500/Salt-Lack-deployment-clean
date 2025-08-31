// --- CONSTANTES E VARIÁVEIS ---
// Elementos principais do DOM e controle de estado do chat
const chatgptContainer = document.querySelector('.chatgpt-container-gpt');
const btnNovoChat = document.getElementById('btnNovoChatGpt');
const btnHistoricoChat = document.getElementById('btnHistoricoChatGpt');
const historicoModal = document.getElementById('chatgptHistoricoModalGpt');
const btnFecharHistorico = document.getElementById('chatgptFecharHistoricoGpt') || document.getElementById('btnFecharHistoricoGpt');
const historicoList = document.getElementById('chatgptHistoricoListGpt');
const historicoEmpty = document.getElementById('chatgptHistoricoEmptyGpt');
const searchInput = document.getElementById('chatgptSearchInputGpt');
const CHATGPT_HISTORY_LIMIT = 100;


function getApiUrl(service) {
    const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const urls = {
        socket: isProduction ? 'https://salt-lack.onrender.com' : 'http://localhost:3000',
        lateral: isProduction ? 'https://salt-lack-lateral.onrender.com' : 'http://localhost:5001', 
        colaborativo: isProduction ? 'https://salt-lack-colaborativo.onrender.com' : 'http://localhost:5002'
    };
    return urls[service];
}

let currentChatId = null;
let iaRespondendo = false; 
let currentChatMessages = [];
let isRestoring = false;
// Helpers para obter userId do localStorage
function getUserId() {
    try {
        return localStorage.getItem('userId') || null;
    } catch (e) {
        return null;
    }
}

function getAuthHeaders() {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

let userId = getUserId(); // valor inicial
let primeiraResposta = true;


let chatMemories = {}; // Armazena memórias por chat ID
let currentChatMemory = null; // Memória do chat atual


// SISTEMA DE MEMÓRIA - FUNÇÕES PRINCIPAIS
// Gera resumo das mensagens usando OpenAI
async function gerarResumoMensagens(mensagens, limite = 200) {
    if (!mensagens || mensagens.length === 0) return null;
    
    try {
        const response = await fetch(`${getApiUrl('lateral')}/api/gerar-resumo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                mensagens: mensagens,
                limite: limite,
                modeloIA: 'openai' // Sempre usa OpenAI para resumos (mais consistente)
            })
        });

        if (!response.ok) throw new Error('Falha na API de resumo');
        
        const data = await response.json();
        console.log(`🧠 Resumo gerado: ${data.mensagensProcessadas} msgs → ${data.caracteres} chars`);
        return data.resumo || null;
        
    } catch (error) {
        console.error('Erro ao gerar resumo:', error);
        return null;
    }
}

// Atualiza a memória do chat atual
async function atualizarMemoriaChat() {
    if (!currentChatId || currentChatMessages.length < 2) return;
    
    // Inicializa memória se não existir
    if (!chatMemories[currentChatId]) {
        chatMemories[currentChatId] = {
            resumoAntigo: null,
            ultimasMensagens: [],
            totalMensagens: 0
        };
    }
    
    const memoria = chatMemories[currentChatId];
    memoria.totalMensagens = currentChatMessages.length;
    
    // Se temos mais de 8 mensagens, precisamos resumir as antigas
    if (currentChatMessages.length > 8) {
        const mensagensAntigas = currentChatMessages.slice(0, -8);
        const ultimasMensagens = currentChatMessages.slice(-8);
        
        // Só gera novo resumo se mudou significativamente
        if (mensagensAntigas.length !== memoria.ultimasMensagens.length) {
            console.log('🧠 Gerando resumo das mensagens antigas...');
            const resumoAntigo = await gerarResumoMensagens(mensagensAntigas, 150);
            memoria.resumoAntigo = resumoAntigo;
        }
        
        memoria.ultimasMensagens = ultimasMensagens;
    } else {
        // Menos de 8 mensagens, mantém todas como "últimas"
        memoria.ultimasMensagens = [...currentChatMessages];
        memoria.resumoAntigo = null;
    }
    
    currentChatMemory = memoria;
    console.log(`🧠 Memória atualizada para chat ${currentChatId}:`, {
        totalMensagens: memoria.totalMensagens,
        temResumoAntigo: !!memoria.resumoAntigo,
        ultimasMensagens: memoria.ultimasMensagens.length
    });
}

// Gera contexto de memória para enviar à IA
async function obterContextoMemoria() {
    if (!currentChatMemory || currentChatMemory.totalMensagens < 2) {
        return null;
    }
    
    let contexto = "CONTEXTO DA CONVERSA ANTERIOR:\n\n";
    
    // Adiciona resumo das mensagens antigas se existir
    if (currentChatMemory.resumoAntigo) {
        contexto += `RESUMO DAS INTERAÇÕES ANTERIORES:\n${currentChatMemory.resumoAntigo}\n\n`;
    }
    
    // Adiciona as últimas mensagens se houver mais de 1
    if (currentChatMemory.ultimasMensagens.length > 1) {
        console.log('🧠 Gerando resumo das últimas mensagens...');
        const resumoRecente = await gerarResumoMensagens(currentChatMemory.ultimasMensagens, 200);
        if (resumoRecente) {
            contexto += `RESUMO DAS ÚLTIMAS INTERAÇÕES:\n${resumoRecente}\n\n`;
        }
    }
    
    contexto += "NOVA MENSAGEM DO USUÁRIO:\n";
    return contexto;
}

// --- SELEÇÃO DE MENSAGENS E COMPARTILHAMENTO ---
// Controle de seleção de mensagens para compartilhar ou gerar documento
let selectedChatMessages = [];
let isSelectionMode = false;

const btnSelecionarMensagens = document.getElementById('btnSelecionarMensagensGpt');
if (btnSelecionarMensagens) {
    btnSelecionarMensagens.onclick = openModalOpcoesSelecao;
}

// --- RENDERIZAÇÃO DAS MENSAGENS DO CHAT ---
// Renderiza as mensagens do chat, incluindo modo de seleção
function renderChatMessages() {
    const messagesDiv = document.getElementById('chatgptMessagesGpt');
    if (!messagesDiv) return;
    messagesDiv.innerHTML = '';
    currentChatMessages.forEach((msg, idx) => {
        const div = document.createElement('div');
        div.className = 'chatgpt-message-gpt ' + (msg.role === 'user' ? 'user' : 'bot');
        div.setAttribute('data-index', idx);

        // Modo seleção de mensagens
        if (isSelectionMode) {
            div.classList.add('selectable');
            div.onclick = () => toggleSelectMessage(idx);
            if (selectedChatMessages.includes(idx)) {
                div.classList.add('selected');
            }
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        // Renderiza markdown para mensagens da IA
        if (msg.role === 'bot') {
            contentDiv.innerHTML = typeof marked !== 'undefined' ? marked.parse(msg.text) : msg.text;
            applySyntaxHighlighting(contentDiv);
        } else {
            contentDiv.textContent = msg.text;
        }
        div.appendChild(contentDiv);
        messagesDiv.appendChild(div);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Exibe botão compartilhar se houver seleção
    const btnCompartilhar = document.getElementById('btnCompartilharMensagensGpt');
    if (btnCompartilhar) {
        btnCompartilhar.style.display = (isSelectionMode && selectedChatMessages.length > 0) ? 'block' : 'none';
    }
    atualizarBotoesSelecao();
    atualizarHintBubble();
}

// Evento do botão cancelar seleção
document.getElementById('btnCancelarSelecaoMensagensGpt').onclick = cancelarSelecaoMensagens;


// Seleciona/desseleciona mensagem no modo seleção
function toggleSelectMessage(idx) {
    if (selectedChatMessages.includes(idx)) {
        selectedChatMessages = selectedChatMessages.filter(i => i !== idx);
    } else {
        selectedChatMessages.push(idx);
    }
    renderChatMessages();
}

// --- MODAL DE INFORMAÇÕES PARA GERAR DOCUMENTO ---
function openModalInfos() {
    const modal = document.getElementById('modalInfosGpt');
    if (!modal) return console.warn('modalInfosGpt não encontrado');

    modal.style.display = 'flex';

    // cancelar / gerar
    const btnCancelar = document.getElementById('btnCancelarModalGpt');
    const btnGerar = document.getElementById('btnGerarDocumentoGpt');
    if (btnCancelar) { btnCancelar.onclick = () => modal.style.display = 'none'; }
    if (btnGerar) { btnGerar.onclick = enviarDocumentoBackend; }

    // Objetivo: select -> hidden + descrição (aparece quando usuário escolhe)
    const objetivoHidden = document.getElementById('modalObjetivoGpt');
    const objetivoSelect = document.getElementById('modalObjetivoGptSelect');
    const objetivoDesc = document.getElementById('modalObjetivoDescricaoGpt');

    const copies = {
        Revisar: 'Revisar — Solicite uma revisão detalhada: identifique pontos de melhoria, sugestões práticas e checagens necessárias antes da entrega final.',
        Entregar: 'Entregar — O documento será formulado como versão final, pronta para aprovação: clareza nos resultados, checklist de conclusão e instruções rápidas de uso.'
    };

    function mostrarDescricao(valor) {
        if (!objetivoDesc) return;
        if (!valor) { objetivoDesc.style.display = 'none'; objetivoDesc.textContent = ''; objetivoDesc.setAttribute('aria-hidden','true'); return; }
        objetivoDesc.textContent = copies[valor] || '';
        objetivoDesc.style.display = 'block';
        objetivoDesc.setAttribute('aria-hidden','false');
    }

    if (objetivoSelect && !objetivoSelect.dataset.inited) {
        // quando o usuário trocar, atualiza hidden e mostra copy
        objetivoSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (objetivoHidden) objetivoHidden.value = val;
            mostrarDescricao(val);
        });
        objetivoSelect.dataset.inited = '1';
    }
    // inicial: se já existir valor hidden ou escolha padrão, sincroniza (opcional mostrar)
    const inicial = (objetivoHidden && objetivoHidden.value) ? objetivoHidden.value : (objetivoSelect ? objetivoSelect.value : '');
    if (objetivoSelect) objetivoSelect.value = inicial || '';
    // não forçar exibição automática: mostrar apenas se já havia valor
    if (inicial) mostrarDescricao(inicial);

    // Prazo: "Sem prazo" por padrão, ao clicar mostra date input; não remove elemento do DOM
    const prazoDisplay = document.getElementById('modalPrazoDisplayGpt');
    const prazoInput = document.getElementById('modalPrazoGpt');
    const prazoLimpar = document.getElementById('modalPrazoLimparGpt');

    function formatarData(value) {
        if (!value) return 'Sem prazo';
        const d = new Date(value + 'T00:00:00');
        if (isNaN(d)) return value;
        return d.toLocaleDateString('pt-BR');
    }

    if (prazoDisplay && !prazoDisplay.dataset.inited) {
        prazoDisplay.addEventListener('click', () => {
            prazoDisplay.style.display = 'none';
            if (prazoInput) { prazoInput.style.display = 'inline-block'; prazoInput.focus(); }
        });
        prazoDisplay.dataset.inited = '1';
    }

    if (prazoInput && !prazoInput.dataset.inited) {
        // inicialização visual
        if (prazoInput.value) {
            prazoDisplay.textContent = formatarData(prazoInput.value);
            prazoDisplay.style.display = 'inline-block';
            prazoInput.style.display = 'none';
            if (prazoLimpar) { prazoLimpar.style.display = 'inline-block'; prazoLimpar.setAttribute('aria-hidden','false'); }
        } else {
            prazoDisplay.textContent = 'Sem prazo';
            prazoDisplay.style.display = 'inline-block';
            prazoInput.style.display = 'none';
            if (prazoLimpar) { prazoLimpar.style.display = 'none'; prazoLimpar.setAttribute('aria-hidden','true'); }
        }

        prazoInput.addEventListener('change', () => {
            if (prazoInput.value) {
                prazoDisplay.textContent = formatarData(prazoInput.value);
                prazoInput.style.display = 'none';
                prazoDisplay.style.display = 'inline-block';
                if (prazoLimpar) { prazoLimpar.style.display = 'inline-block'; prazoLimpar.setAttribute('aria-hidden','false'); }
            }
        });

        prazoInput.addEventListener('blur', () => {
            if (!prazoInput.value) {
                prazoInput.style.display = 'none';
                prazoDisplay.textContent = 'Sem prazo';
                prazoDisplay.style.display = 'inline-block';
                if (prazoLimpar) { prazoLimpar.style.display = 'none'; prazoLimpar.setAttribute('aria-hidden','true'); }
            }
        });

        prazoInput.dataset.inited = '1';
    }

    if (prazoLimpar && !prazoLimpar.dataset.inited) {
        prazoLimpar.addEventListener('click', () => {
            if (prazoInput) prazoInput.value = '';
            if (prazoInput) prazoInput.style.display = 'none';
            if (prazoDisplay) { prazoDisplay.textContent = 'Sem prazo'; prazoDisplay.style.display = 'inline-block'; }
            prazoLimpar.style.display = 'none';
            prazoLimpar.setAttribute('aria-hidden','true');
        });
        prazoLimpar.dataset.inited = '1';
    }

        // Fecha o modal imediatamente ao clicar e então dispara o envio
    if (btnGerar) {
        btnGerar.onclick = () => {
            // fecha modal à vista do usuário
            modal.style.display = 'none';
            // chama envio (executa assíncrono pouco depois para garantir repaint)
            setTimeout(() => enviarDocumentoBackend(), 50);
        };
    }
    // foco no título
    const titulo = document.getElementById('modalTituloGpt');
    if (titulo) titulo.focus();
}

function mostrarFrasesSpinnerDocumento(callbackQuandoPronto) {
    const frases = [
        { texto: "Estamos organizando seu documento...", tempo: 3800 },
        { texto: "Estamos deixando melhor...", tempo: 3800 },
        { texto: "Seu documento está quase pronto...", tempo: 3400 }
    ];
    const frasesDiv = document.getElementById('documentoSpinnerFrasesGpt');
    let idx = 0;
    let timeoutId = null;
    let terminou = false;

    function mostrarProximaFrase() {
        if (!frasesDiv) return;
        frasesDiv.style.opacity = 0;
        setTimeout(() => {
            frasesDiv.textContent = frases[idx].texto;
            frasesDiv.style.opacity = 1;
        }, 300);

        timeoutId = setTimeout(() => {
            idx++;
            if (idx < frases.length) {
                mostrarProximaFrase();
            } else {
                terminou = true;
                // Aguarda callbackQuandoPronto para sumir frase e mostrar documento
                if (typeof callbackQuandoPronto === 'function') {
                    callbackQuandoPronto(() => {
                        frasesDiv.style.opacity = 0;
                        setTimeout(() => {
                            frasesDiv.textContent = '';
                        }, 500);
                    });
                }
            }
        }, frases[idx].tempo);
    }

    mostrarProximaFrase();

    // Retorna função para manter última frase até documento pronto
    return {
        manterUltimaFrase: function() {
            if (!terminou && timeoutId) {
                clearTimeout(timeoutId);
                // Mantém última frase até callbackQuandoPronto ser chamado
            }
        }
    };
}

// --- ENVIO DE DOCUMENTO PARA BACKEND (porta 5002) ---
// Envia documento gerado para o backend
async function enviarDocumentoBackend() {
    const modal = document.getElementById('modalInfosGpt');
    
    // VALIDAÇÃO DE TÍTULO ANTES DO ENVIO
    const tituloEl = document.getElementById('modalTituloGpt');
    const titulo = tituloEl ? tituloEl.value.trim() : '';
    if (!titulo) {
        alert('Por favor, preencha o título do documento antes de gerar.');
        if (tituloEl) tituloEl.focus();
        return;
    }
    
    const infos = {
        titulo: titulo,
        objetivo: document.getElementById('modalObjetivoGpt')?.value || '',
        prazo: document.getElementById('modalPrazoGpt')?.value || '',
        observacoes: document.getElementById('modalObsGpt')?.value || ''
    };
    const mensagens = selectedChatMessages.sort((a, b) => a - b)
        .map(idx => currentChatMessages[idx]);

    // Mostra spinner e modal do documento gerado
    const docContainer = document.getElementById('documentoGeradoContainerGpt');
    const spinner = document.getElementById('documentoSpinnerGpt');
    const docContent = document.getElementById('documentoGeradoContentGpt');
    const btnSalvar = document.getElementById('btnSalvarDocumentoGeradoGpt');
    const btnCancelar = document.getElementById('btnCancelarDocumentoGeradoGpt');
    
    if (docContainer && spinner && docContent) {
        docContainer.classList.remove('hidden');
        spinner.classList.remove('hidden');
        docContent.innerHTML = '';
        if (btnSalvar) btnSalvar.classList.add('hidden');
        if (btnCancelar) btnCancelar.classList.add('hidden');
    }

    let frasesSpinnerControl = mostrarFrasesSpinnerDocumento(function(ocultarFrase) {
        frasesSpinnerControl.manterUltimaFrase = function() {};
        frasesSpinnerControl.ocultarFrase = ocultarFrase;
    });

    try {
        // Tenta primeiro o servidor colaborativo
         let apiUrl = `${getApiUrl('colaborativo')}/api/documento/gerar`;
        console.log('Tentando URL colaborativo:', apiUrl);
        
        const controller = new AbortController();
         const timeoutId = setTimeout(() => controller.abort(), 30000);
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ infos, mensagens }),
            signal: controller.signal // ✅ Usar signal para timeout
        });

        clearTimeout(timeoutId); 
        
        if (!response.ok) {
            // Se falhar, tenta servidor lateral como fallback
            console.warn('Servidor colaborativo falhou, tentando servidor lateral...');
            
            // Verifica se existe endpoint no servidor lateral
            const fallbackUrl = `${getApiUrl('colaborativo')}/api/documento/gerar`;
            console.log('Tentando URL lateral:', fallbackUrl);
            
            const fallbackResponse = await fetch(fallbackUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ infos, mensagens }),
                timeout: 30000
            });
            
            if (!fallbackResponse.ok) {
                // Se ambos falharam, gera documento localmente
                console.warn('Ambos servidores falharam, gerando documento localmente...');
                const documentoLocal = gerarDocumentoLocal(infos, mensagens);
                processDocumentResponse({ documento: documentoLocal }, infos, mensagens, spinner, btnSalvar, btnCancelar, frasesSpinnerControl, modal);
                return;
            }
            
            const fallbackData = await fallbackResponse.json();
            processDocumentResponse(fallbackData, infos, mensagens, spinner, btnSalvar, btnCancelar, frasesSpinnerControl, modal);
            return;
        }
        
        const data = await response.json();
        processDocumentResponse(data, infos, mensagens, spinner, btnSalvar, btnCancelar, frasesSpinnerControl, modal);
        
    } catch (error) {
        console.error('Erro detalhado:', error);
        
        // Fallback final: gera documento localmente
        try {
            console.log('Gerando documento localmente como último recurso...');
            const documentoLocal = gerarDocumentoLocal(infos, mensagens);
            processDocumentResponse({ documento: documentoLocal }, infos, mensagens, spinner, btnSalvar, btnCancelar, frasesSpinnerControl, modal);
        } catch (localError) {
            console.error('Erro ao gerar documento local:', localError);
            
            if (spinner) spinner.classList.add('hidden');
            if (btnSalvar) btnSalvar.classList.remove('hidden');
            if (btnCancelar) btnCancelar.classList.remove('hidden');
            if (frasesSpinnerControl?.ocultarFrase) frasesSpinnerControl.ocultarFrase();
            
            // Mensagem de erro mais específica
            let errorMessage = 'Erro ao gerar documento. ';
            if (error.message.includes('CORS') || error.message.includes('blocked')) {
                errorMessage += 'Problema de CORS - verifique se os servidores estão configurados corretamente.';
            } else if (error.message.includes('Failed to fetch')) {
                errorMessage += 'Servidor indisponível - verifique se o servidor colaborativo está rodando.';
            } else {
                errorMessage += 'Verifique sua conexão e tente novamente.';
            }
            
            alert(errorMessage);
        }
    }
}

function processDocumentResponse(data, infos, mensagens, spinner, btnSalvar, btnCancelar, frasesSpinnerControl, modal) {
    // Esconde spinner e exibe documento gerado
    if (spinner) spinner.classList.add('hidden');
    if (btnSalvar) btnSalvar.classList.remove('hidden');
    if (btnCancelar) btnCancelar.classList.remove('hidden');

    if (frasesSpinnerControl?.ocultarFrase) frasesSpinnerControl.ocultarFrase();

    mostrarDocumentoGeradoComSalvar(
        data.documento || 'Erro ao gerar documento.',
        null,
        [],
        infos,
        mensagens
    );
    if (modal) modal.style.display = 'none';
}

function gerarDocumentoLocal(infos, mensagens) {
    const agora = new Date().toLocaleString('pt-BR');
    
    let conteudoMensagens = '';
    if (mensagens && mensagens.length > 0) {
        conteudoMensagens = mensagens.map(msg => {
            const tipo = msg.role === 'user' ? 'Usuário' : 'IA';
            return `**${tipo}:** ${msg.text}`;
        }).join('\n\n');
    }
    
    return `# ${infos.titulo || 'Documento Gerado'}

**Data de Criação:** ${agora}

## Informações do Documento

**Objetivo:** ${infos.objetivo || 'Não especificado'}
**Prazo:** ${infos.prazo || 'Não definido'}
**Observações:** ${infos.observacoes || 'Nenhuma observação adicional'}

---

## Conteúdo das Mensagens

${conteudoMensagens || 'Nenhuma mensagem selecionada'}

---

*Documento gerado localmente devido à indisponibilidade do servidor.*`;
}

// --- SUGESTÃO INTELIGENTE DE IA ---
// Detecta tipo de tarefa e sugere IA ideal
function detectarTipoTarefa(prompt) {
    const lower = prompt.toLowerCase();
    if (lower.includes('email') || lower.includes('e-mail')) return 'email';
    if (lower.includes('relatório') || lower.includes('relatorio')) return 'relatorio';
    if (lower.includes('apresentação') || lower.includes('apresentacao') || lower.includes('slide')) return 'apresentacao';
    if (lower.includes('análise') || lower.includes('analise')) return 'analise';
    if (lower.includes('código') || lower.includes('codigo') || lower.includes('programar')) return 'codigo';
    if (lower.includes('dados') || lower.includes('planilha') || lower.includes('excel')) return 'dados';
    if (lower.includes('organizar') || lower.includes('planejar') || lower.includes('tarefa')) return 'organizacao';
    if (lower.includes('processo') || lower.includes('fluxo') || lower.includes('otimizar')) return 'processo';
    return 'geral';
}

// Retorna sugestão de IA para o tipo de tarefa
function obterSugestaoIA(tipo) {
    const sugestoes = {
        'email': { best: 'openai', motivo: 'ChatGPT adapta tom automaticamente para diferentes públicos.' },
        'relatorio': { best: 'claude', motivo: 'Claude oferece estrutura impecável e rigor profissional.' },
        'apresentacao': { best: 'openai', motivo: 'ChatGPT combina storytelling com formatação clara.' },
        'analise': { best: 'claude', motivo: 'Claude é especialista em análises profundas e fundamentadas.' },
        'codigo': { best: 'deepseek', motivo: 'DeepSeek oferece precisão técnica absoluta em programação.' },
        'dados': { best: 'deepseek', motivo: 'DeepSeek é especialista em cálculos e análises quantitativas.' },
        'organizacao': { best: 'gemini', motivo: 'Gemini transforma caos em sistemas organizados.' },
        'processo': { best: 'gemini', motivo: 'Gemini é especialista em otimização e produtividade.' },
        'geral': { best: 'openai', motivo: 'ChatGPT é o generalista versátil para qualquer tarefa.' }
    };
    return sugestoes[tipo] || sugestoes['geral'];
}

const aiToolsData = [
  { id: "openai", name: "ChatGPT", keywords: ["email","texto","marketing","copy","mensagem"], strengths: "bom para conversas e edição de texto", priority: 5 },
  { id: "claude", name: "Claude", keywords: ["relatório","relatorio","análise","analise","resumo"], strengths: "estrutura e rigor em relatórios", priority: 8 },
  { id: "deepseek", name: "DeepSeek", keywords: ["código","codigo","programar","debug","api"], strengths: "precisão técnica em programação", priority: 9 },
  { id: "gemini", name: "Gemini", keywords: ["organizar","planejar","tarefa","processo","fluxo"], strengths: "organização e produtividade", priority: 7 }
];

let aiTools = [];

function initAIToolsFromEmbedded() {
  aiTools = aiToolsData.map(t => ({ ...t, _keywords: (t.keywords||[]).map(k=>k.toLowerCase()), priority: t.priority||0 }));
  aiTools.sort((a,b)=> (b.priority||0)-(a.priority||0));
  console.log('AI tools loaded:', aiTools.map(x=>x.id));
}

async function chooseToolForPrompt(prompt) {
  try {
    const resp = await fetch(`${getApiUrl('lateral')}/api/suggest-ai-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!resp.ok) throw new Error('Erro sugestão IA');
    const data = await resp.json();
    // retorna formato esperado pelo frontend: { best, reason }
    return { best: data.best || getIAAtual(), reason: data.reason || '' };
  } catch (err) {
    console.error('Erro chooseToolForPrompt:', err);
    // fallback local
    const fallback = getAISuggestion(detectTaskType(prompt));
    return { best: fallback.best, reason: fallback.reason };
  }
}

// Mostra popup de sugestão de IA
// atualizar mostrarPopupSugestaoIA: quando o usuário troca, sincroniza UI também
function mostrarPopupSugestaoIA(iaAtual, iaRecomendada, motivo, onTrocar, onContinuar) {
    try {
        const overlay = document.getElementById('popup-sugestao-ia');
        if (!overlay) return;

        const nomes = {
            'openai': 'ChatGPT',
            'claude': 'Claude',
            'gemini': 'Gemini',
            'deepseek': 'DeepSeek',
            'perplexity': 'Perplexity' // mapeamento extra para o novo profile
        };

        overlay.style.display = 'flex';

        const infoEl = overlay.querySelector('.sugestao-ia-modal__info');
        const motivoEl = overlay.querySelector('.sugestao-ia-modal__motivo');
        const btnTrocar = overlay.querySelector('#btnTrocarIA');
        const btnContinuar = overlay.querySelector('#btnContinuarIA');

        if (infoEl) {
            infoEl.innerHTML = `
                <div><strong>IA atual:</strong> ${escapeHtml(nomes[iaAtual] || iaAtual)}</div>
                <div><strong>IA recomendada:</strong> ${escapeHtml(nomes[iaRecomendada] || iaRecomendada)}</div>
            `;
        }
        if (motivoEl) {
            // usa escapeHtml definida no arquivo para evitar XSS
            motivoEl.innerHTML = escapeHtml(motivo || '');
        }

        if (btnTrocar) {
            btnTrocar.textContent = `Migrar para ${nomes[iaRecomendada] || iaRecomendada}`;
            btnTrocar.disabled = (iaAtual === iaRecomendada);
            btnTrocar.onclick = function() {
                overlay.style.display = 'none';
                window.iaAtual = iaRecomendada;
                try { localStorage.setItem('iaAtual', iaRecomendada); } catch(e){}
                if (typeof atualizarIAUI === 'function') atualizarIAUI();
                if (typeof onTrocar === 'function') onTrocar();
            };
        }

        if (btnContinuar) {
            btnContinuar.textContent = `Continuar com ${nomes[iaAtual] || iaAtual}`;
            btnContinuar.onclick = function() {
                overlay.style.display = 'none';
                if (typeof onContinuar === 'function') onContinuar();
            };
        }

        overlay.onclick = function(e) {
            if (e.target === overlay) {
                overlay.style.display = 'none';
            }
        };
    } catch (err) {
        console.error('mostrarPopupSugestaoIA erro:', err);
    }
}

// --- ENVIO DE MENSAGEM PARA IA ---
// Envia mensagem para backend da IA selecionada e renderiza resposta
async function enviarMensagemParaIA(msg, iaEscolhida) {
    addMessage('user', msg);
    chatgptInput.value = '';
    iaRespondendo = true;
    atualizarIconeEnvio();
    showThinking();
    const tempoThinking = primeiraResposta ? 2000 : 500;
    primeiraResposta = false;
    
    setTimeout(async () => {
        try {
            window.iaAtual = iaEscolhida;
            document.getElementById('iaAtual').textContent = {
                'openai': 'ChatGPT',
                'claude': 'Claude',
                'gemini': 'Gemini',
                'deepseek': 'DeepSeek'
            }[iaEscolhida];
            
            // NOVO: Obter contexto de memória
            const contextoMemoria = await obterContextoMemoria();
            
            // Preparar o corpo da requisição
            const requestBody = {
                prompt: msg,
                modeloIA: iaEscolhida,
                userId: getUserId() // SEMPRE incluir userId do localStorage
            };

            // NOVO: Adicionar contexto se existir
            if (contextoMemoria) {
                requestBody.contextoMemoria = contextoMemoria;
                console.log('🧠 Enviando mensagem com contexto de memória');
            }
            
            const response = await fetch(`${getApiUrl('lateral')}/api/rota`, {
                method: 'POST',
                headers: getAuthHeaders(),
                credentials: 'include',
                body: JSON.stringify(requestBody)
            });
            
            if (!iaRespondendo) return;
            const data = await response.json();
            removeThinking();
            
            if (data.bot) {
                typeBotMessage(data.bot);
                currentChatMessages.push({ role: 'bot', text: data.bot, timestamp: new Date().toISOString() });
                
                // NOVO: Atualizar memória após receber resposta
                await atualizarMemoriaChat();
                
                saveCurrentChatToHistory();
            } else if (data.error) {
                addMessage('bot', `Erro: ${data.error}`);
                iaRespondendo = false;
                atualizarIconeEnvio();
            } else {
                addMessage('bot', 'Erro ao obter resposta da IA.');
                iaRespondendo = false;
                atualizarIconeEnvio();
            }
        } catch (err) {
            console.error('Erro no ChatGPT:', err);
            removeThinking();
            addMessage('bot', 'Erro de conexão com o servidor.');
            iaRespondendo = false;
            atualizarIconeEnvio();
        }
    }, tempoThinking);
}

// --- HISTÓRICO DE CHATS ---
// Carrega histórico de chats do backend
async function loadHistory() {
    try {
        const res = await fetch(`${getApiUrl('lateral')}/api/chats/${userId}`);

        if (!res.ok) {
            console.warn('Erro ao carregar histórico:', res.status);
            return [];
        }
        const chats = await res.json();
        console.log('📚 Chats carregados do servidor:', chats.length);
        
        // CORREÇÃO: Mapear corretamente os dados do MongoDB
        return chats.map(chat => ({
            id: chat._id,
            title: chat.prompt && chat.prompt.length > 40 ? 
                   chat.prompt.slice(0, 40) + '...' : 
                   (chat.prompt || 'Chat sem título'),
            messages: [
                { 
                    role: 'user', 
                    text: chat.prompt || 'Mensagem vazia', 
                    timestamp: chat.createdAt || new Date().toISOString() 
                },
                { 
                    role: 'bot', 
                    text: chat.response || 'Resposta vazia', 
                    timestamp: chat.createdAt || new Date().toISOString() 
                }
            ],
            updatedAt: chat.createdAt || new Date().toISOString()
        })).filter(chat => chat.messages[0].text !== 'Mensagem vazia'); // Remove chats inválidos
        
    } catch (error) {
        console.error('Erro ao carregar histórico:', error);
        return [];
    }
}

// Salva chat atual no histórico
async function saveCurrentChatToHistory() {
    if (!currentChatMessages || currentChatMessages.length < 2) return;
    const promptMsg = currentChatMessages.find(m => m.role === 'user');
    const responseMsg = currentChatMessages.find(m => m.role === 'bot');
    if (!promptMsg || !responseMsg) return;

    const currentUserId = getUserId();
    if (!currentUserId) {
        console.warn('saveCurrentChatToHistory: userId ausente no localStorage');
        return;
    }

    try {
        await fetch(`${getApiUrl('lateral')}/api/chats`, {
            method: 'POST',
            headers: getAuthHeaders(),
            credentials: 'include',
            body: JSON.stringify({
                userId: currentUserId,
                prompt: promptMsg.text,
                response: responseMsg.text,
                createdAt: new Date().toISOString()
            })
        });
    } catch (err) {
        console.warn('saveCurrentChatToHistory: falha ao salvar chat:', err);
    }
}

// Exclui chat do histórico
async function deleteChatFromHistory(chatId) {
    await fetch(`${getApiUrl('lateral')}/api/chats/${chatId}`, { method: 'DELETE' });
}

// Gera ID único para chat
function generateChatId() {
    return 'chat_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}

// Obtém título do chat
function getChatTitle(messages) {
    if (!messages || messages.length === 0) return 'Chat sem título';
    return messages[0].text.length > 40 ? messages[0].text.slice(0, 40) + '...' : messages[0].text;
}

// Inicia novo chat
// Inicia novo chat
async function startNewChat() {
    if (currentChatMessages.length > 0) {
        await saveCurrentChatToHistory();
    }
    currentChatId = generateChatId();
    currentChatMessages = [];
    primeiraResposta = true;
    
    // NOVO: Inicializar memória para novo chat
    currentChatMemory = null;
    console.log(`🧠 Novo chat iniciado: ${currentChatId}`);
    
    renderChatMessages();
    atualizarHintBubble();
}

// --- VALIDAÇÃO E FORMATAÇÃO DE MENSAGENS ---
// Captura conteúdo formatado para envio
function captureExactFormattedContent(documentContainer) {
    if (!documentContainer) return null;
    const clone = documentContainer.cloneNode(true);
    clone.querySelectorAll('.documento-gerado-actions').forEach(el => el.remove());
    clone.querySelectorAll('.code-copy-btn').forEach(el => el.remove());
    clone.querySelectorAll('button').forEach(el => el.remove());
    const allElements = clone.querySelectorAll('*');
    allElements.forEach(el => {
        const importantClasses = ['highlight', 'code-block', 'markdown', 'formatted-text'];
        const classList = Array.from(el.classList);
        const keepClasses = classList.filter(cls => importantClasses.some(imp => cls.includes(imp)));
        el.className = keepClasses.join(' ');
        if (el.tagName === 'PRE' || el.tagName === 'CODE') {
            el.style.cssText += '; font-family: monospace; background: #f4f4f4; padding: 8px; border-radius: 4px;';
        }
        if (el.tagName.match(/H[1-6]/)) {
            el.style.cssText += '; font-weight: bold; margin: 16px 0 8px 0;';
        }
        if (el.tagName === 'UL' || el.tagName === 'OL') {
            el.style.cssText += '; margin: 8px 0; padding-left: 24px;';
        }
        if (el.tagName === 'P') {
            el.style.cssText += '; margin: 8px 0; line-height: 1.5;';
        }
    });
    return clone.innerHTML;
}

// Valida e prepara mensagem para workspace
function validateAndPrepareMessage(messageData, index) {
  if (!messageData.text) {
    return null;
  }
  const originalText = messageData.text;
  let formattedText = '';
  if (messageData.role === 'bot') {
    const messageElement = document.querySelectorAll('.chatgpt-message-gpt')[index];
    if (messageElement) {
      formattedText = captureExactFormattedText(messageElement);
    }
    if (!formattedText && messageData.formattedText) {
      formattedText = messageData.formattedText;
    }
    if (!formattedText && originalText) {
      try {
        if (typeof marked !== 'undefined') {
          formattedText = marked.parse(originalText);
        } else {
          formattedText = originalText.replace(/\n/g, '<br>');
        }
      } catch (error) {
        formattedText = originalText.replace(/\n/g, '<br>');
      }
    }
    if (!formattedText || formattedText.trim() === '') {
      formattedText = `<div class="fallback-content">${escapeHtml(originalText)}</div>`;
    }
  } else {
    const messageElement = document.querySelectorAll('.chatgpt-message-gpt')[index];
    if (messageElement) {
      const capturedHTML = captureExactFormattedText(messageElement);
      if (capturedHTML && capturedHTML.trim() !== '') {
        formattedText = capturedHTML;
      } else {
        formattedText = `<p>${escapeHtml(originalText)}</p>`;
      }
    } else {
      formattedText = `<p>${escapeHtml(originalText)}</p>`;
    }
  }
  const validatedMessage = {
    text: originalText,
    formattedText: formattedText,
    role: messageData.role,
    createdAt: messageData.timestamp || new Date().toISOString()
  };
  return validatedMessage;
}

// --- ENVIO DE MENSAGENS PARA WORKSPACE ---
// Abre modal para enviar mensagens para workspace
async function openEnviarModal() {
    const modal = document.getElementById('chatgptEnviarModalGpt');
    const workspaceSelect = document.getElementById('workspaceSelectGpt');
    try {
        const response = await fetch(`${getApiUrl('socket')}/workspaces/${userId}`);
        if (!response.ok) throw new Error('Erro ao carregar workspaces');
        const workspaces = await response.json();
        workspaceSelect.innerHTML = '<option value="">Selecione uma workspace</option>';
        workspaces.forEach(workspace => {
            const option = document.createElement('option');
            option.value = workspace._id;
            option.textContent = workspace.title;
            workspaceSelect.appendChild(option);
        });
    } catch (error) {
        workspaceSelect.innerHTML = '<option value="">Erro ao carregar workspaces</option>';
    }
    modal.classList.remove('hidden');
}

// Envia mensagens selecionadas ou todo chat para workspace
async function enviarMensagensParaWorkspace() {
    const selectValue = document.getElementById('workspaceSelectGpt').value;
    const inputValue = document.getElementById('workspaceNomeInputGpt').value.trim();
    if (!selectValue && !inputValue) {
        alert('Selecione uma workspace ou digite um nome para nova workspace');
        return;
    }
    try {
        const mensagensSelecionadas = currentChatMessages.map((messageData, index) => {
            return validateAndPrepareMessage(messageData, index);
        }).filter(msg => msg !== null);

        let workspaceId = selectValue;
        if (!workspaceId && inputValue) {
            const createResponse = await fetch(`${getApiUrl('socket')}/workspaces`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    title: inputValue,
                    description: 'Criada a partir do ChatGPT',
                    messages: mensagensSelecionadas
                })
            });
            if (!createResponse.ok) {
                const errorText = await createResponse.text();
                throw new Error('Erro ao criar workspace: ' + errorText);
            }
            const result = await createResponse.json();
            alert(`Workspace "${inputValue}" criada com ${mensagensSelecionadas.length} mensagens!`);
        } else {
            const allResponse = await fetch(`/api/workspaces/${userId}`);
            if (!allResponse.ok) throw new Error('Erro ao buscar workspaces');
            const allWorkspaces = await allResponse.json();
            const workspace = allWorkspaces.find(w => w._id === workspaceId);
            if (!workspace) throw new Error('Workspace não encontrada');
            const novasMensagens = [...(workspace.messages || []), ...mensagensSelecionadas];
            const updateResponse = await fetch(`${getApiUrl('socket')}/workspaces/${workspaceId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: novasMensagens,
                    userId
                })
            });
            if (!updateResponse.ok) {
                const errorText = await updateResponse.text();
                throw new Error('Erro ao atualizar workspace: ' + errorText);
            }
            const result = await updateResponse.json();
            alert(`${mensagensSelecionadas.length} mensagens enviadas para "${workspace.title}"!`);
        }
        document.getElementById('chatgptEnviarModalGpt').classList.add('hidden');
        document.getElementById('workspaceNomeInputGpt').classList.add('hidden');
        document.getElementById('workspaceSelectGpt').value = '';
        document.getElementById('workspaceNomeInputGpt').value = '';
    } catch (error) {
        alert('Erro ao enviar mensagens: ' + error.message);
    }
}

// --- UTILITÁRIO PARA ESCAPAR HTML ---
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- SYNTAX HIGHLIGHTING ---
// Aplica destaque de sintaxe para blocos de código
function applySyntaxHighlighting(element) {
    const codeBlocks = element.querySelectorAll('pre code');
    codeBlocks.forEach((block, index) => {
        const text = block.textContent;
        const language = detectCodeLanguage(text);
        block.parentElement.setAttribute('data-lang', language.toUpperCase());
        if (language === 'html') {
            highlightHTML(block);
        } else if (language === 'css') {
            highlightCSS(block);
        } else if (language === 'javascript' || language === 'js') {
            highlightJavaScript(block);
        } else if (language === 'python') {
            highlightPython(block);
        }
        wrapCodeBlockWithCopyButton(block, index);
        if (text.split('\n').length > 5) {
            block.parentElement.classList.add('with-line-numbers');
        }
    });
}

// Detecta linguagem do código
function detectCodeLanguage(code) {
    const lowerCode = code.toLowerCase().trim();
    if (lowerCode.includes('<!doctype') || lowerCode.includes('<html') || 
        lowerCode.includes('<div') || lowerCode.includes('<span') ||
        lowerCode.includes('<body') || lowerCode.includes('<head')) {
        return 'html';
    }
    if (lowerCode.includes('function') || lowerCode.includes('const ') || 
        lowerCode.includes('let ') || lowerCode.includes('addEventListener') ||
        lowerCode.includes('document.') || lowerCode.includes('console.')) {
        return 'javascript';
    }
    if (lowerCode.includes('{') && (lowerCode.includes('color:') || 
        lowerCode.includes('background:') || lowerCode.includes('margin:') ||
        lowerCode.includes('padding:') || lowerCode.includes('display:'))) {
        return 'css';
    }
    if (lowerCode.includes('def ') || lowerCode.includes('import ') || 
        lowerCode.includes('print(') || lowerCode.includes('if __name__')) {
        return 'python';
    }
    return 'code';
}

// Aplica destaque para HTML
function highlightHTML(block) {
    let html = block.innerHTML;
    html = html.replace(/(&lt;\/?)([\w-]+)([^&gt;]*?)(&gt;)/g, 
        '<span class="html-tag">$1$2</span><span class="html-attr-name">$3</span><span class="html-tag">$4</span>');
    html = html.replace(/([\w-]+)(=)(&quot;[^&quot;]*&quot;)/g, 
        '<span class="html-attr-name">$1</span>$2<span class="html-attr-value">$3</span>');
    html = html.replace(/(&lt;!--.*?--&gt;)/g, 
        '<span class="html-comment">$1</span>');
    block.innerHTML = html;
}

// Aplica destaque para CSS
function highlightCSS(block) {
    let css = block.innerHTML;
    css = css.replace(/^(\s*)([\w\-\.#\[\]:,\s>+~*]+)(\s*{)/gm, 
        '$1<span class="css-selector">$2</span>$3');
    css = css.replace(/(\s+)([\w-]+)(\s*:)/g, 
        '$1<span class="css-property">$2</span>$3');
    css = css.replace(/(:\s*)([^;}]+)(;?)/g, 
        '$1<span class="css-value">$2</span>$3');
    css = css.replace(/(!important)/g, 
        '<span class="css-important">$1</span>');
    css = css.replace(/(\/\*.*?\*\/)/gs, 
        '<span class="css-comment">$1</span>');
    block.innerHTML = css;
}

// Aplica destaque para JavaScript
function highlightJavaScript(block) {
    let js = block.innerHTML;
    const keywords = ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'return', 'class', 'extends', 'import', 'export', 'async', 'await', 'try', 'catch'];
    keywords.forEach(keyword => {
        js = js.replace(new RegExp(`\\b(${keyword})\\b`, 'g'), 
            '<span class="js-keyword">$1</span>');
    });
    js = js.replace(/(["'`])((?:(?!\1)[^\\]|\\.)*)(\1)/g, 
        '<span class="js-string">$1$2$3</span>');
    js = js.replace(/\b(\d+\.?\d*)\b/g, 
        '<span class="js-number">$1</span>');
    js = js.replace(/(\w+)(\s*)(\()/g, 
        '<span class="js-function">$1</span>$2$3');
    js = js.replace(/(\/\/.*$)/gm, 
        '<span class="js-comment">$1</span>');
    js = js.replace(/(\/\*.*?\*\/)/gs, 
        '<span class="js-comment">$1</span>');
    block.innerHTML = js;
}

// Aplica destaque para Python
function highlightPython(block) {
    let python = block.innerHTML;
    const keywords = ['def', 'class', 'if', 'else', 'elif', 'for', 'while', 'return', 'import', 'from', 'try', 'except', 'with', 'as', 'pass', 'break', 'continue'];
    keywords.forEach(keyword => {
        python = python.replace(new RegExp(`\\b(${keyword})\\b`, 'g'), 
            '<span class="python-keyword">$1</span>');
    });
    python = python.replace(/(["'])((?:(?!\1)[^\\]|\\.)*)(\1)/g, 
        '<span class="python-string">$1$2$3</span>');
    python = python.replace(/(#.*$)/gm, 
        '<span class="python-comment">$1</span>');
    python = python.replace(/(@\w+)/g, 
        '<span class="python-decorator">$1</span>');
    block.innerHTML = python;
}

// Adiciona botão copiar ao bloco de código
function wrapCodeBlockWithCopyButton(codeBlock, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.textContent = 'Copiar';
    copyBtn.setAttribute('data-code-index', index);
    const preElement = codeBlock.parentElement;
    preElement.parentNode.insertBefore(wrapper, preElement);
    wrapper.appendChild(preElement);
    wrapper.appendChild(copyBtn);
    copyBtn.addEventListener('click', () => {
        const text = codeBlock.textContent;
        navigator.clipboard.writeText(text).then(() => {
            copyBtn.textContent = 'Copiado';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.textContent = 'Copiar';
                copyBtn.classList.remove('copied');
            }, 2000);
        });
    });
}

// Adiciona mensagem ao chat
function addMessage(role, text) {
    if (!text.trim()) return;
    const now = new Date().toISOString();
    currentChatMessages.push({ role, text, timestamp: now });
    renderChatMessages();
}

// --- MODAL DE HISTÓRICO DE CHATS ---
// Abre modal de histórico
async function openHistoricoModal() {
    historicoModal.classList.remove('hidden');
    searchInput.value = '';
    await renderHistoricoList('');
    atualizarHintBubble(); // Faz a nuvem sumir ao abrir histórico
}
// Fecha modal de histórico
function closeHistoricoModal() {
    historicoModal.classList.add('hidden');
}

// Renderiza lista de histórico de chats
async function renderHistoricoList(filter) {
    let history = await loadHistory();
    filter = filter.trim().toLowerCase();
    let filtered = history.filter(chat => {
        if (!filter) return true;
        const inTitle = chat.title && chat.title.toLowerCase().includes(filter);
        const inMessages = chat.messages.some(m => m.text.toLowerCase().includes(filter));
        return inTitle || inMessages;
    });

    filtered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    historicoList.innerHTML = '';
    if (filtered.length === 0) {
        historicoEmpty.classList.remove('hidden');
        return;
    } else {
        historicoEmpty.classList.add('hidden');
    }

    filtered.forEach(chat => {
        const item = document.createElement('div');
        item.className = 'chatgpt-historico-item-gpt';
        item.innerHTML = `
            <span>
                <span class="chatgpt-historico-title-gpt">${chat.title}</span>
                <span class="chatgpt-historico-date-gpt">${formatDate(chat.updatedAt)}</span>
            </span>
            <button class="chatgpt-historico-delete-gpt" title="Excluir">&times;</button>
        `;
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('chatgpt-historico-delete-gpt')) return;
            openChatFromHistory(chat.id, chat.messages);
            closeHistoricoModal();
        });
        item.querySelector('.chatgpt-historico-delete-gpt').addEventListener('click', async (e) => {
            e.stopPropagation();
            showConfirmDelete(chat.id, async () => {
                await deleteChatFromHistory(chat.id);
                await renderHistoricoList(searchInput.value);
            });
        });
        historicoList.appendChild(item);
    });
}

// Mostra popup de confirmação para excluir histórico
function showConfirmDelete(chatId, onConfirm) {
    let popup = document.createElement('div');
    popup.style.position = 'fixed';
    popup.style.top = '0';
    popup.style.left = '0';
    popup.style.width = '100vw';
    popup.style.height = '100vh';
    popup.style.background = 'rgba(0,0,0,0.25)';
    popup.style.display = 'flex';
    popup.style.alignItems = 'center';
    popup.style.justifyContent = 'center';
    popup.style.zIndex = '2000';

    popup.innerHTML = `
        <div style="
            background: #fff;
            padding: 32px 24px;
            border-radius: 12px;
            box-shadow: 0 4px 24px rgba(25,118,210,0.10);
            text-align: center;
            min-width: 320px;
        ">
            <h3 style="color:#e53935;margin-bottom:16px;">Confirmar exclusão</h3>
            <p style="margin-bottom:24px;">Tem certeza que deseja excluir este histórico de chat?</p>
            <div style="display:flex;gap:16px;justify-content:center;">
                <button id="confirmDeleteBtn" style="
                    background:#e53935;color:#fff;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-weight:500;
                ">Excluir</button>
                <button id="cancelDeleteBtn" style="
                    background:#f7f7f7;color:#555;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-weight:500;
                ">Cancelar</button>
            </div>
        </div>
    `;

    document.body.appendChild(popup);

    popup.querySelector('#confirmDeleteBtn').onclick = function() {
        document.body.removeChild(popup);
        if (typeof onConfirm === 'function') onConfirm();
    };
    popup.querySelector('#cancelDeleteBtn').onclick = function() {
        document.body.removeChild(popup);
    };
}

// Abre chat do histórico
async function openChatFromHistory(chatId, messages) {
    currentChatId = chatId;
    currentChatMessages = [...messages];
    
    // NOVO: Carregar/criar memória para este chat
    if (!chatMemories[chatId]) {
        console.log(`🧠 Criando nova memória para chat histórico: ${chatId}`);
        await atualizarMemoriaChat();
    } else {
        currentChatMemory = chatMemories[chatId];
        console.log(`🧠 Memória carregada para chat: ${chatId}`);
    }
    
    renderChatMessages();
}


// Formata data para exibição
function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function limparMemoriasAntigas() {
    const limite = 10; // Manter apenas 10 chats em memória
    const chatsOrdenados = Object.keys(chatMemories).sort((a, b) => {
        const memoriaA = chatMemories[a];
        const memoriaB = chatMemories[b];
        // Assume que chats mais recentes têm IDs maiores
        return b.localeCompare(a);
    });
    
    if (chatsOrdenados.length > limite) {
        const chatsParaRemover = chatsOrdenados.slice(limite);
        chatsParaRemover.forEach(chatId => {
            if (chatId !== currentChatId) {
                delete chatMemories[chatId];
            }
        });
        console.log(`🧠 Limpeza: ${chatsParaRemover.length} memórias antigas removidas`);
    }
}

// Chamar limpeza periodicamente
setInterval(limparMemoriasAntigas, 300000); // A cada 5 minutos



// --- EVENTOS PRINCIPAIS DA INTERFACE ---
// Botões de novo chat, histórico, fechar histórico, busca no histórico
btnNovoChat.addEventListener('click', startNewChat);
btnHistoricoChat.addEventListener('click', openHistoricoModal);


if (btnSelecionarMensagens) {
    btnSelecionarMensagens.onclick = openModalOpcoesSelecao;
}
btnFecharHistorico.addEventListener('click', closeHistoricoModal);
searchInput.addEventListener('input', async (e) => {
    await renderHistoricoList(e.target.value);
});

// Eventos para modal de enviar mensagens para workspace
document.addEventListener('click', (e) => {
    if (e.target.matches('#btnEnviarMensagensFixGpt')) {
        openEnviarModal();
    }
    if (e.target.matches('#btnCriarWorkspaceGpt')) {
        const input = document.getElementById('workspaceNomeInputGpt');
        input.classList.toggle('hidden');
        if (!input.classList.contains('hidden')) {
            input.focus();
        }
    }
    if (e.target.matches('#btnEnviarMensagensGpt')) {
        enviarMensagensParaWorkspace();
    }
    if (e.target.matches('#btnFecharEnviarModalGpt')) {
        document.getElementById('chatgptEnviarModalGpt').classList.add('hidden');
    }
});

// Habilita botão de envio quando workspace é selecionada ou nome digitado
document.addEventListener('change', (e) => {
    if (e.target.matches('#workspaceSelectGpt') || e.target.matches('#workspaceNomeInputGpt')) {
        const selectValue = document.getElementById('workspaceSelectGpt').value;
        const inputValue = document.getElementById('workspaceNomeInputGpt').value.trim();
        const btnEnviar = document.getElementById('btnEnviarMensagensGpt');
        btnEnviar.disabled = !selectValue && !inputValue;
    }
});

// --- SELEÇÃO DE IA VIA MODAL ---
function atualizarIAUI() {
    const nomes = {
        'openai': 'ChatGPT',
        'claude': 'Claude',
        'gemini': 'Gemini',
        'deepseek': 'DeepSeek'
    };
    const ia = getIAAtual();

    // atualiza todos os elementos marcados (badge/header)
    document.querySelectorAll('[data-ia-current]').forEach(el => {
        el.textContent = nomes[ia] || ia;
    });
    const legacy = document.getElementById('iaAtual');
    if (legacy) legacy.textContent = nomes[ia] || ia;

    // remove classes "ativa" residuais em todo o documento (defensivo)
    document.querySelectorAll('.ia-item.ativa').forEach(el => el.classList.remove('ativa'));

    const modal = document.getElementById('iaModal');
    if (!modal) return;

    // primeiro limpa estados em massa
    modal.querySelectorAll('.ia-item').forEach(it => {
        it.classList.remove('ia-selected', 'ativa');
        it.style.border = '';
        it.style.background = '';
    });
    modal.querySelectorAll('.ia-btn').forEach(b => {
        b.classList.remove('selected');
        b.disabled = false;
        b.setAttribute('aria-pressed', 'false');
        b.textContent = 'Usar';
    });

    // aplica estado apenas ao item/botão correspondente à IA atual
    const activeItem = modal.querySelector(`.ia-item[data-ia="${ia}"]`);
    if (activeItem) {
        activeItem.classList.add('ia-selected', 'ativa');
        activeItem.style.border = '1px solid #1976d2';
        activeItem.style.background = 'rgba(25,118,210,0.04)';
        const btn = activeItem.querySelector('.ia-btn[data-ia]') || activeItem.querySelector('.ia-btn');
        if (btn) {
            btn.classList.add('selected');
            btn.disabled = true;
            btn.setAttribute('aria-pressed', 'true');
            btn.textContent = 'Em uso';
        }
    }

    // garantia extra: atualiza quaisquer botões espalhados com data-ia
    modal.querySelectorAll('.ia-btn[data-ia]').forEach(btn => {
        const key = btn.dataset.ia;
        const isSel = String(key) === String(ia);
        btn.disabled = !!isSel;
        btn.setAttribute('aria-pressed', isSel ? 'true' : 'false');
        btn.classList.toggle('selected', !!isSel);
        btn.textContent = isSel ? 'Em uso' : 'Usar';
        const container = modal.querySelector(`.ia-item[data-ia="${key}"]`);
        if (container) container.classList.toggle('ia-selected', !!isSel);
    });
}

// substituir selecionarIA / abrirModalIA para sempre sincronizar a UI
function selecionarIA(iaKey, iaLabel) {
    console.log('selecionarIA ->', iaKey, iaLabel);
    window.iaAtual = iaKey;
    try { localStorage.setItem('iaAtual', iaKey); } catch(e){ /* noop */ }
    // Atualiza badge global e modal
    if (typeof atualizarIAUI === 'function') {
        atualizarIAUI();
    } else {
        console.warn('atualizarIAUI não encontrada');
    }
    // opcional: dispara evento custom para outros módulos ouvirem mudança
    document.dispatchEvent(new CustomEvent('iaChanged', { detail: { ia: iaKey } }));
    // fecha modal se existir
    try { fecharModalIA(); } catch(e) {}
}

// garante sincronização inicial quando o script carregar
(function initIAState() {
    getIAAtual();
    if (typeof atualizarIAUI === 'function') {
        // run async to wait DOM
        setTimeout(() => atualizarIAUI(), 20);
    }
})();

function abrirModalIA() {
    const modal = document.getElementById('iaModal');
    if (!modal) return;
    modal.style.display = 'flex';
    // garante que o estado atual esteja refletido ao abrir
    atualizarIAUI();
}

function fecharModalIA() {
    const modal = document.getElementById('iaModal');
    if (!modal) return;
    modal.style.display = 'none';
}
// centraliza obtenção/definição da IA atual e garante persistência + logs
function getIAAtual() {
    // prefer window.iaAtual se já setado em runtime, senão localStorage, senão 'openai'
    const ia = window.iaAtual || localStorage.getItem('iaAtual') || 'openai';
    window.iaAtual = ia;
    return ia;
}

// --- ENVIO DE MENSAGEM COM EFEITO "PENSANDO" E MÁQUINA DE ESCREVER ---
// Efeito visual de "pensando" e digitação da resposta da IA
const chatgptForm = document.getElementById('chatgptFormGpt');
const chatgptInput = document.getElementById('chatgptInputGpt');
let timeoutTyping;

// ...ADICIONE AQUI: referências e estado para "Aprimorar Prompt"...
const btnAprimorar = document.getElementById('btnAprimorarPrompt');
const aprimorarWarning = document.getElementById('aprimorarWarning');
const refinedPreview = document.getElementById('refinedPreview');
const refinedText = document.getElementById('refinedText');
const btnAcceptRefined = document.getElementById('btnAcceptRefined');
const btnCancelRefined = document.getElementById('btnCancelRefined');

let originalPromptBeforeRefine = '';
let latestRefinedPrompt = '';



function showThinking() {
    const messagesDiv = document.getElementById('chatgptMessagesGpt');
    if (!messagesDiv) return;
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'chatgpt-message-gpt bot thinking';
    thinkingDiv.innerHTML = `
        <div class="thinking-animation">
            <span class="thinking-text">Trabalhando</span>
            <span class="dots">
                <span class="dot">.</span>
                <span class="dot">.</span>
                <span class="dot">.</span>
            </span>
        </div>
    `;
    thinkingDiv.id = 'thinking-message';
    messagesDiv.appendChild(thinkingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    setTimeout(() => {
        const existingThinking = document.getElementById('thinking-message');
        if (existingThinking) {
            existingThinking.innerHTML = `
                <div class="thinking-animation">
                    <span class="thinking-text">Trabalhando</span>
                    <span class="dots">
                        <span class="dot">.</span>
                        <span class="dot">.</span>
                        <span class="dot">.</span>
                    </span>
                </div>
                <div class="organizing-animation">
                    <svg class="arrow-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span class="organizing-text">Organizando as informações</span>
                    <span class="dots organizing-dots">
                        <span class="dot">.</span>
                        <span class="dot">.</span>
                        <span class="dot">.</span>
                    </span>
                </div>
            `;
        }
    }, 2000);
}

function removeThinking() {
    const thinkingDiv = document.getElementById('thinking-message');
    if (thinkingDiv && thinkingDiv.parentNode) {
        thinkingDiv.parentNode.removeChild(thinkingDiv);
    }
}

// Efeito de digitação da resposta da IA
function typeBotMessage(text) {
    const messagesDiv = document.getElementById('chatgptMessagesGpt');
    if (!messagesDiv) return;
    const div = document.createElement('div');
    div.className = 'chatgpt-message-gpt bot';
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    let i = 0;
    function type() {
        if (i <= text.length) {
            const currentText = text.slice(0, i);
            div.innerHTML = typeof marked !== 'undefined' ? marked.parse(currentText) : currentText;
            if (i === text.length) {
                applySyntaxHighlighting(div);
            }
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
            i++;
            timeoutTyping = setTimeout(type, 18);
        } else {
            iaRespondendo = false;
            atualizarIconeEnvio();
        }
    }
    type();
}

// Atualiza ícone do botão de envio
function atualizarIconeEnvio() {
    const sendButton = document.querySelector('#chatgptFormGpt button[type="submit"]') || 
                      document.querySelector('#chatgptFormGpt button');
    if (!sendButton) return;
    if (iaRespondendo) {
        sendButton.innerHTML = '⏹️';
        sendButton.title = 'Parar resposta da IA';
    } else {
        sendButton.innerHTML = '➤';
        sendButton.title = 'Enviar mensagem';
    }
}

// Para resposta da IA
function pararIA() {
    if (timeoutTyping) {
        clearTimeout(timeoutTyping);
        timeoutTyping = null;
    }
    removeThinking();
    iaRespondendo = false;
    atualizarIconeEnvio();
}

// Evento de envio de mensagem no formulário
if (chatgptForm && chatgptInput) {
  chatgptForm.onsubmit = async function(e) {
    e.preventDefault();
    if (iaRespondendo) { pararIA(); return; }
    const msg = chatgptInput.value.trim();
    if (!msg) return;

    if (currentChatMessages.length === 0 && msg.length > 10) {
      // Aguardar decisão do backend (async)
      const result = await chooseToolForPrompt(msg);
      const sugestaoBest = result.best;
      const motivo = result.reason || '';
      const iaAtual = getIAAtual();

      if (iaAtual === sugestaoBest) {
        mostrarPopupSugestaoIA(iaAtual, sugestaoBest, `Você já está usando a IA mais indicada. ${motivo}`, null, () => enviarMensagemParaIA(msg, iaAtual));
        return;
      } else {
        mostrarPopupSugestaoIA(
          iaAtual,
          sugestaoBest,
          `Recomendamos ${ { openai:'ChatGPT', claude:'Claude', gemini:'Gemini', deepseek:'DeepSeek' }[sugestaoBest] || sugestaoBest }. ${motivo}`,
          () => enviarMensagemParaIA(msg, sugestaoBest),
          () => enviarMensagemParaIA(msg, iaAtual)
        );
        return;
      }
    }

    enviarMensagemParaIA(msg, getIAAtual());
  };
}

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

if (chatgptInput) {
  chatgptInput.addEventListener('input', () => {
    const words = countWords(chatgptInput.value || '');
    if (btnAprimorar) {
      const wasDisabled = btnAprimorar.disabled;
      if (words >= 6) {
        btnAprimorar.disabled = false;
        // se acabou de ser habilitado, adiciona efeito de tremedeira por 2s
        if (wasDisabled) {
          btnAprimorar.classList.add('shake');
          setTimeout(() => {
            btnAprimorar.classList.remove('shake');
          }, 2800);
        }
        if (aprimorarWarning) aprimorarWarning.style.display = 'none';
      } else {
        btnAprimorar.disabled = true;
        if (aprimorarWarning) {
          aprimorarWarning.style.display = chatgptInput.value.trim().length > 0 ? 'inline' : 'none';
        }
      }
    }
  });
}

// Clique em "Aprimorar Prompt"
if (btnAprimorar) {

  // Abre modal de seleção de nível
  function openRefineLevelModal(originalPrompt) {
    const overlay = document.getElementById('refineLevelModalOverlay');
    const pre = document.getElementById('refineOriginalPrompt');
    const confirmBtn = document.getElementById('refineLevelConfirm');
    if (!overlay || !pre || !confirmBtn) return;
    pre.textContent = originalPrompt || '';
    // reset options
    document.querySelectorAll('.refine-level-option').forEach(el => {
      el.setAttribute('aria-checked', 'false');
    });
    confirmBtn.disabled = true;
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  // Fecha modal
  function closeRefineLevelModal() {
    const overlay = document.getElementById('refineLevelModalOverlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  // Seleção dos níveis (delegation)
  document.addEventListener('click', function (e) {
    const opt = e.target.closest('.refine-level-option');
    if (!opt) return;
    const overlay = document.getElementById('refineLevelModalOverlay');
    if (!overlay || overlay.style.display === 'none') return;
    // marcar opção
    document.querySelectorAll('.refine-level-option').forEach(el => {
      el.setAttribute('aria-checked', 'false');
    });
    opt.setAttribute('aria-checked', 'true');
    const confirmBtn = document.getElementById('refineLevelConfirm');
    if (confirmBtn) confirmBtn.disabled = false;
  });

  // fechar/cancelar
  const closeBtn = document.getElementById('refineLevelClose');
  if (closeBtn) closeBtn.addEventListener('click', closeRefineLevelModal);
  const cancelBtn = document.getElementById('refineLevelCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeRefineLevelModal);

  // confirmar => envia ao servidor com nível selecionado
  const confirmBtnMain = document.getElementById('refineLevelConfirm');
  if (confirmBtnMain) {
    confirmBtnMain.addEventListener('click', async function () {
      const overlay = document.getElementById('refineLevelModalOverlay');
      if (!overlay) return;
      const selected = document.querySelector('.refine-level-option[aria-checked="true"]');
      if (!selected) return;
      const level = selected.dataset.level || '2';
      // pega prompt atual
      const prompt = (chatgptInput.value || '').trim();
      if (!prompt) { closeRefineLevelModal(); return; }

      // feedback UI
      confirmBtnMain.disabled = true;
      confirmBtnMain.textContent = 'Aprimando...';

      try {
        // escolhe IA (mesma lógica existente)
        const iaAtualElem = document.getElementById('iaAtualModal');
        const selectedIA = iaAtualElem ? (iaAtualElem.dataset.iaCurrent || getIAAtual()) : getIAAtual();

        const resp = await fetch(`${getApiUrl('lateral')}/api/refine-prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, modeloIA: selectedIA, level: Number(level) })
        });

        if (!resp.ok) throw new Error('Falha ao refinar prompt');

        const data = await resp.json();
        latestRefinedPrompt = (data.refinedPrompt || '').trim();

        if (!latestRefinedPrompt) {
          alert('Não foi possível aprimorar o prompt. Você pode enviar o original.');
          return;
        }

        // fecha modal de nível e abre modal de revisão existente
        closeRefineLevelModal();
        showRefinedModal(latestRefinedPrompt);

      } catch (err) {
        console.error('Erro ao refinar prompt:', err);
        alert('Erro ao aprimorar prompt. Tente novamente.');
      } finally {
        confirmBtnMain.disabled = false;
        confirmBtnMain.textContent = 'Confirmar e Aprimorar';
      }
    });
  }

  // Intercepta clique original do botão para abrir modal (mantém validação de palavras)
  btnAprimorar.addEventListener('click', function (e) {
    const prompt = (chatgptInput.value || '').trim();
    if (!prompt || countWords(prompt) < 6) return;
    openRefineLevelModal(prompt);
  });
}

// Aceitar prompt refinado e enviar
if (btnAcceptRefined) {
  btnAcceptRefined.removeEventListener?.('click', undefined);
  btnAcceptRefined.addEventListener('click', () => {
    if (!latestRefinedPrompt) return;

    // fecha modal antes de submeter
    hideRefinedModal();

    // coloca o prompt refinado no input principal
    if (chatgptInput) {
      chatgptInput.value = latestRefinedPrompt;
    }

    // aplica seleção de IA feita no modal (se existir)
    const iaAtualElem = document.getElementById('iaAtualModal');
    if (iaAtualElem && iaAtualElem.dataset.iaCurrent) {
      try { 
        window.iaAtual = iaAtualElem.dataset.iaCurrent; 
        localStorage.setItem('iaAtual', window.iaAtual);
      } catch(e){}
      if (typeof atualizarIAUI === 'function') atualizarIAUI();
    }

    // dispara o submit do formulário (usa a mesma lógica do chatgptForm.onsubmit)
    if (typeof chatgptForm?.requestSubmit === 'function') {
      chatgptForm.requestSubmit();
    } else if (chatgptForm) {
      chatgptForm.submit();
    } else {
      // fallback seguro: envia diretamente caso formulário não exista
      enviarMensagemParaIA(latestRefinedPrompt, getIAAtual());
    }

    // limpa estado local
    latestRefinedPrompt = '';
    originalPromptBeforeRefine = '';
  });
}

// CONTROLE DO MODAL DE REFINAMENTO
// Controle do modal de revisão com edição inline
function placeCaretAtEnd(el) {
  el.focus();
  if (typeof window.getSelection !== "undefined"
    && typeof document.createRange !== "undefined") {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function showRefinedModal(text) {
  const overlay = document.getElementById('refinedModalOverlay');
  const contentEl = document.getElementById('refinedText');
  const acceptBtn = document.getElementById('btnAcceptRefined');
  if (!overlay || !contentEl) return;
  contentEl.textContent = text || '';
  contentEl.setAttribute('contenteditable', 'true');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.style.display = 'flex';
  document.body.classList.add('modal-open');
  // posiciona cursor no final
  setTimeout(() => placeCaretAtEnd(contentEl), 40);

  // atalhos: Ctrl/Cmd+Enter = aceitar, Esc = cancelar
  contentEl._refinedKeyHandler = function (e) {
    const isCmdEnter = (e.key === 'Enter' && (e.ctrlKey || e.metaKey));
    if (isCmdEnter) {
      e.preventDefault();
      document.getElementById('btnAcceptRefined')?.click();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideRefinedModal();
      return;
    }
  };
  contentEl.addEventListener('keydown', contentEl._refinedKeyHandler);
}

function hideRefinedModal() {
  const overlay = document.getElementById('refinedModalOverlay');
  const contentEl = document.getElementById('refinedText');
  if (!overlay) return;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.display = 'none';
  document.body.classList.remove('modal-open');
  if (contentEl) {
    // remove handler de atalhos
    if (contentEl._refinedKeyHandler) {
      contentEl.removeEventListener('keydown', contentEl._refinedKeyHandler);
      delete contentEl._refinedKeyHandler;
    }
    // opcional: limpar seleção para evitar edição residual
    try { window.getSelection()?.removeAllRanges(); } catch(e){}
  }
}

// cancelar botão também fecha modal (mantém comportamento)
const cancelBtn = document.getElementById('btnCancelRefined');
if (cancelBtn) {
  cancelBtn.removeEventListener?.('click', undefined);
  cancelBtn.addEventListener('click', hideRefinedModal);
}


// --- INICIALIZAÇÃO DO CHAT E ESTILOS DINÂMICOS ---
document.addEventListener('DOMContentLoaded', function() {
    // Inicialização do chat
    initChatGpt();

    initAIToolsFromEmbedded(); 

    // Estilos dinâmicos
    const style = document.createElement('style');
    style.textContent = `
        .chatgpt-btn.active { background-color: #1976d2; color: white; }
        .chatgpt-message-gpt.selectable { cursor: pointer; border-left: 4px solid #1976d2; transition: background 0.2s; }
        .chatgpt-message-gpt.selected { background: #e3f2fd; }
        .modal-infos-gpt {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.25);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 3000;
        }
        .modal-infos-gpt .modal-content {
            background: #fff;
            padding: 32px 24px;
            border-radius: 12px;
            box-shadow: 0 4px 24px rgba(25,118,210,0.10);
            min-width: 340px;
        }
        .modal-infos-gpt label {
            display: block;
            margin-bottom: 12px;
        }
        .modal-infos-gpt input, .modal-infos-gpt select, .modal-infos-gpt textarea {
            width: 100%;
            margin-top: 4px;
            margin-bottom: 8px;
            padding: 6px;
            border-radius: 4px;
            border: 1px solid #ddd;
        }
        .modal-infos-gpt .modal-actions {
            display: flex;
            gap: 12px;
            margin-top: 12px;
        }
        .modal-infos-gpt button {
            padding: 8px 18px;
            border-radius: 6px;
            border: none;
            background: #1976d2;
            color: #fff;
            font-weight: 500;
            cursor: pointer;
        }
        .modal-infos-gpt button#btnCancelarModalGpt {
            background: #f7f7f7;
            color: #555;
        }
        .modal-infos-gpt #modalDocumentoGpt {
            margin-top: 18px;
            background: #f5f5f5;
            padding: 12px;
            border-radius: 8px;
        }
    `;
    document.head.appendChild(style);

    // Sidebar toggle
    const chatgptSidebar = document.getElementById('chatgptSidebarGpt');
    const toggleBtn = document.getElementById('toggleChatgptSidebarGpt');
    if (chatgptSidebar && toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            chatgptSidebar.classList.toggle('collapsed');
        });
    }

    // IA atual
    const nomes = {
        'openai': 'ChatGPT',
        'claude': 'Claude',
        'gemini': 'Você esta usando: Gemini',
        'deepseek': 'Você esta usando: DeepSeek'
    };
    const iaAtual = window.iaAtual || 'openai';
    const iaAtualElement = document.getElementById('iaAtual');
    if (iaAtualElement) {
        iaAtualElement.textContent = nomes[iaAtual];
    }

    // Botão Documentos Recebidos
    const btnDocumentosRecebidosGpt = document.getElementById('btnDocumentosRecebidosGpt');
    if (btnDocumentosRecebidosGpt) {
        btnDocumentosRecebidosGpt.onclick = openPaginaDocumentosRecebidos;
    }

    // Botão Selecionar Mensagens
    const btnSelecionarMensagens = document.getElementById('btnSelecionarMensagensGpt');
    if (btnSelecionarMensagens) {
        btnSelecionarMensagens.onclick = openModalOpcoesSelecao;
    }

    // Botão Compartilhar Mensagens
    const btnCompartilhar = document.getElementById('btnCompartilharMensagensGpt');
    if (btnCompartilhar) {
        btnCompartilhar.onclick = openModalInfos;
    }

    atualizarHintBubble();
    const input = document.getElementById('chatgptInputGpt');
if (input) {
    input.addEventListener('input', atualizarHintBubble);
}
});

// --- FUNÇÃO PARA ATUALIZAR A NUVEM DE ORIENTAÇÃO ---
function atualizarHintBubble() {
    const hint = document.getElementById('chatgptHintBubble');
    const input = document.getElementById('chatgptInputGpt');
    if (!hint || !input) return;
    // Some também se histórico ou seleção de mensagens estiverem abertos
    const historicoAberto = !document.getElementById('chatgptHistoricoModalGpt')?.classList?.contains('hidden');
    if (
        currentChatMessages.length === 0 &&
        input.value.trim() === '' &&
        !isSelectionMode &&
        !historicoAberto
    ) {
        hint.style.display = 'flex';
        hint.style.opacity = '1';
    } else {
        hint.style.opacity = '0';
        setTimeout(() => { hint.style.display = 'none'; }, 300);
    }
}

// Inicializa chat ao carregar página
function initChatGpt() {
    if (!currentChatId) {
        startNewChat();
    }
    renderChatMessages();
}

// --- SALVAR DOCUMENTO NO BACKEND ---
// Salva documento gerado no backend
async function salvarDocumentoNoBackend(htmlDocumento) {
    const infos = {
        titulo: 'Documento Gerado',
        objetivo: 'Outro',
        prazo: '',
        observacoes: ''
    };
    const mensagens = [];
    await fetch(`${getApiUrl('colaborativo')}/api/documento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ infos, mensagens, documento: htmlDocumento })
    });
}

// --- MOSTRAR DOCUMENTO GERADO E SALVAR ---
// Exibe documento gerado e permite salvar no backend
// ...existing code...
function mostrarDocumentoGeradoComSalvar(textoDocumento, docId = null, comentarios = [], infos = {}, mensagens = []) {
    console.log('=== DEBUG mostrarDocumentoGeradoComSalvar ===');
    console.log('infos recebidos:', infos);
    
    const container = document.getElementById('documentoGeradoContainerGpt');
    const content = document.getElementById('documentoGeradoContentGpt');
    if (!container || !content) return;

    // CORREÇÃO: Usa dados REAIS do formulário (infos)
    const documentData = {
        title: infos.titulo || 'Documento sem título',
        preview: `📄 ${infos.titulo || 'Documento'} - ${infos.objetivo || 'Sem objetivo'} | Prazo: ${infos.prazo || 'Não definido'}`,
        content: {
            titulo: infos.titulo || 'Documento sem título',
            objetivo: infos.objetivo || 'Não especificado',  // <-- USA infos.objetivo
            prazo: infos.prazo || 'Não definido',            // <-- USA infos.prazo  
            observacoes: infos.observacoes || '',            // <-- USA infos.observacoes
            documento: textoDocumento,
            formatType: 'html'
        },
        createdAt: new Date().toISOString()
    };
    
    console.log('=== documentData montado ===');
    console.log('documentData.content:', documentData.content);
    
    // SALVA GLOBALMENTE para usar no compartilhamento
    window.currentDocumentData = documentData;

    // Renderiza o documento (mantém seu HTML)
    let htmlDocumento = textoDocumento;
    if (typeof marked !== 'undefined' && typeof textoDocumento === 'string' && !textoDocumento.includes('<')) {
        htmlDocumento = marked.parse(textoDocumento);
    }
    content.innerHTML = htmlDocumento;
    container.classList.remove('hidden');

    // Renderiza os comentários salvos
    comentarioData = {};
    if (Array.isArray(comentarios)) {
        comentarios.forEach(c => {
            const spans = Array.from(content.querySelectorAll('span')).filter(s => s.textContent === c.text);
            let span;
            if (spans.length > 0) {
                span = spans[0];
            } else {
                span = document.createElement('span');
                span.textContent = c.text;
                content.appendChild(span);
            }
            span.className = 'trecho-comentado-gpt';
            span.id = c.id;
            span.style.fontWeight = 'bold';
            span.style.background = '#1565c0';
            span.style.color = '#fff';
            span.style.cursor = 'pointer';
            comentarioData[c.id] = { text: c.text, comment: c.comment };
        });
    }

    // BOTÃO CANCELAR COM CONFIRMAÇÃO
    document.getElementById('btnCancelarDocumentoGeradoGpt').onclick = () => {
        if (confirm('Tem certeza que deseja cancelar? O documento não será salvo.')) {
            container.classList.add('hidden');
        }
    };

    // BOTÃO SALVAR COM VALIDAÇÃO DE TÍTULO
    document.getElementById('btnSalvarDocumentoGeradoGpt').onclick = async () => {
        // Usa o título do objeto infos
        const titulo = infos.titulo || '';
        
        if (!titulo) {
            alert('Por favor, preencha o título do documento antes de salvar.');
            return;
        }

        const documentoView = content;
        const htmlFormatado = captureExactFormattedContent(documentoView);
        const comentarios = Object.entries(comentarioData).map(([id, obj]) => ({
            id,
            text: obj.text,
            comment: obj.comment
        }));
        
        if (docId) {
            await atualizarDocumentoNoBackend(docId, htmlFormatado || htmlDocumento, comentarios, titulo);
        } else {
            await salvarDocumentoNoBackendComFormatacao(htmlFormatado || htmlDocumento, comentarios, titulo);
        }
        container.classList.add('hidden');
        openPaginaDocumentos();
    };
}

// Função para atualizar documento existente
async function atualizarDocumentoNoBackend(docId, htmlDocumento, comentarios) {
    const infos = {
        titulo: 'Documento Gerado',
        objetivo: 'Outro',
        prazo: '',
        observacoes: ''
    };
    try {
        await fetch(`${getApiUrl('colaborativo')}/api/documento/${docId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                infos, 
                mensagens: [], 
                documento: htmlDocumento,
                comentarios, // <-- Envia os comentários
                formatType: 'html'
            })
        });
    } catch (error) {
        console.error('Erro ao atualizar documento:', error);
    }
}



// Salvar documento novo
// ...existing code...
async function salvarDocumentoNoBackendComFormatacao(htmlDocumento, comentarios, titulo) {
    const infos = {
        titulo: titulo || 'Documento Gerado',
        objetivo: 'Outro',
        prazo: '',
        observacoes: ''
    };
    try {
        await fetch(`${getApiUrl('colaborativo')}/api/documento`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                infos, 
                mensagens: [], 
                documento: htmlDocumento,
                comentarios,
                formatType: 'html'
            })
        });
        alert('Documento salvo com sucesso!');
    } catch (error) {
        console.error('Erro ao salvar documento:', error);
        alert('Erro ao salvar documento.');
    }
}

async function atualizarDocumentoNoBackend(docId, htmlDocumento, comentarios, titulo) {
    const infos = {
        titulo: titulo || 'Documento Gerado',
        objetivo: 'Outro',
        prazo: '',
        observacoes: ''
    };
    try {
        await fetch(`${getApiUrl('colaborativo')}/api/documento/${docId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                infos, 
                mensagens: [], 
                documento: htmlDocumento,
                comentarios,
                formatType: 'html'
            })
        });
        alert('Documento atualizado com sucesso!');
    } catch (error) {
        console.error('Erro ao atualizar documento:', error);
        alert('Erro ao atualizar documento.');
    }
}
// ...existing code...

// --- MODAL DE OPÇÕES DE SELEÇÃO ---
function openModalEscolhaTipoDocumentoGpt() {
    const modal = document.getElementById('modalEscolhaTipoDocumentoGpt');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('closeModalEscolhaTipoDocumentoGpt').onclick = () => {
        modal.style.display = 'none';
    };
    document.getElementById('btnMeusDocumentosGpt').onclick = () => {
        modal.style.display = 'none';
        openPaginaDocumentos();
    };
    document.getElementById('btnDocumentosRecebidosGpt').onclick = () => {
        modal.style.display = 'none';
        openPaginaDocumentosRecebidos(); // Implemente esta função conforme sua lógica
    };
}


async function openPaginaDocumentosRecebidos() {
    let pagina = document.getElementById('paginaDocumentosRecebidos');
    if (!pagina) return;
    pagina.classList.remove('hidden');
    pagina.style.display = 'flex';

    const btnFechar = document.getElementById('btnFecharPaginaDocumentosRecebidos');
    if (btnFechar) {
        btnFechar.onclick = function() {
            pagina.classList.add('hidden');
            pagina.style.display = 'none';
        };
    }

    const lista = document.getElementById('listaDocumentosRecebidos');
    if (!lista) return;
    lista.innerHTML = '<div style="padding:32px;text-align:center;">Carregando...</div>';

    try {
        const userId = localStorage.getItem('userId');
        const res = await fetch(`${getApiUrl('socket')}/api/documentos-recebidos/${userId}`);
        const docs = await res.json();
        if (!docs || docs.length === 0) {
            lista.innerHTML = '<div style="padding:32px;text-align:center;">Nenhum documento recebido ainda.</div>';
            return;
        }
        lista.innerHTML = '';
        docs.forEach(doc => {
            const titulo = doc.documento?.titulo || doc.documento?.infos?.titulo || doc.infos?.titulo || 'Sem título';
            const data = doc.recebidoEm || doc.criadoEm || doc.documento?.criadoEm;
            const item = document.createElement('div');
            item.className = 'documento-item';
            item.innerHTML = `
                <div class="documento-info">
                    <span class="documento-data">${data ? new Date(data).toLocaleString('pt-BR') : ''}</span>
                    <span class="documento-titulo">${titulo}</span>
                </div>
                <div class="documento-actions">
                    <button class="btn-documento" data-id="${doc._id}" data-action="abrir">
                        <i class="fa fa-eye"></i> Abrir
                    </button>
                    <button class="chatgpt-btn btn-excluir-documento" style="margin-left:8px;background:#e53935;color:#fff;">
                        <i class="fa fa-trash"></i>
                    </button>
                </div>
            `;
            lista.appendChild(item);
        });

        // abrir documento
        lista.querySelectorAll('.btn-documento[data-action="abrir"]').forEach(btn => {
            btn.onclick = async function() {
                const id = btn.getAttribute('data-id');
                const res = await fetch(`${getApiUrl('socket')}/api/documentos-recebidos/${userId}/${id}`);
                const doc = await res.json();
                pagina.classList.add('hidden');
                let textoDocumento = '';
                if (typeof doc.documento === 'string') {
                    textoDocumento = doc.documento;
                } else if (doc.documento?.documento) {
                    textoDocumento = doc.documento.documento;
                } else {
                    textoDocumento = JSON.stringify(doc.documento, null, 2);
                }
                mostrarDocumentoGeradoComSalvar(textoDocumento, doc._id);
            };
        });

        // excluir documento
        lista.querySelectorAll('.btn-excluir-documento').forEach(btn => {
            btn.onclick = async function() {
                const item = btn.closest('.documento-item');
                const id = item.querySelector('.btn-documento').getAttribute('data-id');
                if (confirm('Tem certeza que deseja excluir este documento recebido?')) {
                    try {
                        const res = await fetch(`${getApiUrl('socket')}/api/documentos-recebidos/${userId}/${id}`, { method: 'DELETE' });
                        if (res.ok) {
                            item.remove();
                        } else {
                            alert('Erro ao excluir documento.');
                        }
                    } catch (err) {
                        alert('Erro ao excluir documento.');
                    }
                }
            };
        });

    } catch (err) {
        console.error('Erro ao carregar documentos recebidos:', err);
        lista.innerHTML = '<div style="padding:32px;text-align:center;color:#e53935;">Erro ao carregar documentos recebidos.</div>';
    }
}
// ...existing code...

// --- FUNÇÃO PARA ABRIR MODAL DE OPÇÕES DE SELEÇÃO ---
function openModalOpcoesSelecao() {
    const modal = document.getElementById('modalOpcoesSelecaoGpt');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('closeModalOpcoesSelecaoGpt').onclick = () => {
        modal.style.display = 'none';
    };
    document.getElementById('btnOpcaoDocumentoGpt').onclick = () => {
        modal.style.display = 'none';
        openModalEscolhaTipoDocumentoGpt();
    };
    document.getElementById('btnOpcaoSharingGpt').onclick = () => {
        modal.style.display = 'none';
        showSelecaoNotificacao('Selecione as mensagens');
        ativarModoSelecaoMensagens();
    };
    atualizarHintBubble(); // Faz a nuvem sumir ao abrir seleção
}

// --- NOTIFICAÇÃO DE SELEÇÃO ---
// Mostra notificação ao ativar modo seleção
function showSelecaoNotificacao(texto) {
    let notif = document.getElementById('selecaoNotificacao');
    if (!notif) {
        notif = document.createElement('div');
        notif.id = 'selecaoNotificacao';
        notif.className = 'selecao-notificacao';
        document.body.appendChild(notif);
    }
    notif.textContent = texto;
    notif.classList.add('show');
    setTimeout(() => {
        notif.classList.remove('show');
    }, 2200);
}

// --- FUNÇÃO PARA ATIVAR MODO DE SELEÇÃO DE MENSAGENS ---
function ativarModoSelecaoMensagens() {
    isSelectionMode = true;
    selectedChatMessages = [];
    renderChatMessages();
    atualizarHintBubble(); // Faz a nuvem sumir ao ativar seleção
}

// Substitui evento do botão selecionar mensagens para abrir modal de opções
if (btnSelecionarMensagens) {
    btnSelecionarMensagens.onclick = openModalOpcoesSelecao;
}

// --- PÁGINA DE DOCUMENTOS GERADOS ---
// Abre página de documentos gerados
async function openPaginaDocumentos() {
    let pagina = document.getElementById('paginaDocumentos');
    if (!pagina) {
        pagina = document.createElement('div');
        pagina.id = 'paginaDocumentos';
        pagina.className = 'pagina-documentos-modal';
        pagina.innerHTML = `
            <div class="pagina-documentos-container">
                <div class="pagina-documentos-header">
                    <h2><i class="fa fa-file-alt"></i> Documentos Gerados</h2>
                    <button id="btnFecharPaginaDocumentos" class="chatgpt-btn" title="Fechar"><i class="fa fa-times"></i></button>
                </div>
                <div class="pagina-documentos-list" id="listaDocumentosGerados"></div>
            </div>
        `;
        document.body.appendChild(pagina);
    }
    pagina.classList.remove('hidden');
    pagina.style.display = 'flex';
    const btnFechar = document.getElementById('btnFecharPaginaDocumentos');
if (btnFechar) {
    btnFechar.onclick = function() {
        const pagina = document.getElementById('paginaDocumentos');
        if (pagina) {
            pagina.classList.add('hidden');
            pagina.style.display = 'none';
        }
    };
}
    const lista = document.getElementById('listaDocumentosGerados');
    lista.innerHTML = '<div style="padding:32px;text-align:center;">Carregando...</div>';
    try {
        const res = await fetch(`${getApiUrl('colaborativo')}/api/documento`);
        const docs = await res.json();
        if (!docs || docs.length === 0) {
            lista.innerHTML = '<div style="padding:32px;text-align:center;">Nenhum documento gerado ainda.</div>';
            return;
        }
        lista.innerHTML = '';
        docs.forEach(doc => {
            const item = document.createElement('div');
            item.className = 'documento-item';
            item.innerHTML = `
                <div class="documento-info">
                    <span class="documento-data">${new Date(doc.criadoEm).toLocaleString('pt-BR')}</span>
                    <span class="documento-titulo">${doc.infos?.titulo || 'Sem título'}</span>
                </div>
                <button class="btn-documento" data-id="${doc._id}" data-action="abrir">
    <i class="fa fa-eye"></i> Abrir
</button>
                <button class="btn-documento" data-id="${doc._id}" data-action="compartilhar" style="margin-left:8px;">
    <i class="fa fa-share"></i> Compartilhar documento
</button>
                <button class="chatgpt-btn btn-excluir-documento" style="margin-left:8px;background:#e53935;color:#fff;">
                    <i class="fa fa-trash "></i> 
                </button>
            `;
            lista.appendChild(item);
        });
        // Evento para abrir documento
        lista.querySelectorAll('.btn-documento[data-action="abrir"]').forEach(btn => {
    btn.onclick = async function() {
        const id = btn.getAttribute('data-id');
        const res = await fetch(`${getApiUrl('colaborativo')}/api/documento/${id}`);
        const doc = await res.json();
        pagina.classList.add('hidden');
        mostrarDocumentoGeradoComSalvar(doc.documento, doc._id);
    };
});
        // Evento para excluir documento
        lista.querySelectorAll('.btn-excluir-documento').forEach(btn => {
    btn.onclick = async function() {
        const item = btn.closest('.documento-item');
        const id = item.querySelector('.btn-documento').getAttribute('data-id');
        if (confirm('Tem certeza que deseja excluir este documento?')) {
            try {
                const res = await fetch(`${getApiUrl('colaborativo')}/api/documento/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    item.remove();
                } else {alert('Erro ao excluir documento.');
                }
            } catch (err) {
                alert('Erro ao excluir documento.');
            }
        }
    };
});
        // Evento para compartilhar documento
        lista.querySelectorAll('.btn-documento[data-action="compartilhar"]').forEach(btn => {
    btn.onclick = async function() {
        const id = btn.getAttribute('data-id');
        try {
            const res = await fetch(`${getApiUrl('colaborativo')}/api/documento/${id}`);
            const doc = await res.json();
            openModalCompartilharDocumento(doc, id);
        } catch (err) {
            alert('Erro ao carregar documento para compartilhamento.');
        }
    };
});
    } catch (err) {
        console.error('Erro ao carregar documentos:', err);
        lista.innerHTML = '<div style="padding:32px;text-align:center;color:#e53935;">Erro ao carregar documentos.</div>';
    }
}

// --- MODAL DE SELEÇÃO DE CHAT PARA COMPARTILHAR DOCUMENTO ---
// Abre modal para selecionar chat para compartilhar documento
// ...existing code...
// Abre modal para selecionar chat para compartilhar documento
async function openModalCompartilharDocumento(documento, docId) {
    // CORREÇÃO: Verificar se usuário está logado corretamente
    let currentUser = null;
    
    // Tenta pegar do localStorage (mesma estrutura do sharing.js)
    const userId = localStorage.getItem('userId');
    if (userId) {
        // Se tem userId, considera logado
        currentUser = { id: userId };
    } else {
        // Fallback para estrutura antiga
        currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    }
    
    if (!currentUser || !currentUser.id) {
        alert(`
Para compartilhar documentos, você precisa:

1. Ir para a seção "Sharing" 
2. Fazer login no sistema de chat
3. Criar ou participar de pelo menos um chat

Após isso, volte aqui para compartilhar o documento.
        `);
        return;
    }
    
    window.documentoParaCompartilhar = documento;
    const modal = document.getElementById('modalCompartilharDocumento');
    document.getElementById('modalCompartilharTituloGpt').textContent = documento.infos?.titulo || 'Sem título';
    modal.classList.remove('hidden');
    
    document.getElementById('closeModalCompartilharGpt').onclick = () => {
        modal.classList.add('hidden');
    };
    document.getElementById('btnCancelarCompartilharGpt').onclick = () => {
        modal.classList.add('hidden');
    };
    
    await carregarChatsParaCompartilhar(documento, docId);
}
// ...existing code...

// Carrega lista de chats para compartilhar documento
// Carrega lista de chats para compartilhar documento
// ...existing code...
async function carregarChatsParaCompartilhar(documento, docId) {
    const select = document.getElementById('chatSelectCompartilharGpt');
    select.innerHTML = '<option value="">Carregando chats...</option>';
    
    // CORREÇÃO: Usar mesma lógica do sharing.js
    let userId = localStorage.getItem('userId');
    if (!userId) {
        const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
        userId = currentUser?.id;
    }
    
    if (!userId) {
        select.innerHTML = '<option value="">Usuário não logado no sistema de chat</option>';
        return;
    }
    
    try {
        console.log('Tentando carregar chats para userId:', userId);
        
        // Tenta buscar chats do serverSocket.js (porta 3000)
        const res = await fetch(`${getApiUrl('socket')}/api/chats/${userId}`);
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        
        const chats = await res.json();
        console.log('Chats carregados:', chats);
        
        if (!chats || chats.length === 0) {
            select.innerHTML = '<option value="">Nenhum chat disponível para compartilhar</option>';
            return;
        }
        
        select.innerHTML = '<option value="">Selecione um chat...</option>';
        chats.forEach(chat => {
            const option = document.createElement('option');
            option.value = chat.chatId;
            option.textContent = chat.chatName || `Chat com ${chat.participant}`;
            select.appendChild(option);
        });
        
    } catch (err) {
        console.error('Erro ao carregar chats:', err);
        select.innerHTML = '<option value="">Erro ao conectar com servidor de chat</option>';
        
        // Mostra instruções mais específicas
        alert(`
Erro ao carregar chats para compartilhamento.

Verifique:
1. Se você está logado na seção "Sharing"
2. Se possui chats criados
3. Se o servidor está rodando na porta 3000

Detalhes do erro: ${err.message}
        `);
    }
}
// ...existing code...

// Habilita botão compartilhar quando um chat é selecionado
document.getElementById('chatSelectCompartilharGpt').addEventListener('change', function() {
    const btn = document.getElementById('btnEnviarCompartilharGpt');
    btn.disabled = !this.value;
});

// Compartilha documento no chat selecionado
document.getElementById('btnEnviarCompartilharGpt').onclick = function() {
    const select = document.getElementById('chatSelectCompartilharGpt');
    const chatId = select.value;
    const chatName = select.options[select.selectedIndex].text;
    if (!chatId) return;
    compartilharDocumentoNoChat(window.documentoParaCompartilhar, chatId, chatName);
    document.getElementById('modalCompartilharDocumento').classList.add('hidden');
};

// --- FUNÇÃO PARA CANCELAR SELEÇÃO DE MENSAGENS ---
function cancelarSelecaoMensagens() {
    isSelectionMode = false;
    selectedChatMessages = [];
    renderChatMessages();
    atualizarBotoesSelecao();
    atualizarHintBubble(); // Faz a nuvem sumir ao cancelar seleção
}


// --- FUNÇÃO PARA ATUALIZAR BOTÕES DE SELEÇÃO ---
function atualizarBotoesSelecao() {
    const btnCompartilhar = document.getElementById('btnCompartilharMensagensGpt');
    const btnCancelar = document.getElementById('btnCancelarSelecaoMensagensGpt');
    if (isSelectionMode) {
        btnCompartilhar.style.display = selectedChatMessages.length > 0 ? 'inline-flex' : 'none';
        btnCancelar.style.display = 'inline-flex';
    } else {
        btnCompartilhar.style.display = 'none';
        btnCancelar.style.display = 'none';
    }
}

// Compartilha documento no chat selecionado
async function compartilharDocumentoNoChat(documento, chatId, chatName) {
    try {
        let userId = localStorage.getItem('userId');
        if (!userId) {
            const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
            userId = currentUser?.id;
        }
        
        if (!userId) {
            alert('Erro: Usuário não está logado no sistema de chat');
            return;
        }
        
        // USA OS DADOS DO FORMULÁRIO ATUAL
        const modalTituloGpt = document.getElementById('modalTituloGpt');
        const modalObjetivoGpt = document.getElementById('modalObjetivoGpt');
        const modalPrazoGpt = document.getElementById('modalPrazoGpt');
        const modalObservacoesGpt = document.getElementById('modalObservacoesGpt');
        
        const infosAtuais = {
            titulo: modalTituloGpt ? modalTituloGpt.value.trim() : 'Documento sem título',
            objetivo: modalObjetivoGpt ? modalObjetivoGpt.value : 'Não especificado',
            prazo: modalPrazoGpt ? modalPrazoGpt.value : 'Não definido',
            observacoes: modalObservacoesGpt ? modalObservacoesGpt.value.trim() : ''
        };
        
        console.log('=== DADOS ATUAIS DO FORMULÁRIO ===');
        console.log('infosAtuais:', infosAtuais);
        
        let htmlDocumento = documento.documento;
        if (!htmlDocumento.includes('<div') && !htmlDocumento.includes('<style')) {
            htmlDocumento = `
                <div style="
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    padding: 16px;
                    background: #fff;
                    border-radius: 8px;
                ">
                    <div class="shared-document">
                        ${typeof marked !== 'undefined' ? marked.parse(htmlDocumento) : htmlDocumento.replace(/\n/g, '<br>')}
                    </div>
                </div>
            `;
        }
        
        const documentData = {
            title: infosAtuais.titulo,
            preview: `📄 ${infosAtuais.titulo} - ${infosAtuais.objetivo} | Prazo: ${infosAtuais.prazo}`,
            content: {
                titulo: infosAtuais.titulo,
                objetivo: infosAtuais.objetivo,    // <-- USA DADOS DO FORMULÁRIO
                prazo: infosAtuais.prazo,          // <-- USA DADOS DO FORMULÁRIO
                observacoes: infosAtuais.observacoes, // <-- USA DADOS DO FORMULÁRIO
                documento: htmlDocumento,
                formatType: 'html'
            },
            createdAt: documento.criadoEm || new Date().toISOString()
        };
        
        console.log('=== documentData para compartilhar ===');
        console.log('documentData.content:', documentData.content);
        
        const response = await fetch(`${getApiUrl('socket')}/api/share-document`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: chatId,
                userId: userId,
                documentData: documentData
            })
        });
        
        if (response.ok) {
            document.getElementById('modalCompartilharDocumento').classList.add('hidden');
            alert(`Documento compartilhado com sucesso no chat "${chatName}"!`);
        } else {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Falha ao compartilhar documento');
        }
    } catch (error) {
        console.error('Erro ao compartilhar documento:', error);
        alert(`Erro ao compartilhar documento: ${error.message}`);
    }
}

// Comentário para Modal Documento Gerado GPT

const btnComentar = document.getElementById('btnComentarDocumentoGpt');
const documentoContent = document.getElementById('documentoGeradoContentGpt');
const btnFecharDocumentoGerado = document.getElementById('closeDocumentoGeradoGpt');
const documentoGeradoContainer = document.getElementById('documentoGeradoContainerGpt');
if (btnFecharDocumentoGerado && documentoGeradoContainer) {
    btnFecharDocumentoGerado.onclick = function() {
        documentoGeradoContainer.classList.add('hidden');
    };
}
const comentarioModal = document.getElementById('comentarioModalGpt');
const comentarioInput = document.getElementById('comentarioInputGpt');
const btnEditarComentario = document.getElementById('btnEditarComentarioGpt');
const btnApagarComentario = document.getElementById('btnApagarComentarioGpt');
const btnFecharComentario = document.getElementById('btnFecharComentarioGpt');

let comentarioData = {}; // { id: {text, comment} }
let selecionandoComentario = false;
let trechoSelecionadoId = null;

// Ativa modo de seleção ao clicar em "Comentar"
btnComentar.onclick = () => {
  selecionandoComentario = true;
  documentoContent.style.cursor = 'text';
  window.getSelection().removeAllRanges();
  alert('Selecione o trecho que deseja comentar com o mouse.');
};

// Detecta seleção de texto
documentoContent.addEventListener('mouseup', function(e) {
  if (!selecionandoComentario) return;
  const selection = window.getSelection();
  if (selection.isCollapsed) return;
  const selectedText = selection.toString();
  if (!selectedText.trim()) return;

  // Cria um id único para o trecho
  const id = 'trecho_' + Date.now();
  trechoSelecionadoId = id;

  // Substitui o texto selecionado por um span com estilo e id
  const range = selection.getRangeAt(0);
  const span = document.createElement('span');
  span.className = 'trecho-comentado-gpt';
  span.id = id;
  span.textContent = selectedText;
  span.style.fontWeight = 'bold';
  span.style.background = '#1565c0';
  span.style.color = '#fff';
  span.style.cursor = 'pointer';

  range.deleteContents();
  range.insertNode(span);

  // Limpa seleção
  selection.removeAllRanges();
  selecionandoComentario = false;
  documentoContent.style.cursor = 'default';

  // Abre modal para comentar
  comentarioInput.value = comentarioData[id]?.comment || '';
  comentarioModal.classList.remove('hidden');
});

// Ao clicar em trecho comentado, mostra modal com comentário
documentoContent.addEventListener('click', function(e) {
  if (e.target.classList.contains('trecho-comentado-gpt')) {
    trechoSelecionadoId = e.target.id;
    comentarioInput.value = comentarioData[trechoSelecionadoId]?.comment || '';
    comentarioModal.classList.remove('hidden');
  }
});

// Salva/edita comentário
btnEditarComentario.onclick = function() {
  if (!trechoSelecionadoId) return;
  const span = document.getElementById(trechoSelecionadoId);
  if (span) {
    comentarioData[trechoSelecionadoId] = {
      text: span.textContent,
      comment: comentarioInput.value
    };
    comentarioModal.classList.add('hidden');
  }
};

// Apaga comentário e restaura estilo original
btnApagarComentario.onclick = function() {
  if (!trechoSelecionadoId) return;
  const span = document.getElementById(trechoSelecionadoId);
  if (span) {
    const textoOriginal = comentarioData[trechoSelecionadoId]?.text || span.textContent;
    const textNode = document.createTextNode(textoOriginal);
    span.parentNode.replaceChild(textNode, span);
    delete comentarioData[trechoSelecionadoId];
    comentarioModal.classList.add('hidden');
    trechoSelecionadoId = null;
  }
};

// Fecha modal de comentário
btnFecharComentario.onclick = function() {
  comentarioModal.classList.add('hidden');
  trechoSelecionadoId = null;
};

// ...existing code...

document.addEventListener('click', function(e) {
    const overlay = document.getElementById('popup-sugestao-ia');
    if (overlay && overlay.style.display !== 'none') {
        const modal = overlay.querySelector('.sugestao-ia-modal');
        if (modal && !modal.contains(e.target)) {
            overlay.remove();
            // Se o botão "Trocar IA" não existe, significa que já está na melhor IA
            const btnTrocar = document.getElementById('btnTrocarIA');
            const btnContinuar = document.getElementById('btnContinuarIA');
            if (!btnTrocar && btnContinuar) {
                // Envia a mensagem com a IA atual
                const msg = chatgptInput.value.trim();
                if (msg) {
                    enviarMensagemParaIA(msg, getIAAtual());
                }
            }
        }
    }
});