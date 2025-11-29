# test_predict_local.py — prueba predict_proba localmente (Windows)
import os, joblib, pandas as pd, numpy as np, json

BASE = r"E:\Proyecto IA\modelo_api"
os.chdir(BASE)

# nombres de archivos
CSV = r"E:\Proyecto IA\modelo_api\1764029632440_Empleadosnuevos.csv"  # usa el CSV problemático que tienes
PKL_COLS = "columnas_entrenamiento.pkl"
PKL_SCALER = "scaler_prp.pkl"
PKL_MODEL = "modelo_rotacion_prp.pkl"

print("Cargando CSV:", CSV)
df_raw = pd.read_csv(CSV, dtype=object, low_memory=False)
print("filas,cols:", df_raw.shape)

# función de normalización (misma que en predictor_api)
def normalize_colname(c):
    import unicodedata
    s = str(c).strip().lower()
    s = ''.join(ch for ch in unicodedata.normalize('NFKD', s) if not unicodedata.combining(ch))
    s = s.replace(" ", "_").replace("-", "_")
    s = "".join(ch for ch in s if ch.isalnum() or ch == "_")
    return s

# detectar id
orig_cols = df_raw.columns.tolist()
norm_cols = [normalize_colname(c) for c in orig_cols]
aliases = ["id","id_empleado","employee_id","empleado_id","codigo","dni","doc"]
id_col = None
for c,nc in zip(orig_cols, norm_cols):
    if nc in aliases:
        id_col = c; break

df = df_raw.copy()
if id_col:
    df = df.drop(columns=[id_col])
df.columns = [normalize_colname(c) for c in df.columns]

# limpieza base
replace_map = {"sí":"1","si":"1","s":"1","yes":"1","no":"0","n":"0","true":"1","false":"0"}
for c in df.columns:
    df[c] = df[c].astype(str).str.strip()
    df[c] = df[c].str.replace(r"\s+"," ", regex=True)
    df[c] = df[c].str.replace(",",".")
    df[c] = df[c].replace(replace_map, regex=False)
    # intentar convertir
    df[c] = pd.to_numeric(df[c], errors='coerce')

df_ohe = pd.get_dummies(df, dummy_na=False)
columnas = joblib.load(PKL_COLS)
df_final = pd.DataFrame(0, index=df_ohe.index, columns=columnas)
common = [c for c in df_ohe.columns if c in df_final.columns]
if len(common)>0:
    df_final.loc[:, common] = df_ohe.loc[:, common]
df_final = df_final.fillna(0).astype(float)
print("df_final shape:", df_final.shape)

# cargar scaler y modelo
scaler = joblib.load(PKL_SCALER)
model = joblib.load(PKL_MODEL)
print("Scaler / model cargados. scaler:", type(scaler), "model:", type(model))

# transformar y comprobar
X = df_final.values
Xs = scaler.transform(X)
print("X_scaled shape:", Xs.shape)
print("min,max per first 10 cols:", np.nanmin(Xs[:, :10], axis=0).tolist(), np.nanmax(Xs[:, :10], axis=0).tolist())

# comprobar NaN/inf en Xs
print("Any NaN in Xs:", np.isnan(Xs).any())
print("Any inf in Xs:", np.isinf(Xs).any())

# predecir
pred = model.predict(Xs)
print("pred sample:", pred[:5].tolist())

try:
    prob = model.predict_proba(Xs)[:,1]
    print("prob sample:", prob[:10].tolist())
    print("Any NaN in prob:", np.isnan(prob).any())
except Exception as e:
    print("predict_proba raised:", repr(e))
    # fallback: compute pred only and prob zeros
    prob = np.zeros(len(pred), dtype=float)
    print("Fallback prob zeros used.")

# guarda un resumen
out = {"pred_sample": pred[:10].tolist(), "prob_sample": prob[:10].tolist(), "Xs_nan": bool(np.isnan(Xs).any()), "Xs_inf": bool(np.isinf(Xs).any())}
print(json.dumps(out, indent=2))
