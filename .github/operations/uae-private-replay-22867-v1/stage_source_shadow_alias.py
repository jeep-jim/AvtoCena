import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('archived_stage',Path(__file__).with_name('stage-source-shadow.py'))
stage=importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)
