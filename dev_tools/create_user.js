// create_user.js
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

(async () => {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Cihuatadatalab-1',
    database: 'mi_app'
  });

  const username = ''; // Nombre de usuario
  const plainPass = ''; // Contraseña
  const hash = await bcrypt.hash(plainPass, 12);

  try {
    const [result] = await connection.execute(
      'INSERT INTO usuarios (usuario, password_hash, nombre) VALUES (?, ?, ?)',
      [username, hash, 'Administrador']
    );
    console.log('Usuario creado con id:', result.insertId);
  } catch (err) {
    console.error('Error al crear usuario:', err.message);
  } finally {
    await connection.end();
  }
})();
