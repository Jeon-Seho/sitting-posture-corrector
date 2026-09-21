PYTHON ?= python3
VENV_PYTHON := .venv/bin/python

.PHONY: setup setup-python setup-frontend check check-repo test check-frontend dev

setup: setup-python setup-frontend

setup-python:
	$(PYTHON) -m venv .venv
	$(VENV_PYTHON) -m pip install -r requirements-dev.txt

setup-frontend:
	npm --prefix frontend ci
	npm --prefix frontend run assets

check: check-repo test check-frontend

check-frontend:
	npm --prefix frontend run check

dev:
	npm --prefix frontend run dev

check-repo:
	$(PYTHON) tools/check_repository.py

test:
	@test -x $(VENV_PYTHON) || (echo "Run make setup first"; exit 1)
	$(VENV_PYTHON) -m unittest discover -s tests -v
