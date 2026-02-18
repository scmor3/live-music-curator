#!/bin/bash
# Restore script for local PostgreSQL database
# Usage: ./restore-db.sh [backup-name]
#        ./restore-db.sh latest  (restores most recent backup)

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

BACKUP_DIR="./db-backups"

# Determine which backup to restore
if [ -z "$1" ]; then
  echo "❌ Error: Please specify a backup name or 'latest'"
  echo ""
  echo "Available backups:"
  ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -10 || echo "   (no backups found)"
  exit 1
fi

if [ "$1" = "latest" ]; then
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1)
  if [ -z "$BACKUP_FILE" ]; then
    echo "❌ Error: No backups found in $BACKUP_DIR"
    exit 1
  fi
  echo "📋 Using latest backup: $(basename "$BACKUP_FILE")"
else
  BACKUP_FILE="${BACKUP_DIR}/${1}.sql.gz"
  if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Error: Backup file not found: ${BACKUP_FILE}"
    echo ""
    echo "Available backups:"
    ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -10 || echo "   (no backups found)"
    exit 1
  fi
fi

echo "🔄 Restoring database: ${DB_NAME}"
echo "   Host: ${DB_HOST}:${DB_PORT}"
echo "   User: ${DB_USER}"
echo "   Backup file: ${BACKUP_FILE}"
echo ""
echo "⚠️  WARNING: This will REPLACE all data in the database!"
read -p "   Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "❌ Restore cancelled"
  exit 1
fi

# Prompt for password if PGPASSWORD is not set
if [ -z "$PGPASSWORD" ] && [ -z "$DB_PASS" ]; then
  echo "⚠️  Note: You may be prompted for your database password"
fi

# Set password from DB_PASS if available
if [ -n "$DB_PASS" ]; then
  export PGPASSWORD="$DB_PASS"
fi

# Restore the backup
echo "🔄 Restoring..."
gunzip -c "$BACKUP_FILE" | psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME"

echo "✅ Restore completed successfully!"
