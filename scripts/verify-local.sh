#!/usr/bin/env bash
set -Eeuo pipefail

# Local verification: typecheck, lint, format, and unit tests in one pass.
# Pass --live (or set RUN_RAZORPAY_LIVE_E2E=1 with Test-mode credentials in
# .env) to include the Razorpay live end-to-end test.

live=0
if [[ "${1:-}" == "--live" || "${RUN_RAZORPAY_LIVE_E2E:-0}" == "1" ]]; then
  live=1
fi

results=()
run() {
  local label="$1"
  shift
  if "$@"; then
    results+=("PASS $label")
  else
    results+=("FAIL $label")
  fi
}

run "typecheck" pnpm typecheck
run "lint" pnpm lint
run "format" pnpm format:check
run "tests" pnpm test
if [[ "$live" == "1" ]]; then
  run "razorpay live e2e" pnpm test:razorpay:e2e
fi

echo
printf '%s\n' "${results[@]}"
if printf '%s\n' "${results[@]}" | grep -q '^FAIL'; then
  exit 1
fi
