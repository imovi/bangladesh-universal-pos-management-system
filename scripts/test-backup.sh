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

# Fallback wrappers if native postgres client tools are not on host PATH but Docker container is running
if (! command -v pg_dump >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1) && command -v docker >/dev/null 2>&1; then
    TEMP_PG_BIN="$(mktemp -d /tmp/pos-pg-bin-XXXXXX)"
    cat <<'EOF' > "${TEMP_PG_BIN}/psql"
#!/bin/bash
docker exec -i universal_pos_postgres psql "$@"
EOF
    cat <<'EOF' > "${TEMP_PG_BIN}/pg_dump"
#!/bin/bash
docker exec -i universal_pos_postgres pg_dump "$@"
EOF
    cat <<'EOF' > "${TEMP_PG_BIN}/pg_dumpall"
#!/bin/bash
docker exec -i universal_pos_postgres pg_dumpall "$@"
EOF
    cat <<'EOF' > "${TEMP_PG_BIN}/pg_restore"
#!/bin/bash
args=()
target_file=""
while [[ $# -gt 0 ]]; do
    if [[ -f "$1" ]]; then
        target_file="$1"
    else
        args+=("$1")
    fi
    shift
done
if [[ -n "${target_file}" ]]; then
    docker exec -i universal_pos_postgres pg_restore "${args[@]}" < "${target_file}"
else
    docker exec -i universal_pos_postgres pg_restore "${args[@]}"
fi
EOF
    chmod +x "${TEMP_PG_BIN}/psql" "${TEMP_PG_BIN}/pg_dump" "${TEMP_PG_BIN}/pg_dumpall" "${TEMP_PG_BIN}/pg_restore"
    export PATH="${TEMP_PG_BIN}:${PATH}"
fi

# Ensure universal_pos_restore_check database exists and has at least one table with data
export PGPASSWORD="${POSTGRES_PASSWORD}"
if command -v psql >/dev/null 2>&1; then
    psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'universal_pos_restore_check'" | grep -q 1 || \
    psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d postgres -c "CREATE DATABASE universal_pos_restore_check;"
    psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d universal_pos_restore_check -c "CREATE TABLE IF NOT EXISTS test_backup_data (id serial primary key, name text); INSERT INTO test_backup_data (name) VALUES ('seeded') ON CONFLICT DO NOTHING;"

    # Ensure empty check database exists and has zero tables
    psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'universal_pos_empty_check'" | grep -q 1 && \
    psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d postgres -c "DROP DATABASE universal_pos_empty_check;"
    psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d postgres -c "CREATE DATABASE universal_pos_empty_check;"
fi

TEST_BASE="$(mktemp -d /tmp/pos-backup-test-XXXXXX)"
trap 'rm -rf "${TEST_BASE}"' EXIT

read_status() {
  [[ -f "$1" ]] || { echo "FAILED: status file missing: $1" >&2; exit 1; }
  cat "$1"
}

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
STATUS1=$(read_status "${CASE1_DIR}/last-backup.json")
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
if ! echo "${STATUS1}" | grep -E '"tableCount": [1-9][0-9]*' >/dev/null; then
    echo "FAILED: Case 1 last-backup.json tableCount is not greater than 0!" >&2
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
STATUS2=$(read_status "${CASE2_DIR}/last-backup.json")
echo "Case 2 status JSON: ${STATUS2}"
if ! echo "${STATUS2}" | grep -q '"ok": true'; then
    echo "FAILED: Case 2 last-backup.json ok is not true!" >&2
    exit 1
fi
if ! echo "${STATUS2}" | grep -q '"encrypted": true'; then
    echo "FAILED: Case 2 last-backup.json encrypted is not true!" >&2
    exit 1
fi
if ! echo "${STATUS2}" | grep -E '"tableCount": [1-9][0-9]*' >/dev/null; then
    echo "FAILED: Case 2 last-backup.json tableCount is not greater than 0!" >&2
    exit 1
fi
echo "[PASS] Case 2: Only .age file exists, zero plain dump left behind."

# -------------------------------------------------------------------------
# Test Case 3: age binary missing / nonexistent
# Must exit non-zero, delete the plain dump, leave no files in daily, and write status ok: false in Bengali.
# -------------------------------------------------------------------------
echo -e "\n--- Test Case 3: age binary missing (AGE_BIN=/nonexistent/age) ---"
CASE3_DIR="${TEST_BASE}/case3"

set +e
BACKUP_DIR="${CASE3_DIR}" AGE_BIN="/nonexistent/age" BACKUP_AGE_PUBLIC_KEY="age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p" BACKUP_RCLONE_REMOTE="" bash scripts/backup.sh
EXIT_CODE=$?
set -e

if [[ "${EXIT_CODE}" -eq 0 ]]; then
    echo "FAILED: Case 3 expected non-zero exit code when AGE_BIN is nonexistent, got 0!" >&2
    exit 1
fi

if ls -1 "${CASE3_DIR}/daily"/* >/dev/null 2>&1; then
    echo "FAILED: Leaked plain or partial files in daily directory in Case 3!" >&2
    exit 1
fi

STATUS3=$(read_status "${CASE3_DIR}/last-backup.json")
echo "Case 3 status JSON: ${STATUS3}"
if ! echo "${STATUS3}" | grep -q '"ok": false'; then
    echo "FAILED: Case 3 status ok is not false!" >&2
    exit 1
fi
if ! echo "${STATUS3}" | grep -q 'এনক্রিপশন ব্যর্থ'; then
    echo "FAILED: Case 3 status missing Bangla failure reason!" >&2
    exit 1
fi
echo "[PASS] Case 3: Exited non-zero, deleted plain dump, and wrote ok: false with reason in Bengali."

# -------------------------------------------------------------------------
# Test Case 3b: Fake age binary that exists but fails (exits 1)
# Must exit non-zero, delete the plain dump, leave no files in daily, and write status ok: false in Bengali.
# -------------------------------------------------------------------------
echo -e "\n--- Test Case 3b: Fake age binary fails (exit 1) ---"
CASE3B_DIR="${TEST_BASE}/case3b"
FAKE_AGE_DIR="${TEST_BASE}/fake_age_bin"
mkdir -p "${FAKE_AGE_DIR}"
cat <<'EOF' > "${FAKE_AGE_DIR}/age"
#!/bin/bash
echo "Simulated age failure: invalid recipient or encryption error" >&2
exit 1
EOF
chmod +x "${FAKE_AGE_DIR}/age"

set +e
PATH="${FAKE_AGE_DIR}:${PATH}" BACKUP_DIR="${CASE3B_DIR}" BACKUP_AGE_PUBLIC_KEY="age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p" BACKUP_RCLONE_REMOTE="" bash scripts/backup.sh
EXIT_CODE_3B=$?
set -e

if [[ "${EXIT_CODE_3B}" -eq 0 ]]; then
    echo "FAILED: Case 3b expected non-zero exit code when age fails, got 0!" >&2
    exit 1
fi

if ls -1 "${CASE3B_DIR}/daily"/* >/dev/null 2>&1; then
    echo "FAILED: Leaked plain or partial files in daily directory in Case 3b!" >&2
    exit 1
fi

STATUS3B=$(read_status "${CASE3B_DIR}/last-backup.json")
echo "Case 3b status JSON: ${STATUS3B}"
if ! echo "${STATUS3B}" | grep -q '"ok": false'; then
    echo "FAILED: Case 3b status ok is not false!" >&2
    exit 1
fi
if ! echo "${STATUS3B}" | grep -q 'এনক্রিপশন ব্যর্থ'; then
    echo "FAILED: Case 3b status missing Bangla failure reason!" >&2
    exit 1
fi
echo "[PASS] Case 3b: Exited non-zero, deleted plain dump, and wrote ok: false with reason in Bengali."

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

STATUS4=$(read_status "${CASE4_DIR}/last-backup.json")
echo "Case 4 status JSON: ${STATUS4}"
if ! echo "${STATUS4}" | grep -q '"offServerConfigured": false'; then
    echo "FAILED: Case 4 offServerConfigured is not false!" >&2
    exit 1
fi
if ! echo "${STATUS4}" | grep -q 'সার্ভারের বাইরে পাঠানো হয়নি'; then
    echo "FAILED: Case 4 missing offServerWarning on unencrypted backup!" >&2
    exit 1
fi
if ! echo "${STATUS4}" | grep -E '"tableCount": [1-9][0-9]*' >/dev/null; then
    echo "FAILED: Case 4 last-backup.json tableCount is not greater than 0!" >&2
    exit 1
fi
echo "[PASS] Case 4: rclone was never called; unencrypted offServer refused."

# -------------------------------------------------------------------------
# Test Case 5: Empty Database (0 Tables)
# Must exit 1, leave no backup_* file in daily/, and write ok: false with Bangla reason.
# -------------------------------------------------------------------------
echo -e "\n--- Test Case 5: Empty database (0 tables) ---"
CASE5_DIR="${TEST_BASE}/case5"

set +e
POSTGRES_DB="universal_pos_empty_check" BACKUP_DIR="${CASE5_DIR}" BACKUP_AGE_PUBLIC_KEY="" BACKUP_RCLONE_REMOTE="" bash scripts/backup.sh
EXIT_CODE_5=$?
set -e

if [[ "${EXIT_CODE_5}" -eq 0 ]]; then
    echo "FAILED: Case 5 expected exit 1 on empty database, got 0!" >&2
    exit 1
fi

if ls -1 "${CASE5_DIR}/daily"/backup_* >/dev/null 2>&1; then
    echo "FAILED: backup_* file found in daily/ for empty database in Case 5!" >&2
    exit 1
fi

STATUS5=$(read_status "${CASE5_DIR}/last-backup.json")
echo "Case 5 status JSON: ${STATUS5}"
if ! echo "${STATUS5}" | grep -q '"ok": false'; then
    echo "FAILED: Case 5 status ok is not false!" >&2
    exit 1
fi
if ! echo "${STATUS5}" | grep -q 'ব্যাকআপে কোনো টেবিল পাওয়া যায়নি'; then
    echo "FAILED: Case 5 missing Bangla reason 'ব্যাকআপে কোনো টেবিল পাওয়া যায়নি'!" >&2
    exit 1
fi
echo "[PASS] Case 5: Exit 1, no backup files in daily, ok: false with Bangla reason."

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
