import importlib, traceback, sys

try:
    importlib.import_module('predictor_api')
    print('IMPORT OK')
except Exception:
    traceback.print_exc()
    sys.exit(1)
