# Build, serve and test visit.ee. CI runs `make venv node` then
# `make functional` (pubkit.json's ci block).

PYTHON ?= python3
VENV := .venv

.PHONY: build serve node venv functional lock sync-check clean

build: node
	bin/visit-ee build

serve: node
	bin/visit-ee serve

node: node_modules/.package-lock.json

node_modules/.package-lock.json: package.json package-lock.json
	npm ci

venv: $(VENV)/.done

$(VENV)/.done: tests/requirements.lock
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/pip install --quiet --require-hashes -r tests/requirements.lock
	touch $@

# The Gherkin suite, run against bin/visit-ee.
functional: venv node
	cd tests && VISIT_EE_BIN_DIR=$(CURDIR)/bin ../$(VENV)/bin/pytest -n auto

lock: venv
	$(VENV)/bin/pubkit lock

sync-check: venv
	$(VENV)/bin/pubkit sync --check

clean:
	rm -rf _site $(VENV)
