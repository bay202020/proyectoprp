# process_uploads.py - Versión modificada para aceptar .csv, .xlsx y .xls
# Fuente: proceso original del usuario (modificado). :contentReference[oaicite:0]{index=0}

#!/usr/bin/env python3
"""
process_uploads.py - Versión final con mapeo ampliado de horas_extras y genero + defaults.
"""
import os
import time
import json
import shutil
import math
import logging
import uuid
from pathlib import Path
from datetime import datetime
from decimal import Decimal
from typing import Any
import requests
import pandas as pd
import numpy as np

# ----------------------------
# Configuración
# ----------------------------
ROOT = Path(__file__).parent
UPLOADS_DIR = ROOT / "uploads"
PROCESSED_DIR = ROOT / "processed"
LOGS_DIR = ROOT / "logs"
BAD_ROWS_FILE = ROOT / "bad_rows_no_id.jsonl"

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)
BAD_ROWS_FILE.touch(exist_ok=True)

BACKEND_EMPS_URL = os.environ.get("BACKEND_EMPS_URL", "http://127.0.0.1:3000/api/empleados_raw/bulk")
PREDICT_URL = os.environ.get("PREDICT_URL", "http://127.0.0.1:8000/predict")
BACKEND_PRED_URL = os.environ.get("BACKEND_PRED_URL", "http://127.0.0.1:3000/api/predictions/bulk")

EMP_CHUNK = int(os.environ.get("EMP_CHUNK", "400"))   # empleados por POST al backend
BATCH = int(os.environ.get("PRED_BATCH", "200"))     # filas enviadas al predictor por POST
PRED_CHUNK = int(os.environ.get("PRED_CHUNK", "500")) # predicciones por POST al backend

# DEFAULTS solicitados
DEFAULT_TEXT = "Vacio-Nada"
DEFAULT_NUM = 0
DEFAULT_DATE = "1900-01-01"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ----------------------------
# Sanitización robusta
# ----------------------------
def sanitize_value_for_json(v: Any, default=None):
    try:
        if hasattr(v, "item") and not isinstance(v, (str, bytes, bytearray)):
            try:
                v = v.item()
            except Exception:
                pass

        if isinstance(v, Decimal):
            try:
                f = float(v)
                if math.isfinite(f):
                    return f
                return default
            except Exception:
                return str(v)

        if isinstance(v, (bytes, bytearray)):
            try:
                return v.decode('utf-8', errors='ignore')
            except Exception:
                return str(v)

        if isinstance(v, str):
            s = v.strip()
            if s == "":
                return default
            sl = s.lower()
            if sl in ("nan", "none", "null", "na", "n/a", "inf", "+inf", "-inf"):
                return default
            return s

        if isinstance(v, float):
            if math.isnan(v) or math.isinf(v) or abs(v) > 1e308:
                return default
            return float(v)

        if isinstance(v, (int, bool)):
            return v

        if isinstance(v, (np.ndarray,)):
            return sanitize_value_for_json(v.tolist(), default)

        if isinstance(v, (list, tuple)):
            return [sanitize_value_for_json(x, default) for x in v]

        if isinstance(v, dict):
            return {str(k): sanitize_value_for_json(val, default) for k, val in v.items()}

        if v is None:
            return default

        return str(v)
    except Exception:
        return default

