#!/bin/bash
# Restore local database backup to Supabase
# Usage: ./restore-to-supabase.sh [backup-name]
#        ./restore-to-supabase.sh latest  (restores most recent backup)
#
# Requires SUPABASE_DATABASE_URL environment variable or .env file
# Format: postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres

set -e

# Load environment variables if .env exists
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

BACKUP_DIR="./db-backups"

# Check for Supabase connection string
if [ -z "$SUPABASE_DATABASE_URL" ]; then
  echo "❌ Error: SUPABASE_DATABASE_URL environment variable not set"
  echo ""
  echo "Please set it in your .env file or export it:"
  echo "  SUPABASE_DATABASE_URL='postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres'"
  echo ""
  echo "You can find this in your Supabase dashboard:"
  echo "  Project Settings → Database → Connection string → URI"
  exit 1
fi

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

echo "🔄 Restoring to Supabase database"
echo "   Backup file: ${BACKUP_FILE}"
echo "   Connection: $(echo $SUPABASE_DATABASE_URL | sed 's/:[^:@]*@/:***@/')"
echo ""
echo "⚠️  WARNING: This will REPLACE all data in your Supabase database!"
echo "⚠️  This operation cannot be undone!"
read -p "   Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "❌ Restore cancelled"
  exit 1
fi

# Restore the backup to Supabase
echo "🔄 Restoring..."
gunzip -c "$BACKUP_FILE" | psql "$SUPABASE_DATABASE_URL"

echo "✅ Restore completed successfully!"
echo ""
echo "💡 Tip: You may want to run migrations if your Supabase schema differs:"
echo "   npm run migrate"
