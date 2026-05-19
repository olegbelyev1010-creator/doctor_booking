const messagesEl = document.getElementById('messages');
const form = document.getElementById('chat-form');
const input = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const statusEl = document.getElementById('status');
const resetBtn = document.getElementById('reset-btn');
const resetBtnMobile = document.getElementById('reset-btn-mobile');
const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const sidebarClose = document.getElementById('sidebar-close');
const quickReplies = document.getElementById('quick-replies');
const chatPanel = document.querySelector('.chat-panel');
const isMobileLayout = window.matchMedia('(max-width: 820px)').matches;

let sessionId = localStorage.getItem('doctorBookingSessionId') || null;
let isLoading = false;
let hasUserMessage = false;

const WELCOME =
  'Добрый день, регистратура клиники «ДокторОнлайн». ' +
  'Запишу вас на онлайн-консультацию. К какому специалисту вас записать?';

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatLine(line) {
  const normalized = line
    .replace(/какого врача и на какое время/gi, 'к какому врачу и на какое время')
    .replace(/какого врача/gi, 'к какому врачу');
  return escapeHtml(normalized).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function formatMarkdown(text) {
  const lines = text.split('\n');
  let html = '';
  let inOl = false;
  let inUl = false;
  let inDoctorLi = false;

  const closeDoctorLi = () => {
    if (inDoctorLi) {
      html += '</li>';
      inDoctorLi = false;
    }
  };

  const closeOl = () => {
    closeDoctorLi();
    if (inOl) {
      html += '</ol>';
      inOl = false;
    }
  };

  const closeUl = () => {
    if (inUl) {
      html += '</ul>';
      inUl = false;
    }
  };

  const closeAll = () => {
    closeUl();
    closeOl();
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!inDoctorLi) closeAll();
      continue;
    }

    const blockquote = trimmed.match(/^>\s*(.+)/);
    const numbered = trimmed.match(/^\d+\.\s+(.+)/);
    const bullet = trimmed.match(/^[-•*]\s+(.+)/);

    if (blockquote) {
      closeAll();
      const content = blockquote[1];
      const isSelectionBanner = /ближайш|рейтинг|⏱/i.test(content);
      if (isSelectionBanner) {
        html += `<div class="selection-banner"><span class="selection-banner-icon" aria-hidden="true">⏱</span><span>${formatLine(content.replace(/^⏱\s*/, ''))}</span></div>`;
      } else {
        html += `<blockquote class="bubble-quote">${formatLine(content)}</blockquote>`;
      }
      continue;
    }

    if (numbered) {
      closeUl();
      if (!inOl) {
        html += '<ol class="doctor-list">';
        inOl = true;
      }
      closeDoctorLi();
      html += `<li class="doctor-item"><div class="doctor-name">${formatLine(numbered[1])}</div>`;
      inDoctorLi = true;
      continue;
    }

    if (inDoctorLi) {
      html += `<div class="doctor-detail">${formatLine(trimmed)}</div>`;
      continue;
    }

    if (bullet) {
      closeOl();
      if (!inUl) {
        html += '<ul>';
        inUl = true;
      }
      html += `<li>${formatLine(bullet[1])}</li>`;
      continue;
    }

    closeAll();
    html += `<p>${formatLine(trimmed)}</p>`;
  }

  closeAll();
  return html || escapeHtml(text);
}

