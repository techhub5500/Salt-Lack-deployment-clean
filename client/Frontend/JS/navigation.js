/*
 * Este JS controla a navegação entre as áreas principais da interface (ChatGPT, Sharing, Workspace),
 * alterna a exibição das seções, gerencia o recolhimento/expansão da sidebar e implementa o envio de mensagens
 * no ChatGPT simulado. Ele não faz autenticação, chat em tempo real ou workspace avançado — apenas a navegação
 * e interações básicas da interface.
 */

// JS para navegação entre áreas e sidebar
const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('mainContent');
const sections = {
    chatgpt: document.getElementById('chatgptSection'),
    sharing: document.getElementById('sharingSection')
};
const navItems = {
    chatgpt: document.getElementById('nav-chatgpt'),
    sharing: document.getElementById('nav-sharing')
};

function showSection(sectionId) {
    // Esconder todas as seções
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.add('hidden');
    });

    // Mostrar seção específica
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.remove('hidden');
    }

    // Atualizar item ativo no sidebar
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.remove('active');
    });

    // Marcar item correspondente como ativo
    const navMap = {
        'chatgptSection': 'nav-chatgpt',
        'sharingSection': 'nav-sharing'
    };

    const activeNavItem = document.getElementById(navMap[sectionId]);
    if (activeNavItem) {
        activeNavItem.classList.add('active');
    }

    // Salva a seção atual no localStorage
    localStorage.setItem('lastSection', sectionId);
}

// Event listeners para navegação
document.addEventListener('DOMContentLoaded', function() {
    const anim = document.getElementById('feedback-anim');
    const mainLayout = document.querySelector('.main-layout');
    
    // Verificar se é a primeira visualização do dia
    const today = new Date().toDateString();
    const lastAnimationDate = localStorage.getItem('feedbackAnimationDate');
    const shouldShowAnimation = lastAnimationDate !== today;
    
    if (anim && shouldShowAnimation) {
        // Salvar a data atual
        localStorage.setItem('feedbackAnimationDate', today);
        
        // Adicionar classe para iniciar animação
        anim.classList.add('animate');
        
        // Remove o elemento animado após a animação (2.4s + delay)
        setTimeout(() => {
            anim.style.display = 'none';
        }, 2500);
    } else if (anim) {
        // Se não deve mostrar animação, remove imediatamente
        anim.style.display = 'none';
    }
    // Navegação do sidebar
    document.getElementById('nav-chatgpt').addEventListener('click', () => {
        showSection('chatgptSection');
    });

    document.getElementById('nav-sharing').addEventListener('click', () => {
        showSection('sharingSection');
    });

    // Restaurar seção anterior ao carregar a página
    const lastSection = localStorage.getItem('lastSection');
    if (lastSection === 'sharingSection') {
        showSection('sharingSection');
    } else {
        showSection('chatgptSection');
    }

    // Ajusta largura do mainContent
    mainContent.style.width = '80%';
});

// Sidebar recolher/expandir
document.getElementById('toggleSidebar').onclick = () => {
    console.log('Estado atual:', sidebar.classList);
    if (sidebar.classList.contains('expanded')) {
        // Recolher: remover expanded e adicionar collapsed
        sidebar.classList.remove('expanded');
        sidebar.classList.add('collapsed');
        mainContent.style.width = '95%';
        console.log('Recolhido - classes:', sidebar.classList);
    } else {
        // Expandir: remover collapsed e adicionar expanded
        sidebar.classList.remove('collapsed');
        sidebar.classList.add('expanded');
        mainContent.style.width = '80%';
        console.log('Expandido - classes:', sidebar.classList);
    }
};

// --- REMOVIDO: BLOCO ANTIGO DO CHATGPT ---
// O envio de mensagens do ChatGPT é tratado no chatgpt.js usando os ids/classes corretos.
// Não há mais manipulação dos elementos antigos (chatgptForm, chatgptInput, chatgptMessages) aqui.