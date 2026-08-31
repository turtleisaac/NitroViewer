# NitroViewer — a modern web replacement for Tinke, powered by Nds4j.
.DEFAULT_GOAL := help
.PHONY: help jars spike build vendor-cheerpj clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

jars: ## Build Nds4j snapshot + facade jar and stage them for CheerpJ
	./scripts/build-jars.sh

spike: jars ## Build jars and serve the CheerpJ spike at http://localhost:8000
	python3 scripts/serve-spike.py 8000

# Packages an Electron app for *this* OS (dmg+zip on macOS, nsis+zip on Windows,
# AppImage+deb+tar.gz on Linux). Default is unsigned; set
# CSC_IDENTITY_AUTO_DISCOVERY=true to sign with a local Developer ID.
# Output lands in release/. CheerpJ is vendored so the app runs fully offline.
CSC_IDENTITY_AUTO_DISCOVERY ?= false
build: jars vendor-cheerpj ## Build the SPA and package the Electron desktop app
	cd web && npm install && npm run build && \
		CSC_IDENTITY_AUTO_DISCOVERY=$(CSC_IDENTITY_AUTO_DISCOVERY) npm run dist
	@echo "Electron artifacts: $(CURDIR)/release/"

vendor-cheerpj: ## Download the CheerpJ 4.3 Java 8 runtime for the Electron bundle
	./scripts/vendor-cheerpj.sh

clean: ## Remove Maven, SPA, staged jars, and Electron packager output
	mvn -q -f nitroviewer-core/pom.xml clean || true
	rm -f spike/jars/*.jar web/public/jars/*.jar
	rm -rf web/dist release
