# Every target runs tools/dev.py so Windows, macOS and Linux share one implementation.
# Without make: python tools/dev.py <target>
ifeq ($(OS),Windows_NT)
PYTHON ?= python
else
PYTHON ?= python3
endif

.PHONY: setup setup-python setup-frontend check check-local init-compose test check-frontend check-backend dev dev-api dev-inference dev-server

setup:
	$(PYTHON) tools/dev.py setup

setup-python:
	$(PYTHON) tools/dev.py setup-python

setup-frontend:
	$(PYTHON) tools/dev.py setup-frontend

check:
	$(PYTHON) tools/dev.py check

check-local:
	$(PYTHON) tools/dev.py check-local

init-compose:
	$(PYTHON) tools/dev.py init-compose

test:
	$(PYTHON) tools/dev.py test

check-frontend:
	$(PYTHON) tools/dev.py check-frontend

dev:
	$(PYTHON) tools/dev.py dev

check-backend:
	$(PYTHON) tools/dev.py check-backend

dev-api:
	$(PYTHON) tools/dev.py dev-api

dev-inference:
	$(PYTHON) tools/dev.py dev-inference

dev-server:
	$(PYTHON) tools/dev.py dev-server
