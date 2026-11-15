#!/bin/bash
set -e

RUNTIME_USER="${POSTGRES_RUNTIME_USER:-pos_runtime}"
RUNTIME_PASSWORD="${POSTGRES_RUNTIME_PASSWORD:-pos_runtime_secret}"
ADMIN_USER="${POSTGRES_USER:-pos_admin}"
ADMIN_DB="${POSTGRES_DB:-universal_pos}"

echo "Bootstrapping PostgreSQL roles and test database..."

# 1. Create universal_pos_test database if it does not exist
psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname "postgres" <<-EOSQL
    SELECT 'CREATE DATABASE universal_pos_test OWNER $ADMIN_USER'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'universal_pos_test')\gexec
EOSQL

# 2. Create non-superuser pos_runtime login role
psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname "postgres" <<-EOSQL
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

    GRANT CONNECT ON DATABASE $ADMIN_DB TO $RUNTIME_USER;
    GRANT CONNECT ON DATABASE universal_pos_test TO $RUNTIME_USER;
EOSQL

echo "PostgreSQL role bootstrap complete."
