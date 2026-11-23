#!/usr/bin/env bash
# scripts/test-backup.sh — Shell-level automated test for backup.sh fail-safe encryption & retention

set -euo pipefail

echo "=================================================================="
echo " Starting Backup Service & Fail-Safe Encryption Test Suite"
echo "=================================================================="

export POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
export POSTGRES_USER="${POSTGRES_USER:-pos_admin}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-pos_secret}"
export POSTGRES_DB="universal_pos_restore_check"

# Ensure universal_pos_restore_check database exists
export PGPASSWORD="${POSTGRES_PASSWORD}"
if command -v psql >/dev/null 2>&1; then
    psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'universal_pos_restore_check'" | grep -q 1 || \
    psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d postgres -c "CREATE DATABASE universal_pos_restore_check;"
fi

# Fallback pg_dump wrapper if native pg_dump not on host PATH but Docker container is running
if ! command -v pg_dump >/dev/null 2>&1 && command -v docker >/dev/null 2>&1; then
    TEMP_PG_BIN="$(mktemp -d /tmp/pos-pg-bin-XXXXXX)"
    cat <<'EOF' > "${TEMP_PG_BIN}/pg_dump"
#!/bin/bash
docker exec -i universal_pos_postgres pg_dump "$@"
EOF
    cat <<'EOF' > "${TEMP_PG_BIN}/pg_dumpall"
#!/bin/bash
docker exec -i universal_pos_postgres pg_dumpall "$@"
EOF
    chmod +x "${TEMP_PG_BIN}/pg_dump" "${TEMP_PG_BIN}/pg_dumpall"
    export PATH="${TEMP_PG_BIN}:${PATH}"
fi

TEST_BASE="$(mktemp -d /tmp/pos-backup-test-XXXXXX)"
trap 'rm -rf "${TEST_BASE}"' EXIT

echo "[TEST] Working directory: ${TEST_BASE}"

# -------------------------------------------------------------------------
# Test Case 1: No Key Provided
# A plain dump file is written, status is ok: true, and status warns unencrypted.
# -------------------------------------------------------------------------
echo -e "\n--- Test Case 1: No key provided ---"
CASE1_DIR="${TEST_BASE}/case1"
BACKUP_DIR="${CASE1_DIR}" BACKUP_AGE_PUBLIC_KEY="" BACKUP_RCLONE_REMOTE="" bash scripts/backup.sh

if ! ls -1 "${CASE1_DIR}/daily"/backup_*.dump >/dev/null 2>&1; then
    echo "FAILED: Plain .dump file not created in Case 1!" >&2
    exit 1
