#!/bin/bash

# Script to access MySQL container shell

CONTAINER_NAME="message-translator-mysql"
MYSQL_USER="${MYSQL_USER:-translator}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-translator_password}"
MYSQL_DATABASE="${MYSQL_DATABASE:-translator_db}"

echo "Connecting to MySQL container: $CONTAINER_NAME"
echo "Database: $MYSQL_DATABASE"
echo "User: $MYSQL_USER"
echo ""

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: Container '$CONTAINER_NAME' is not running."
    echo "Please start the container first with: docker-compose up -d"
    exit 1
fi

# Connect to MySQL
docker exec -it $CONTAINER_NAME mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"
