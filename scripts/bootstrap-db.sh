#!/bin/bash
set -e

RUNTIME_USER="${POSTGRES_RUNTIME_USER:-pos_runtime}"
RUNTIME_PASSWORD="${POSTGRES_RUNTIME_PASSWORD:-pos_runtime_secret}"
ADMIN_USER="${POSTGRES_USER:-pos_admin}"
ADMIN_HOST="${POSTGRES_HOST:-localhost}"
ADMIN_PORT="${POSTGRES_PORT:-5432}"

echo "Bootstrapping PostgreSQL roles and test database on ${ADMIN_HOST}:${ADMIN_PORT}..."

PGPASSWORD="${POSTGRES_PASSWORD:-pos_secret}" psql -h "$ADMIN_HOST" -p "$ADMIN_PORT" -U "$ADMIN_USER" -d postgres <<-EOSQL
    SELECT 'CREATE DATABASE universal_pos_test OWNER $ADMIN_USER'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'universal_pos_test')\gexec

    SELECT 'CREATE DATABASE universal_pos_e2e OWNER $ADMIN_USER'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'universal_pos_e2e')\gexec

    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pos_app') THEN
            CREATE ROLE pos_app NOLOGIN NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pos_system') THEN
            CREATE ROLE pos_system NOLOGIN NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$RUNTIME_USER') THEN
            EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L NOINHERIT', '$RUNTIME_USER', '$RUNTIME_PASSWORD');
        ELSE
            EXECUTE format('ALTER ROLE %I WITH PASSWORD %L NOINHERIT', '$RUNTIME_USER', '$RUNTIME_PASSWORD');
        END IF;
        EXECUTE format('GRANT pos_app, pos_system TO %I', '$RUNTIME_USER');
    END
    \$\$;

    GRANT CONNECT ON DATABASE universal_pos TO $RUNTIME_USER;
    GRANT CONNECT ON DATABASE universal_pos_test TO $RUNTIME_USER;
    GRANT CONNECT ON DATABASE universal_pos_e2e TO $RUNTIME_USER;
EOSQL

echo "Bootstrap completed successfully."
