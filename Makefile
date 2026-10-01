# Every target runs tools/dev.py so Windows, macOS and Linux share one implementation.
# Without make: python tools/dev.py <target>
ifeq ($(OS),Windows_NT)
PYTHON ?= python
else
PYTHON ?= python3
endif

.PHONY: setup setup-python setup-frontend check check-repo test check-frontend check-backend check-browser benchmark-server dev dev-api dev-cep dev-inference dev-server

setup:
	$(PYTHON) tools/dev.py setup

setup-python:
	$(PYTHON) tools/dev.py setup-python

setup-frontend:
	$(PYTHON) tools/dev.py setup-frontend

check:
	$(PYTHON) tools/dev.py check

check-repo:
	$(PYTHON) tools/dev.py check-repo

test:
	$(PYTHON) tools/dev.py test

check-frontend:
	$(PYTHON) tools/dev.py check-frontend

dev:
	$(PYTHON) tools/dev.py dev

check-backend:
	$(PYTHON) tools/dev.py check-backend

check-browser:
	$(PYTHON) tools/dev.py check-browser

benchmark-server:
	$(PYTHON) tools/dev.py benchmark-server

dev-api:
	$(PYTHON) tools/dev.py dev-api

dev-cep:
	$(PYTHON) tools/dev.py dev-cep

dev-inference:
	$(PYTHON) tools/dev.py dev-inference

dev-server:
	$(PYTHON) tools/dev.py dev-server