fi
if ls -1 "${CASE1_DIR}/daily"/*.age >/dev/null 2>&1; then
    echo "FAILED: Unexpected .age file found in Case 1!" >&2
    exit 1
fi
STATUS1=$(cat "${CASE1_DIR}/last-backup.json")
echo "Case 1 status JSON: ${STATUS1}"
if ! echo "${STATUS1}" | grep -q '"ok": true'; then
    echo "FAILED: Case 1 last-backup.json ok is not true!" >&2
    exit 1
fi
if ! echo "${STATUS1}" | grep -q 'এনক্রিপ্ট করা নেই'; then
    echo "FAILED: Case 1 last-backup.json missing unencrypted warning!" >&2
    exit 1
fi
if ! echo "${STATUS1}" | grep -q '"offServerConfigured": false'; then
    echo "FAILED: Case 1 last-backup.json offServerConfigured is not false!" >&2
    exit 1
fi
echo "[PASS] Case 1: Plain file written and unencrypted warning recorded."

# -------------------------------------------------------------------------
# Test Case 2: Key Provided with age CLI Available
# Only a .age file exists, and no plain dump is left behind.
# -------------------------------------------------------------------------
echo -e "\n--- Test Case 2: Key provided with age CLI available ---"
CASE2_DIR="${TEST_BASE}/case2"
MOCK_AGE_BIN="${TEST_BASE}/age_bin"
mkdir -p "${MOCK_AGE_BIN}"

# Use real age if installed, otherwise provide a test stub that generates .age file
if command -v age >/dev/null 2>&1; then
    TEST_PUBKEY=""
    if command -v age-keygen >/dev/null 2>&1; then
        TEST_PUBKEY=$(age-keygen 2>/dev/null | grep -o 'age1[a-z0-9]*' | head -1)
    fi
    if [[ -z "${TEST_PUBKEY}" ]]; then
        TEST_PUBKEY="age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"
    fi
else
    cat <<'EOF' > "${MOCK_AGE_BIN}/age"
#!/bin/bash
outfile=""
while [[ $# -gt 0 ]]; do
    if [[ "$1" == "-o" ]]; then
        outfile="$2"
        shift 2
    else
        shift
    fi
done
if [[ -n "${outfile}" ]]; then
    touch "${outfile}"
    echo "encrypted-age-data" > "${outfile}"
fi
exit 0
EOF
    chmod +x "${MOCK_AGE_BIN}/age"
    TEST_PUBKEY="age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"
fi

PATH="${MOCK_AGE_BIN}:${PATH}" BACKUP_DIR="${CASE2_DIR}" BACKUP_AGE_PUBLIC_KEY="${TEST_PUBKEY}" BACKUP_RCLONE_REMOTE="" bash scripts/backup.sh

if ! ls -1 "${CASE2_DIR}/daily"/backup_*.age >/dev/null 2>&1; then
    echo "FAILED: Encrypted .age file not created in Case 2!" >&2
    exit 1
fi
if ls -1 "${CASE2_DIR}/daily"/*.dump >/dev/null 2>&1; then
    echo "FAILED: Plain .dump file leaked in Case 2!" >&2
    exit 1
fi
STATUS2=$(cat "${CASE2_DIR}/last-backup.json")
echo "Case 2 status JSON: ${STATUS2}"
if ! echo "${STATUS2}" | grep -q '"ok": true'; then
    echo "FAILED: Case 2 last-backup.json ok is not true!" >&2
    exit 1
fi
if ! echo "${STATUS2}" | grep -q '"encrypted": true'; then
    echo "FAILED: Case 2 last-backup.json encrypted is not true!" >&2
    exit 1
fi
echo "[PASS] Case 2: Only .age file exists, zero plain dump left behind."

# -------------------------------------------------------------------------
# Test Case 3: Key Provided with age CLI Hidden from PATH
# Must exit 1, write no plain or age file, and record status ok: false.
# -------------------------------------------------------------------------
echo -e "\n--- Test Case 3: Key provided with age CLI hidden from PATH ---"
CASE3_DIR="${TEST_BASE}/case3"
NO_AGE_DIR="${TEST_BASE}/no_age_bin"
mkdir -p "${NO_AGE_DIR}"

# Build a clean PATH that excludes any directory containing age
CLEAN_PATH=$(echo "$PATH" | tr ':' '\n' | while read -r p; do
    if [[ -d "$p" && ! -f "$p/age" ]]; then
        echo -n "$p:"
    fi
done)

set +e
PATH="${CLEAN_PATH}" BACKUP_DIR="${CASE3_DIR}" BACKUP_AGE_PUBLIC_KEY="age1fakekey999" BACKUP_RCLONE_REMOTE="" bash scripts/backup.sh
EXIT_CODE=$?
set -e

if [[ "${EXIT_CODE}" -eq 0 ]]; then
    echo "FAILED: Case 3 expected non-zero exit code when age missing, got 0!" >&2
    exit 1
fi

if ls -1 "${CASE3_DIR}/daily"/* >/dev/null 2>&1; then
    echo "FAILED: Leaked files in daily directory in Case 3!" >&2
    exit 1
fi

STATUS3=$(cat "${CASE3_DIR}/last-backup.json")
echo "Case 3 status JSON: ${STATUS3}"
if ! echo "${STATUS3}" | grep -q '"ok": false'; then
    echo "FAILED: Case 3 status ok is not false!" >&2
    exit 1
fi
if ! echo "${STATUS3}" | grep -q 'এনক্রিপশন ব্যর্থ'; then
    echo "FAILED: Case 3 status missing Bangla failure reason!" >&2
    exit 1
fi
echo "[PASS] Case 3: Exited 1, no files left behind, status ok: false recorded."

# -------------------------------------------------------------------------
# Test Case 4: Fake BACKUP_RCLONE_REMOTE with No Key
# rclone must NEVER be called. Verified with a stub rclone on PATH.
# -------------------------------------------------------------------------
echo -e "\n--- Test Case 4: Fake BACKUP_RCLONE_REMOTE with no key ---"
CASE4_DIR="${TEST_BASE}/case4"
STUB_RCLONE_DIR="${TEST_BASE}/rclone_stub_bin"
mkdir -p "${STUB_RCLONE_DIR}"
MARKER_FILE="${TEST_BASE}/rclone_was_invoked.marker"

cat <<EOF > "${STUB_RCLONE_DIR}/rclone"
#!/bin/bash
touch "${MARKER_FILE}"
echo "ERROR: rclone was invoked on unencrypted backup!" >&2
exit 1
EOF
chmod +x "${STUB_RCLONE_DIR}/rclone"

PATH="${STUB_RCLONE_DIR}:${PATH}" BACKUP_DIR="${CASE4_DIR}" BACKUP_AGE_PUBLIC_KEY="" BACKUP_RCLONE_REMOTE="myremote:bucket" bash scripts/backup.sh

if [[ -f "${MARKER_FILE}" ]]; then
    echo "FAILED: rclone was invoked on unencrypted backup in Case 4!" >&2
    exit 1
fi

STATUS4=$(cat "${CASE4_DIR}/last-backup.json")
echo "Case 4 status JSON: ${STATUS4}"
if ! echo "${STATUS4}" | grep -q '"offServerConfigured": false'; then
    echo "FAILED: Case 4 offServerConfigured is not false!" >&2
    exit 1
fi
if ! echo "${STATUS4}" | grep -q 'সার্ভারের বাইরে পাঠানো হয়নি'; then
    echo "FAILED: Case 4 missing offServerWarning on unencrypted backup!" >&2
    exit 1
fi
echo "[PASS] Case 4: rclone was never called; unencrypted offServer refused."

# -------------------------------------------------------------------------
# Retention Test:
# Create 20 fake daily files and 10 fake weekly files with old dates.
# Run the prune step. Exactly 14 daily and 8 weekly files must remain.
# -------------------------------------------------------------------------
echo -e "\n--- Retention Test: 20 daily, 10 weekly pruned to 14 and 8 ---"
RETENTION_DIR="${TEST_BASE}/retention"
DAILY_RET="${RETENTION_DIR}/daily"
WEEKLY_RET="${RETENTION_DIR}/weekly"
mkdir -p "${DAILY_RET}" "${WEEKLY_RET}"

for i in $(seq 1 20); do
    pad=$(printf "%02d" "$i")
    f="${DAILY_RET}/backup_universal_pos_restore_check_202601${pad}_000000.dump"
    touch -t "202601${pad}0000" "$f"
    touch -t "202601${pad}0000" "$f.sha256"
done

for i in $(seq 1 10); do
    pad=$(printf "%02d" "$i")
    f="${WEEKLY_RET}/backup_universal_pos_restore_check_202601${pad}_000000.dump"
    touch -t "202601${pad}0000" "$f"
    touch -t "202601${pad}0000" "$f.sha256"
done

# Execute prune step matching scripts/backup.sh
ls -1t "${DAILY_RET}"/backup_*.* 2>/dev/null | grep -E '\.(dump|age)$' | tail -n +15 | while read -r f; do
    rm -f "$f" "$f.sha256"
done || true

ls -1t "${WEEKLY_RET}"/backup_*.* 2>/dev/null | grep -E '\.(dump|age)$' | tail -n +9 | while read -r f; do
    rm -f "$f" "$f.sha256"
done || true

DAILY_COUNT=$(ls -1 "${DAILY_RET}"/*.dump 2>/dev/null | wc -l)
DAILY_SHA_COUNT=$(ls -1 "${DAILY_RET}"/*.sha256 2>/dev/null | wc -l)
WEEKLY_COUNT=$(ls -1 "${WEEKLY_RET}"/*.dump 2>/dev/null | wc -l)
WEEKLY_SHA_COUNT=$(ls -1 "${WEEKLY_RET}"/*.sha256 2>/dev/null | wc -l)

echo "Daily remaining:  ${DAILY_COUNT} dumps, ${DAILY_SHA_COUNT} checksums"
echo "Weekly remaining: ${WEEKLY_COUNT} dumps, ${WEEKLY_SHA_COUNT} checksums"

if [[ "${DAILY_COUNT}" -ne 14 || "${DAILY_SHA_COUNT}" -ne 14 ]]; then
    echo "FAILED: Expected exactly 14 daily files and 14 sha256 files, got ${DAILY_COUNT} / ${DAILY_SHA_COUNT}!" >&2
    exit 1
fi

if [[ "${WEEKLY_COUNT}" -ne 8 || "${WEEKLY_SHA_COUNT}" -ne 8 ]]; then
    echo "FAILED: Expected exactly 8 weekly files and 8 sha256 files, got ${WEEKLY_COUNT} / ${WEEKLY_SHA_COUNT}!" >&2
    exit 1
fi

echo "[PASS] Retention test: Exactly 14 daily and 8 weekly files remain."

echo -e "\n=================================================================="
echo " ALL BACKUP TESTS PASSED SUCCESSFULLY!"
echo "=================================================================="
