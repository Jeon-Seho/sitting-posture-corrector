#!/bin/bash
# Runs once, on an empty MySQL volume, from the official image entrypoint.
# Applies the DB owner's schema V1.1 and master seeds from database/ unchanged
# (database/README.md section 1). POSEGOOD_DB_INIT_SCHEMA=false leaves the schema
# empty for an exact restore target. Existing volumes are never touched here.

if [ "${POSEGOOD_DB_INIT_SCHEMA:-true}" != "true" ]; then
  echo "posegood: schema initialization skipped (restore target)"
else
  if ! declare -F docker_process_sql >/dev/null; then
    # Executed rather than sourced: use the init server's local socket as root.
    docker_process_sql() { mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}"; }
  fi
  for file in /posegood-db/schema/schema_V1_1.sql /posegood-db/seed/seed_0*.sql; do
    echo "posegood: applying ${file#/posegood-db/}"
    docker_process_sql < "$file"
  done
fi
