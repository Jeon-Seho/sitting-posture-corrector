# Every target runs tools/dev.py so Windows, macOS and Linux share one implementation.
# Without make: python tools/dev.py <target>
ifeq ($(OS),Windows_NT)
PYTHON ?= python
else
PYTHON ?= python3
endif

.PHONY: setup setup-python setup-frontend check check-repo test check-frontend check-board dev board

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

board:
	$(PYTHON) tools/dev.py board

check-board:
	$(PYTHON) tools/dev.py check-board
