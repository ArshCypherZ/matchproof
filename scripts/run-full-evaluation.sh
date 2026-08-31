#!/usr/bin/env bash

set -Eeuo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$repository_root"

run_id=$(date -u +%Y%m%dT%H%M%SZ)
archive_dir="evaluation/archive/$run_id"
log_file="evaluation/logs/full-evaluation-$run_id.log"
report_file="evaluation/full-evaluation.json"
audit_file="evaluation/full-evaluation-audit.jsonl"
archived_report="$archive_dir/evaluation/full-evaluation.json"
archived_audit="$archive_dir/evaluation/full-evaluation-audit.jsonl"
run_succeeded=0

mkdir -p -- evaluation/logs "$archive_dir/evaluation"

if [[ -f "$report_file" ]]; then
  mv -- "$report_file" "$archived_report"
fi

if [[ -f "$audit_file" ]]; then
  mv -- "$audit_file" "$archived_audit"
fi

restore_previous_results() {
  local exit_status=$?
  trap - EXIT

  if ((run_succeeded == 0)); then
    if [[ -f "$report_file" ]]; then
      mv -- "$report_file" "$archive_dir/evaluation/failed-full-evaluation.json"
    fi
    if [[ -f "$audit_file" ]]; then
      mv -- "$audit_file" "$archive_dir/evaluation/failed-full-evaluation-audit.jsonl"
    fi
    if [[ -f "$archived_report" ]]; then
      mv -- "$archived_report" "$report_file"
    fi
    if [[ -f "$archived_audit" ]]; then
      mv -- "$archived_audit" "$audit_file"
    fi
    printf 'Evaluation failed or was interrupted. Previous published results were restored.\n' >&2
    printf 'Inspect the run log: %s\n' "$log_file" >&2
  fi

  exit "$exit_status"
}

trap restore_previous_results EXIT

printf 'Starting fresh Groq evaluation. Run ID: %s\n' "$run_id"

GROQ_MODEL=qwen/qwen3.8-27b \
  pnpm run evaluate:full 2>&1 | tee -- "$log_file"

[[ -s "$report_file" ]]
[[ -s "$audit_file" ]]

run_succeeded=1

printf 'Evaluation completed successfully.\n'
printf 'JSON report: %s\n' "$report_file"
printf 'Raw audit JSONL: %s\n' "$audit_file"
printf 'Execution log: %s\n' "$log_file"
printf 'Previous results archive: %s\n' "$archive_dir"