def sanitize_obj(obj):
    if isinstance(obj, dict):
        return {k: sanitize_obj(sanitize_value_for_json(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_obj(sanitize_value_for_json(v)) for v in obj]
    return sanitize_value_for_json(obj)

# ----------------------------
# HTTP helper with retries
# ----------------------------
def post_with_retries(url, json_payload, timeout=60, max_attempts=3):
    attempt = 0
    delay = 2
    last_exc = None
    safe_payload = sanitize_obj(json_payload)
    for attempt in range(1, max_attempts + 1):
        try:
            r = requests.post(url, json=safe_payload, timeout=timeout)
            r.raise_for_status()
            return r
        except Exception as e:
            last_exc = e
            try:
                if 'r' in locals() and hasattr(r, 'text'):
                    logging.warning("Server response (truncated): %s", r.text[:2000])
            except Exception:
                pass
            logging.warning("WARN: POST failed to %s (attempt %d/%d): %s. Retrying in %ds", url, attempt, max_attempts, str(e), delay)
            time.sleep(delay)
            delay *= 2
    raise last_exc

# ----------------------------
# utils: list and move files
# ----------------------------
def listar_csv():
    """
    Lista archivos en uploads que sean .csv, .xlsx o .xls (ordenados).
    """
    exts = {".csv", ".xlsx", ".xls"}
    files = sorted([p for p in UPLOADS_DIR.iterdir() if p.is_file() and p.suffix.lower() in exts])
    return files

def mover_a_processed(path_csv):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = PROCESSED_DIR / f"{path_csv.name}.processed_{ts}"
    shutil.move(str(path_csv), str(dest))
    return dest

# ----------------------------
# Main file processing
# ----------------------------
def procesar_archivo(path_csv: Path):
    logging.info("Procesando %s", path_csv)
    try:
        ext = path_csv.suffix.lower()
        if ext == ".csv":
            df = pd.read_csv(
                path_csv,
                dtype=str,
                encoding='utf-8',
                on_bad_lines='skip',
                engine='python'
            )
        elif ext in (".xlsx", ".xls"):
            # Try openpyxl for xlsx; for xls fallback to xlrd if available
            if ext == ".xlsx":
                df = pd.read_excel(path_csv, dtype=str, engine="openpyxl")
            else:
                # .xls
                try:
                    df = pd.read_excel(path_csv, dtype=str, engine="xlrd")
                except Exception:
                    # fallback: try openpyxl (may fail for .xls but keep attempt)
                    df = pd.read_excel(path_csv, dtype=str, engine="openpyxl")
        else:
            logging.error("Formato no soportado: %s", ext)
            return False
    except Exception as e:
        logging.error("ERROR leyendo archivo %s: %s", path_csv, e)
        return False

    df = df.fillna(value="")

    registros = df.to_dict(orient='records')
    n = len(registros)
    logging.info(" Filas leídas: %d", n)

    empleados_to_send = []

    id_candidates = [
        "employee_id","id","id_empleado","empleadoid","empleado_id","empleado",
        "codigo","codigo_empleado","codigoempleado","no","no_empleado","numero",
        "dni","dui","cedula","employeeid","emp_id","matricula","legajo"
    ]

    # alias para horas_extras y genero
    horas_aliases = ["horas_extras","horas","extra_hours","extra_hours_worked","overtime","overtime_hours","hrs_extra"]
    gender_aliases = ["genero","sexo","gender","sex"]

    for row in registros:
        # normalize keys: lower, strip, remove BOM if present
        norm_row = {}
        for k, v in row.items():
            if k is None:
                continue
            key = str(k).strip().lower().replace('\ufeff', '')
            norm_row[key] = v

        emp = {}

        # find employee_id robustly
        emp_id = None
        for cand in id_candidates:
            if cand in norm_row and str(norm_row[cand]).strip() != "":
                emp_id = str(norm_row[cand]).strip()
                break
        if not emp_id:
            for k in norm_row.keys():
                if any(tok in k for tok in ("id", "codigo", "dni", "dui", "legajo", "numero")) and str(norm_row[k]).strip() != "":
                    emp_id = str(norm_row[k]).strip()
                    break

        def get_any(*candidates, default=None):
            for c in candidates:
                k = c.strip().lower()
                if k in norm_row and str(norm_row[k]).strip() != "":
                    return norm_row[k]
            return default

        emp["employee_id"] = emp_id
        emp["nombre"] = get_any("nombre","nombres","name","full_name","nombre_empleado","empleado","nombre_empleado")
        emp["departamento"] = get_any("departamento","dept","area","department","division") or get_any("departmento","departament")
        emp["fecha_ingreso"] = get_any("fecha_ingreso","start_date","fecha_ingreso")

        # genero detection and normalization
        gender_val = None
        for a in gender_aliases:
            if a in norm_row and str(norm_row[a]).strip() != "":
                gender_val = norm_row[a].strip()
                break
        if gender_val:
            g = str(gender_val).strip().lower()
            if g.startswith('f') or 'fem' in g or 'female' in g:
                emp["genero"] = "Femenino"
            elif g.startswith('m') or 'masc' in g or 'male' in g:
                emp["genero"] = "Masculino"
            else:
                emp["genero"] = "Otro"
        else:
            emp["genero"] = "No declarado"

        # salario detection
        salario_val = get_any("salario","ingresos_mensuales","salario_por_hora","salario_por_hora","ingresos_mensuales")
        sal = None
        if salario_val:
            try:
                s = str(salario_val).replace(",",".").strip()
                if any(k in s.lower() for k in ["por_hora","hora","h/","/h","hour"]):
                    import re
                    m = re.search(r"([0-9]+(?:\.[0-9]+)?)", s)
                    if m:
                        sal = round(float(m.group(1)) * 160, 2)
                else:
                    import re
                    m = re.search(r"([0-9]+(?:\.[0-9]+)?)", s)
                    if m:
                        sal = round(float(m.group(1)), 2)
            except Exception:
                sal = None
        emp["salario"] = sal

        # satisfaccion
        sat_val = get_any("satisfaccion","satisfaccion_conel_entorno","satisfaction","sastisfacion_laboral","satisfaccion_laboral")
        try:
            emp["satisfaccion"] = float(str(sat_val).replace(",",".").strip()) if sat_val and str(sat_val).strip()!="" else None
        except Exception:
            emp["satisfaccion"] = None

        emp["puesto"] = get_any("puesto","rol_del_puesto","position","cargo")
        try:
            edad_val = get_any("edad","age")
            emp["edad"] = int(str(edad_val).strip()) if edad_val and str(edad_val).strip()!="" else None
        except Exception:
            emp["edad"] = None
        try:
            ant = get_any("antiguedad_meses","años_trabaja","años_enla_empr","años_enel","antiguedad")
            emp["antiguedad_meses"] = int(str(ant).strip()) if ant and str(ant).strip()!="" else None
        except Exception:
            emp["antiguedad_meses"] = None

        # HORAS_EXTRAS: buscar alias en norm_row
        horas_val = None
        for a in horas_aliases:
            if a in norm_row and str(norm_row[a]).strip() != "":
                horas_val = norm_row[a]
                break
        try:
            if horas_val is None or str(horas_val).strip() == "":
                emp["horas_extras"] = None
            else:
                emp["horas_extras"] = int(float(str(horas_val).replace(",",".").strip()))
        except Exception:
            emp["horas_extras"] = None

        # capture other keys
        others = {}
        reserved = {"employee_id","id","nombre","nombres","name","departamento","area","fecha_ingreso",
                    "salario","satisfaccion","puesto","edad","antiguedad_meses","antiguedad","horas_extras","genero"}
        for k, v in norm_row.items():
            if k not in reserved and v is not None and str(v).strip() != "":
                others[k] = v

        # if emp_id missing -> record bad row and generate fallback id (temporary)
        if not emp.get("employee_id"):
            try:
                with open(BAD_ROWS_FILE, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            except Exception:
                pass
            gen_id = f"auto_{uuid.uuid4().hex[:12]}"
            emp["employee_id"] = gen_id
            others["generated_employee_id"] = True

        # if nombre missing -> generate placeholder and mark
        if not emp.get("nombre"):
            gen_name = f"sin_nombre_{uuid.uuid4().hex[:8]}"
            emp["nombre"] = gen_name
            others["generated_nombre"] = True

        # -------------------------
        # VALORES POR DEFECTO (no enviar NULLs)
        # -------------------------
        # texto defaults
        for col in ["employee_id", "nombre", "departamento", "puesto", "rol_del_puesto", "genero"]:
            if not emp.get(col):
                emp[col] = DEFAULT_TEXT
                others.setdefault("fields_autofilled", []).append(col) if isinstance(others, dict) else None

        # numeric defaults (convertir si posible)
        for col in ["antiguedad_meses", "salario", "satisfaccion", "ingresos_mensuales", "horas_extras", "edad"]:
            v = emp.get(col)
            try:
                if v is None or str(v).strip()=="":
                    emp[col] = DEFAULT_NUM
                    others.setdefault("fields_autofilled", []).append(col)
                else:
                    emp[col] = float(v)
            except Exception:
                emp[col] = DEFAULT_NUM
                others.setdefault("fields_autofilled", []).append(col)

        # fecha default
        if not emp.get("fecha_ingreso"):
            emp["fecha_ingreso"] = DEFAULT_DATE
            others.setdefault("fields_autofilled", []).append("fecha_ingreso")

        # ensure otros is dict
        if not isinstance(others, dict):
            others = {}
        emp["otros"] = others

        empleados_to_send.append(emp)

    # chunk helper
    def chunks(lst, size):
        for i in range(0, len(lst), size):
            yield lst[i:i+size]

    # send employees to backend in chunks
    empleados_failed = False
    for chunk in chunks(empleados_to_send, EMP_CHUNK):
        payload = {"empleados": [sanitize_obj(e) for e in chunk]}
        try:
            r = post_with_retries(BACKEND_EMPS_URL, payload, timeout=60, max_attempts=3)
            logging.info("   Empleados guardados chunk: %s -> status %s", len(chunk), r.status_code)
        except Exception as e:
            empleados_failed = True
            logging.warning("   WARN: no se pudieron guardar empleados: %s", e)

    if empleados_failed:
        logging.warning("Se detectaron errores guardando empleados; abortando predicción para este archivo.")
        return False

    # call predictor in batches
    resultados_finales = []
    for i in range(0, n, BATCH):
        lote = registros[i:i + BATCH]
        try:
            payload = {"rows": [sanitize_obj({k: (v if (v is not None and str(v).strip() != '') else None) for k, v in r.items()}) for r in lote]}
            r = post_with_retries(PREDICT_URL, payload, timeout=120, max_attempts=3)
            resp = r.json()
            results = resp.get("results", []) if isinstance(resp, dict) else []
            logging.info("   Lote %d: enviados %d → predicciones recibidas %d", (i // BATCH) + 1, len(lote), len(results))
            for item in results:
                employee_id = item.get("employee_id") or item.get("index") or None
                pred = item.get("prediccion") if item.get("prediccion") is not None else item.get("prediction")
                prob = item.get("probabilidad") if item.get("probabilidad") is not None else item.get("prob")
                prob_val = None
                try:
                    if prob is not None:
                        pv = float(prob)
                        prob_val = pv if math.isfinite(pv) else None
                except Exception:
                    prob_val = None
                resultados_finales.append({
                    "employee_id": employee_id,
                    "prediccion": int(pred) if pred is not None else None,
                    "probabilidad": prob_val,
                    "nombre": item.get("nombre") or None,
                    "departamento": item.get("departamento") or None,
                    "fecha_ingreso": item.get("fecha_ingreso") or None,
                    "antiguedad_meses": item.get("antiguedad_meses") or None,
                    "salario": item.get("salario") or None,
                    "satisfaccion": item.get("satisfaccion") or None
                })
        except Exception as e:
            logging.error("   ERROR al llamar al predictor: %s", e)
            return False

    # send predictions to backend in chunks
    for chunk in chunks(resultados_finales, PRED_CHUNK):
        payload_preds = {"predictions": [sanitize_obj(p) for p in chunk]}
        try:
            r = post_with_retries(BACKEND_PRED_URL, payload_preds, timeout=60, max_attempts=3)
            logging.info("   Predicciones guardadas chunk: %s -> %s", len(chunk), r.status_code)
        except Exception as e:
            logging.error("   ERROR enviando al backend: %s", e)
            return False

    # move file to processed
    dest = mover_a_processed(path_csv)
    logging.info("   Archivo movido a → %s", dest)
    return True

# ----------------------------
# Main loop
# ----------------------------
def main_once():
    archivos = listar_csv()
    logging.info("Archivos encontrados: %d", len(archivos))
    for f in archivos:
        try:
            procesar_archivo(f)
        except Exception as e:
            logging.exception("Error procesando archivo %s: %s", f, e)

def main_loop():
    while True:
        try:
            main_once()
        except Exception as e:
            logging.exception("Error en main_loop: %s", e)
        time.sleep(5)

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--loop", action="store_true", help="Ejecutar en loop (monitor uploads)")
    p.add_argument("--once", action="store_true", help="Procesar una vez y salir")
    args = p.parse_args()
    if args.loop:
        main_loop()
    else:
        main_once()
