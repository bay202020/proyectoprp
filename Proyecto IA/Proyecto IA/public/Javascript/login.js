// login.js
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnLogin');
  const err = document.getElementById('error');

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Validando...';

    const usuario = document.getElementById('usuario').value.trim();
    const password = document.getElementById('password').value;

    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, password }),
        credentials: 'same-origin'
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        btn.textContent = 'Redirigiendo…';
        setTimeout(() => {
          window.location.href = '/Inicio.html';
        }, 250);
      } else {
        err.textContent = data.msg || 'Usuario o contraseña incorrectos';
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    } catch (e) {
      console.error('Fetch error:', e);
      err.textContent = 'Error de conexión';
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
});

// ===============================
// Mostrar / Ocultar Contraseña
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  const passwordInput = document.getElementById('password');
  const togglePassword = document.getElementById('togglePassword');
  const eyeIcon = document.getElementById('eyeIcon');

  togglePassword.addEventListener('click', () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";

    // Cambiar icono
    eyeIcon.innerHTML = isPassword
      ? `<path d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a21.77 21.77 0 015.06-6.94m3.03-1.67A9.8 9.8 0 0112 4c7 0 11 8 11 8a21.77 21.77 0 01-5.06 6.94M9.5 9.5L14.5 14.5" stroke="#bfc5d0" stroke-width="1.6"/>`
      : `<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>`;
  });
});


// login.js
// Controla el formulario de login.

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnLogin');
  const err = document.getElementById('error');

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Validando...';

    const usuario = document.getElementById('usuario').value.trim();
    const password = document.getElementById('password').value;

    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ usuario, password })
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        btn.textContent = 'Redirigiendo...';
        setTimeout(() => {
          window.location.href = '/Inicio.html';
        }, 300);
      } else {
        err.textContent = data.msg;
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }

    } catch (error) {
      err.textContent = 'Error de conexión';
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
});

