// header.js
// Controla el icono de usuario en el header: carga /session-info, muestra nombre y gestiona logout.

document.addEventListener('DOMContentLoaded', () => {
  const userBtn = document.getElementById('userBtn');
  const userDropdown = document.getElementById('userDropdown');
  const userName = document.getElementById('userName');
  const userEmail = document.getElementById('userEmail');
  const logoutBtn = document.getElementById('logoutBtn');

  // Carga la sesión y actualiza el header
  async function loadSession() {
    try {
      const res = await fetch('/session-info', { credentials: 'same-origin' });
      const data = await res.json();
      if (data.logged) {
        userName.textContent = data.user.nombre || data.user.usuario || 'Usuario';
        userEmail.textContent = data.user.usuario || '';
      } else {
        // Si no hay sesión, puedes ocultar el botón o redirigir (opcional)
        // window.location.href = '/Login.html';
        if (userBtn) userBtn.style.display = 'none';
      }
    } catch (e) {
      console.error('No se pudo cargar la sesión:', e);
    }
  }

  loadSession();

  // Toggle dropdown
  if (userBtn) {
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('open');
      userBtn.setAttribute('aria-expanded', userDropdown.classList.contains('open'));
    });
  }

  // Cerrar clic fuera
  document.addEventListener('click', (e) => {
    if (!userDropdown.contains(e.target) && !userBtn.contains(e.target)) {
      userDropdown.classList.remove('open');
      userBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // Cerrar con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      userDropdown.classList.remove('open');
      userBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // Logout
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/logout', { method: 'POST', credentials: 'same-origin' });
      } catch (err) {
        console.error('Error en logout:', err);
      } finally {
        // redirige al login (ajusta mayúsculas si es necesario)
        window.location.href = '/Login.html';
      }
    });
  }
});
