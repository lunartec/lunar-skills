#!/usr/bin/env bash
set -euo pipefail
source "./common.sh"
git tag "v$1" && git push --tags
