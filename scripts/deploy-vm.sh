#!/bin/bash
set -e

echo "=========================================================="
echo " Shakarganj Milk Reception - Virtual Machine Deployment    "
echo "=========================================================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
  echo "Error: Docker is not installed on this machine."
  echo "Please install Docker first: https://docs.docker.com/engine/install/"
  exit 1
fi

# Check Docker Compose (compose plugin or legacy docker-compose)
COMPOSE_CMD=""
if docker compose version &> /dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
  COMPOSE_CMD="docker-compose"
else
  echo "Error: Neither 'docker compose' nor 'docker-compose' was found."
  echo "Please install Docker Compose."
  exit 1
fi

echo "Using: $COMPOSE_CMD"

# Prepare .env from template if not existing
if [ ! -f .env ]; then
  if [ -f .env.docker.example ]; then
    echo "Creating .env from .env.docker.example..."
    cp .env.docker.example .env
    echo "Notice: Default .env file created. Review and edit .env to match your VM IP and secrets."
  fi
fi

# Build and start services
echo "Building and launching containers..."
$COMPOSE_CMD up -d --build

echo ""
echo "Checking service status..."
$COMPOSE_CMD ps

echo ""
echo "=========================================================="
echo " Deployment Complete! "
echo " Next.js Application:  http://<VM-IP>:3000"
echo " WhatsApp Gateway API: http://<VM-IP>:3001"
echo "=========================================================="
echo "View live logs with: $COMPOSE_CMD logs -f"
