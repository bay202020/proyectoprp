# show_last_preds.py
# Muestra últimas N predicciones desde MySQL
import os
import pymysql  # pip install pymysql
from datetime import datetime

# config: puedes leer de .env si quieres
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_USER = os.environ.get("DB_USER", "root")
DB_PASS = os.environ.get("DB_PASS", "Cihuatadatalab-1")
DB_NAME = os.environ.get("DB_NAME", "mi_app")
DB_PORT = int(os.environ.get("DB_PORT", 3306))

LIMIT = 20

conn = pymysql.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME, port=DB_PORT, cursorclass=pymysql.cursors.DictCursor)

with conn:
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT employee_id, prediccion, probabilidad, actualizado_at
            FROM empleado_prediccion
            ORDER BY actualizado_at DESC
            LIMIT %s
        """, (LIMIT,))
        rows = cur.fetchall()

if not rows:
    print("No hay predicciones todavía.")
else:
    print(f"Últimas {len(rows)} predicciones (más recientes primero):")
    for r in rows:
        ts = r.get("actualizado_at")
        if isinstance(ts, datetime):
            ts = ts.strftime("%Y-%m-%d %H:%M:%S")
        print(f"  employee_id={r['employee_id']!s:10}  pred={r['prediccion']}  prob={r['probabilidad']:.3f}  updated={ts}")
