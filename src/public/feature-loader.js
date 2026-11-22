// Keep startup recovery independent from dashboard module loading.
(() => {
  const showError = (message) => {
    document.body.classList.remove('auth-loading', 'feature-loading');
    const panel = document.querySelector('.main-panel');
    if (!panel || panel.querySelector('.workspace-load-error')) return;
    const notice = document.createElement('div');
    notice.className = 'workspace-load-error';
    notice.setAttribute('role', 'alert');
    const text = document.createElement('span');
    text.textContent = message || 'The workspace could not start. Reload and try again.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Reload workspace';
    button.onclick = () => location.reload();
    notice.append(text, button);
    panel.prepend(notice);
  };

  window.addEventListener('error', (event) => {
    if (event.filename && /\/(app|business)\.js(?:\?|$)/.test(event.filename)) {
      showError(`Dashboard script error: ${event.message || 'unknown error'}`);
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && document.body.classList.contains('auth-loading')) location.reload();
  });
})();
