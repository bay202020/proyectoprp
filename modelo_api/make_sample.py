import joblib, json
cols = joblib.load("columnas_entrenamiento.pkl")
row = {}
for c in cols:
    if 'id' in c.lower() or 'employee' in c.lower():
        row[c] = "E001"
    else:
        row[c] = 0
with open('sample_request.json','w',encoding='utf-8') as f:
    json.dump({"rows":[row]}, f, indent=2, ensure_ascii=False)
print("WROTE sample_request.json — tamaño:", len(cols))
