# Experiment pipeline.
#
# `make all` runs every stage in order. Each stage writes to a named path and
# the next reads it, so a partial rerun is possible and no stage can depend on
# another's in-memory state.

PY := .venv/bin/python
PIP := .venv/bin/pip

# Pinned. scikit-learn 1.3.2 and numpy 1.26.4 have no wheels for 3.13 or 3.14,
# and building them from source is not a reasonable reproduction step. See
# docs/DECISIONS.md D-007.
PYTHON ?= python3.11

.PHONY: help setup sample features split train evaluate report all clean distclean

help:
	@echo "setup      create the virtualenv and install pinned dependencies"
	@echo "sample     generate a development stand-in for PaySim"
	@echo "features   build the eighteen-feature matrix and proxy_spec.md"
	@echo "split      write the one 70:15:15 partition every stage reads"
	@echo "train      fit every candidate, save models, params and checksums"
	@echo "evaluate   score the held-out test partition, save probabilities"
	@echo "report     derive every figure and table from those probabilities"
	@echo "all        features -> split -> train -> evaluate -> report"

.venv:
	@command -v $(PYTHON) >/dev/null 2>&1 || { \
		echo "$(PYTHON) not found. Install it, or override: make setup PYTHON=python3.12"; \
		exit 1; }
	$(PYTHON) -m venv .venv
	$(PIP) install --quiet --upgrade pip

setup: .venv
	$(PIP) install --quiet -r requirements.txt
	@echo "installed:"
	@$(PY) -c "import sklearn, imblearn, numpy, pandas; \
		print('  scikit-learn', sklearn.__version__); \
		print('  imbalanced-learn', imblearn.__version__); \
		print('  numpy', numpy.__version__); \
		print('  pandas', pandas.__version__)"

sample:
	$(PY) scripts/make_sample_paysim.py

features:
	$(PY) -m smartguard_ml.pipeline features

split:
	$(PY) -m smartguard_ml.pipeline split

train:
	$(PY) -m smartguard_ml.pipeline train

evaluate:
	$(PY) -m smartguard_ml.pipeline evaluate

report:
	$(PY) -m smartguard_ml.pipeline report

all:
	$(PY) -m smartguard_ml.pipeline all

clean:
	rm -rf artifacts/*.joblib artifacts/*.parquet artifacts/*.npz data/interim/*

distclean: clean
	rm -rf .venv outputs/figures/* outputs/tables/* outputs/*.json
