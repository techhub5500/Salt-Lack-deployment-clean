// Variável global para armazenar a IA atual
let iaAtual = 'openai';

// ADICIONAR: Função para detectar ambiente e retornar URLs corretas
function getApiUrl(service) {
    const isProduction = window.location.hostname !== 'localhost';
    const urls = {
        socket: isProduction ? 'https://seu-socket-server.onrender.com' : 'http://localhost:3000',
        lateral: isProduction ? 'https://seu-lateral-server.onrender.com' : 'http://localhost:5001', 
        colaborativo: isProduction ? 'https://seu-colaborativo-server.onrender.com' : 'http://localhost:5002'
    };
    return urls[service];
}

// Função para abrir o modal de IA
function abrirModalIA() {
  const modal = document.getElementById('iaModal');
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  
  // Verificar quais IAs estão disponíveis no servidor
  verificarIAsDisponiveis();
  
  // Atualizar a exibição da IA atual
  atualizarIAAtual();
}

// Função para verificar IAs disponíveis no servidor
async function verificarIAsDisponiveis() {
  try {
    // USAR URL DINÂMICA
    const response = await fetch(`${getApiUrl('lateral')}/api/status`);
    const data = await response.json();
    
    // Atualizar visual baseado na disponibilidade
    const itens = document.querySelectorAll('.ia-item');
    itens.forEach(item => {
      const iaId = item.getAttribute('data-ia');
      const btn = item.querySelector('.ia-btn');
      const disponivel = data.modelos && data.modelos[iaId];
      
      if (!disponivel) {
        item.style.opacity = '0.5';
        btn.disabled = true;
        btn.textContent = 'Indisponível';
        item.title = 'Este modelo não está configurado no servidor';
      } else {
        item.style.opacity = '1';
        item.title = '';
        if (iaId !== iaAtual) {
          btn.disabled = false;
          btn.textContent = 'Usar';
        }
      }
    });
  } catch (error) {
    console.error('Erro ao verificar IAs disponíveis:', error);
  }
}

// Função para fechar o modal de IA
function fecharModalIA() {
  const modal = document.getElementById('iaModal');
  modal.classList.remove('active');
  document.body.style.overflow = 'auto';
}

// Fechar modal ao clicar no overlay
document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('iaModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === this) {
        fecharModalIA();
      }
    });
  }
});

// Fechar modal com ESC
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    fecharModalIA();
  }
});

// Função para selecionar uma IA
async function selecionarIA(modeloIA, nomeIA) {
  try {
    // Verificar se a IA está disponível - USAR URL DINÂMICA
    const response = await fetch(`${getApiUrl('lateral')}/api/status`);
    const data = await response.json();
    
    if (!data.modelos || !data.modelos[modeloIA]) {
      mostrarNotificacao(`${nomeIA} não está disponível no servidor`, 'error');
      return;
    }
    
    // Atualizar variável global
    iaAtual = modeloIA;
    
    // Tornar a variável disponível globalmente para outros arquivos
    window.iaAtual = modeloIA;
    
    // Fechar modal
    fecharModalIA();
    
    // Mostrar notificação
    mostrarNotificacao(`Agora você está usando ${nomeIA}`);
    
    // Atualizar visual do modal para próxima abertura
    atualizarIAAtual();
    
    console.log(`IA alterada para: ${nomeIA} (${modeloIA})`);
    
  } catch (error) {
    console.error('Erro ao selecionar IA:', error);
    mostrarNotificacao('Erro ao alterar IA', 'error');
  }
}

// Função para atualizar a exibição da IA atual
function atualizarIAAtual() {
  const iaAtualElement = document.getElementById('iaAtual');
  const itens = document.querySelectorAll('.ia-item');
  
  // Mapear IDs para nomes amigáveis
  const nomes = {
    'openai': 'ChatGPT',
    'claude': 'Claude',
    'gemini': 'Gemini',
    'deepseek': 'DeepSeek'
  };
  
  if (iaAtualElement) {
    iaAtualElement.textContent = nomes[iaAtual] || 'ChatGPT';
  }
  
  // Atualizar visual dos itens
  itens.forEach(item => {
    const iaId = item.getAttribute('data-ia');
    const btn = item.querySelector('.ia-btn');
    
    if (iaId === iaAtual) {
      item.classList.add('ativa');
      btn.textContent = 'Em uso';
      btn.disabled = true;
    } else {
      item.classList.remove('ativa');
      if (btn.textContent !== 'Indisponível') {
        btn.textContent = 'Usar';
        btn.disabled = false;
      }
    }
  });
}

// Função para mostrar notificação
function mostrarNotificacao(mensagem, tipo = 'success') {
  // Remover notificação anterior se existir
  const notificacaoAnterior = document.querySelector('.notification');
  if (notificacaoAnterior) {
    notificacaoAnterior.remove();
  }
  
  // Criar nova notificação
  const notificacao = document.createElement('div');
  notificacao.className = 'notification';
  notificacao.textContent = mensagem;
  
  if (tipo === 'error') {
    notificacao.style.background = '#dc3545';
  }
  
  document.body.appendChild(notificacao);
  
  // Mostrar notificação
  setTimeout(() => {
    notificacao.classList.add('show');
  }, 100);
  
  // Remover notificação após 3 segundos
  setTimeout(() => {
    notificacao.classList.remove('show');
    setTimeout(() => {
      if (notificacao.parentNode) {
        notificacao.remove();
      }
    }, 300);
  }, 3000);
}

// Modificar a função sendMessage para usar a IA selecionada
function sendMessage() {
  const userInput = document.getElementById('userInput');
  const chatContainer = document.getElementById('chatContainer');
  const sendButton = document.getElementById('sendButton');
  
  const message = userInput.value.trim();
  if (!message) return;
  
  // Adicionar mensagem do usuário
  addMessage(message, 'user');
  userInput.value = '';
  
  // Desabilitar botão durante processamento
  sendButton.disabled = true;
  sendButton.innerHTML = '<span class="loading"></span>';
  
  // Adicionar mensagem de loading do bot
  const loadingId = addMessage('Pensando...', 'bot', true);
  
  // Log para debug
  console.log(`Enviando mensagem com IA: ${iaAtual}`);
  
  // Enviar para o servidor com a IA selecionada - USAR URL DINÂMICA
  fetch(`${getApiUrl('lateral')}/api/rota`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      prompt: message,
      modeloIA: iaAtual // Usar a IA selecionada
    })
  })
  .then(response => response.json())
  .then(data => {
    // Remover mensagem de loading
    const loadingElement = document.getElementById(loadingId);
    if (loadingElement) loadingElement.remove();
    
    // Adicionar resposta real
    if (data.bot) {
      addMessage(data.bot, 'bot');
    } else if (data.error) {
      addMessage(`Erro: ${data.error}`, 'bot');
    } else {
      addMessage('Desculpe, ocorreu um erro ao processar sua mensagem.', 'bot');
    }
  })
  .catch(error => {
    console.error('Erro:', error);
    // Remover mensagem de loading
    const loadingElement = document.getElementById(loadingId);
    if (loadingElement) loadingElement.remove();
    
    addMessage('Erro ao conectar com o servidor. Tente novamente.', 'bot');
  })
  .finally(() => {
    // Reabilitar botão
    sendButton.disabled = false;
    sendButton.innerHTML = '➤';
  });
}

// Garantir que a variável seja global desde o início
window.iaAtual = iaAtual;