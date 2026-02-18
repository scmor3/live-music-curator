#!/bin/bash
# Backup script for local PostgreSQL database
# Usage: ./backup-db.sh [backup-name]

set -e

# Load environment variables if .env exists
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Database connection details (can be overridden by environment variables)
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-live_music_curator}
DB_USER=${DB_USER:-postgres}

# Backup name (optional, defaults to timestamp)
BACKUP_NAME=${1:-$(date +%Y%m%d_%H%M%S)}
BACKUP_DIR="./db-backups"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.sql"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "📦 Backing up database: ${DB_NAME}"
echo "   Host: ${DB_HOST}:${DB_PORT}"
echo "   User: ${DB_USER}"
echo "   Backup file: ${BACKUP_FILE}"

# Prompt for password if PGPASSWORD is not set
if [ -z "$PGPASSWORD" ] && [ -z "$DB_PASS" ]; then
  echo "⚠️  Note: You may be prompted for your database password"
fi

# Set password from DB_PASS if available
if [ -n "$DB_PASS" ]; then
  export PGPASSWORD="$DB_PASS"
fi

# Create backup using pg_dump
pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  -f "$BACKUP_FILE"

# Compress the backup
gzip -f "$BACKUP_FILE"
BACKUP_FILE="${BACKUP_FILE}.gz"

echo "✅ Backup completed successfully!"
echo "   File: ${BACKUP_FILE}"
echo "   Size: $(du -h "$BACKUP_FILE" | cut -f1)"

# List all backups
echo ""
echo "📋 Available backups:"
ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -5 || echo "   (no previous backups found)"
