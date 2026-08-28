# NitroViewer — a modern web replacement for Tinke, powered by Nds4j.
.DEFAULT_GOAL := help
.PHONY: help jars spike clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

jars: ## Build Nds4j snapshot + facade jar and stage them for CheerpJ
	./scripts/build-jars.sh

spike: jars ## Build jars and serve the CheerpJ spike at http://localhost:8000
	python3 scripts/serve-spike.py 8000

clean: ## Remove Maven build output and staged jars
	mvn -q -f nitroviewer-core/pom.xml clean || true
	rm -f spike/jars/*.jar web/public/jars/*.jar
