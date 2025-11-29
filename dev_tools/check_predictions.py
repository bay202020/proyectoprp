# check_predictions.py
# Comprueba que las predicciones guardadas en empleado_prediccion
# correspondan con un fichero procesado (por employee_id o por timestamp).
import os
import sys
import json
import pymysql   # pip install pymysql
from datetime import datetime

# --- CONFIGURA ESTO según tu entorno ---
DB_HOST = os.getenv("DB_HOST", "interchange.proxy.rlwy.net")
DB_USER = os.getenv("DB_USER", "root")
DB_PASS = os.getenv("DB_PASS", "huRlZiEFHPKlhhkJnwtOBtDIBfYzOCNY")
DB_NAME = os.getenv("DB_NAME", "railway")
# Si quieres comprobar por archivo: pon el nombre EXACTO del archivo procesado
PROCESSED_FILENAME = None  # ejemplo: "1764052539549_Empleadosnuevos.csv.processed_20251125_003550"
# O deja None y hará un resumen global del último bloque insertado
# -------------------------------------

def get_last_processed_timestamp():
    # intenta obtener la última marca 'actualizado_at' en la tabla
    conn = pymysql.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(actualizado_at) FROM empleado_prediccion")
            row = cur.fetchone()
            return row[0]
    finally:
        conn.close()

def count_preds_at_timestamp(ts):
    conn = pymysql.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM empleado_prediccion WHERE DATE(actualizado_at)=DATE(%s) AND HOUR(actualizado_at)=HOUR(%s) AND MINUTE(actualizado_at)=MINUTE(%s)", (ts,ts,ts))
            return cur.fetchone()[0]
    finally:
        conn.close()

def list_recent_preds(limit=20):
    conn = pymysql.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME)
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT employee_id,prediccion,probabilidad,actualizado_at FROM empleado_prediccion ORDER BY actualizado_at DESC LIMIT %s", (limit,))
            return cur.fetchall()
    finally:
        conn.close()

def main():
    if PROCESSED_FILENAME:
        print("Comprobando registros relacionados (filename):", PROCESSED_FILENAME)
        # Si en tu flujo guardas el filename en uploads/empleados_raw o uploads table -> se podría buscar
        # Aquí hacemos una verificación simple por último timestamp:
    ts = get_last_processed_timestamp()
    if not ts:
        print("No se encontraron predicciones en la tabla empleado_prediccion.")
        return
    print("Última marca actualizado_at encontrada:", ts)
    cnt = count_preds_at_timestamp(ts)
    print(f"Predicciones insertadas (aprox.) en la marca {ts}: {cnt}")
    print("Últimas predicciones (muestra):")
    for r in list_recent_preds(20):
        print(r)
    print("\nSi el número coincide con las filas del CSV procesado, la inserción fue exitosa.")

if __name__ == "__main__":
    main()