function getTimeLabel() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom(smooth = false) {
  requestAnimationFrame(() => {
    messagesEl.scrollTo({
      top: messagesEl.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  });
}

function setupMobileViewport() {
  if (!isMobileLayout) return;

  const setAppHeight = () => {
    const height = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${height}px`);
  };

  setAppHeight();
  window.visualViewport?.addEventListener('resize', setAppHeight);
  window.visualViewport?.addEventListener('scroll', setAppHeight);
  window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 150));
}

function setupMobileInput() {
  if (!isMobileLayout) return;

  input.addEventListener('focus', () => {
    chatPanel?.classList.add('keyboard-open');
    setTimeout(() => scrollToBottom(true), 280);
  });

  input.addEventListener('blur', () => {
    chatPanel?.classList.remove('keyboard-open');
    setTimeout(() => {
      document.documentElement.style.setProperty(
        '--app-height',
        `${window.visualViewport?.height ?? window.innerHeight}px`
      );
    }, 100);
  });
}

function appendMessage(role, content, isError = false) {
  const isUser = role === 'user';
  const row = document.createElement('div');
  row.className = `message-row ${role}${isError ? ' error' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = isUser ? 'Вы' : 'Рег';

  const contentWrap = document.createElement('div');
  contentWrap.className = 'message-content';

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = `${isUser ? 'Вы' : 'Регистратура'} · ${getTimeLabel()}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = formatMarkdown(content);

  contentWrap.appendChild(meta);
  contentWrap.appendChild(bubble);
  row.appendChild(avatar);
  row.appendChild(contentWrap);
  messagesEl.appendChild(row);
  scrollToBottom();

  if (isUser) {
    hasUserMessage = true;
    quickReplies?.classList.add('hidden');
  }
}

function showTyping() {
  const row = document.createElement('div');
  row.className = 'message-row assistant typing-row';
  row.id = 'typing-indicator';

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = 'Рег';

  const contentWrap = document.createElement('div');
  contentWrap.className = 'message-content';

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = 'Регистратура печатает...';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';

  contentWrap.appendChild(meta);
  contentWrap.appendChild(bubble);
  row.appendChild(avatar);
  row.appendChild(contentWrap);
  messagesEl.appendChild(row);
  scrollToBottom();
}

function hideTyping() {
  document.getElementById('typing-indicator')?.remove();
}

function setLoading(loading) {
  isLoading = loading;
  sendBtn.disabled = loading;
  input.disabled = loading;

  const statusText = statusEl.querySelector('.status-text');
  statusEl.classList.toggle('loading', loading);
  if (statusText) {
    statusText.textContent = loading ? 'Отвечает...' : 'На линии';
  }
}

async function sendMessage(text) {
  setLoading(true);
  showTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId }),
    });

    const data = await res.json();
    hideTyping();

    if (!res.ok) {
      appendMessage('assistant', data.error || 'Произошла ошибка', true);
      return;
    }

    sessionId = data.sessionId;
    localStorage.setItem('doctorBookingSessionId', sessionId);
    appendMessage('assistant', data.reply);
  } catch {
    hideTyping();
    appendMessage(
      'assistant',
      'Не удалось связаться с сервером. Проверьте, что он запущен.',
      true
    );
  } finally {
    setLoading(false);
  }
}

async function handleSubmit(text) {
  const trimmed = text.trim();
  if (!trimmed || isLoading) return;

  appendMessage('user', trimmed);
  input.value = '';
  input.style.height = 'auto';

  await sendMessage(trimmed);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await handleSubmit(input.value);
});

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

quickReplies?.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip?.dataset.text) return;
  handleSubmit(chip.dataset.text);
});

function openSidebar() {
  sidebar?.classList.add('is-open');
  sidebarOverlay?.classList.add('is-visible');
  sidebarOverlay?.setAttribute('aria-hidden', 'false');
  menuBtn?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('menu-open');
}

function closeSidebar() {
  sidebar?.classList.remove('is-open');
  sidebarOverlay?.classList.remove('is-visible');
  sidebarOverlay?.setAttribute('aria-hidden', 'true');
  menuBtn?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
}

function toggleSidebar() {
  if (sidebar?.classList.contains('is-open')) closeSidebar();
  else openSidebar();
}

async function resetChat() {
  if (sessionId) {
    await fetch('/api/chat/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  }
  sessionId = null;
  hasUserMessage = false;
  localStorage.removeItem('doctorBookingSessionId');
  messagesEl.innerHTML = '';
  quickReplies?.classList.remove('hidden');
  appendMessage('assistant', WELCOME);
  closeSidebar();
  input.focus();
}

menuBtn?.addEventListener('click', toggleSidebar);
sidebarOverlay?.addEventListener('click', closeSidebar);
sidebarClose?.addEventListener('click', closeSidebar);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidebar();
});

resetBtn?.addEventListener('click', resetChat);
resetBtnMobile?.addEventListener('click', resetChat);

appendMessage('assistant', WELCOME);
setupMobileViewport();
setupMobileInput();

fetch('/api/stats')
  .then((r) => r.json())
  .then((data) => {
    const el = document.getElementById('doctor-count');
    if (el && data.doctorCount != null) el.textContent = data.doctorCount;
  })
  .catch(() => {});
