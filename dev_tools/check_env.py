# check_env.py
modules = ["pandas","numpy","sklearn","joblib","unidecode","requests"]
missing = []
for m in modules:
    try:
        mod = __import__(m)
        ver = getattr(mod, "__version__", "unknown")
        print(f"{m}: OK (version {ver})")
    except Exception as e:
        print(f"{m}: FAIL ({e})")
        missing.append(m)
if missing:
    print("\nPaquetes faltantes:", missing)
    print("Instálalos con: python -m pip install " + " ".join(missing))
else:
    print("\nTodo instalado.")
