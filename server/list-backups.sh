#!/bin/bash
# List all database backups
# Usage: ./list-backups.sh

BACKUP_DIR="./db-backups"

if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A "$BACKUP_DIR"/*.sql.gz 2>/dev/null)" ]; then
  echo "📋 No backups found in $BACKUP_DIR"
  exit 0
fi

echo "📋 Available database backups:"
echo ""
ls -lh "$BACKUP_DIR"/*.sql.gz | awk '{print "   " $9 " (" $5 " - " $6 " " $7 " " $8 ")"}'
echo ""
echo "💡 To restore a backup, use:"
echo "   ./restore-db.sh <backup-name>"
echo "   ./restore-db.sh latest  (restores most recent)"
