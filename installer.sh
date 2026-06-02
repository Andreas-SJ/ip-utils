#!/bin/bash
set -e

exec < /dev/tty

REPO_URL="https://github.com/Andreas-SJ/ip-utils.git"
INSTALL_DIR="/opt/ip-utils"
DATA_DIR="/opt/ip-utils-data"
IMAGE_NAME="ip-utils"
CONTAINER_NAME="ip-utils"

if [ "$EUID" -ne 0 ]; then SUDO="sudo"; else SUDO=""; fi

die() { echo ""; echo "Error: $1" >&2; exit 1; }
say() { echo "$1"; }
hr() { echo "------------------------------------------------------------"; }

hr
say "ip-utils installer"
say "Repository: $REPO_URL"
hr
echo ""

check_docker() {
  if ! docker version &>/dev/null; then
    if [ -n "$SUDO" ]; then
      $SUDO docker version &>/dev/null || \
        die "Cannot connect to Docker daemon. Try running this script with sudo, or add your user to the docker group and log out/in."
    else
      die "Cannot connect to Docker daemon."
    fi
  fi
}

install_docker() {
  say "Docker not found. Attempting to install Docker..."
  echo ""

  if ! command -v curl &>/dev/null; then
    if command -v apt-get &>/dev/null; then
      $SUDO apt-get update -q && $SUDO apt-get install -y curl
    elif command -v dnf &>/dev/null; then
      $SUDO dnf install -y curl
    elif command -v yum &>/dev/null; then
      $SUDO yum install -y curl
    elif command -v pacman &>/dev/null; then
      $SUDO pacman -S --noconfirm curl
    else
      die "curl is required to install Docker. Please install curl first, then re-run this script."
    fi
  fi

  say "Running Docker install script from get.docker.com..."
  curl -fsSL https://get.docker.com | $SUDO sh

  if command -v systemctl &>/dev/null; then
    $SUDO systemctl enable docker 2>/dev/null || true
    $SUDO systemctl start docker 2>/dev/null || true
  fi

  say "Docker installed."
  echo ""
}

install_git() {
  say "git not found. Attempting to install git..."
  if command -v apt-get &>/dev/null; then
    $SUDO apt-get update -q && $SUDO apt-get install -y git
  elif command -v dnf &>/dev/null; then
    $SUDO dnf install -y git
  elif command -v yum &>/dev/null; then
    $SUDO yum install -y git
  elif command -v pacman &>/dev/null; then
    $SUDO pacman -S --noconfirm git
  else
    die "git is required but could not be installed automatically. Please install git and re-run."
  fi
}

if ! command -v docker &>/dev/null; then
  install_docker
fi
check_docker

if ! command -v git &>/dev/null; then
  install_git
fi

echo ""
say "Select installation mode:"
say "  1) Both tools: IP Planner + Netplan Generator  [default]"
say "  2) IP Planner only  (authentication required)"
say "  3) Netplan Generator only  (no authentication)"
echo ""
read -r -p "Enter choice [1-3, default 1]: " mode_choice
echo ""

case "$mode_choice" in
  2) MODE="planner";  say "Mode: IP Planner only" ;;
  3) MODE="netplan";  say "Mode: Netplan Generator only" ;;
  *)  MODE="both";    say "Mode: Both tools" ;;
esac

if [ "$MODE" = "planner" ] || [ "$MODE" = "both" ]; then
  echo ""
  say "An admin account is required to manage users for the IP Planner."
  echo ""

  while true; do
    read -r -p "Admin username: " ADMIN_USER
    if [ -z "$ADMIN_USER" ]; then
      say "Username cannot be empty."
      continue
    fi
    if echo "$ADMIN_USER" | grep -qE '^[a-zA-Z0-9_-]{1,32}$'; then
      break
    fi
    say "Username must be 1-32 alphanumeric characters (a-z, A-Z, 0-9, _, -)."
  done

  while true; do
    read -r -s -p "Admin password (min. 8 characters): " ADMIN_PASS
    echo ""
    if [ ${#ADMIN_PASS} -lt 8 ]; then
      say "Password must be at least 8 characters."
      continue
    fi
    read -r -s -p "Confirm password: " ADMIN_PASS2
    echo ""
    if [ "$ADMIN_PASS" = "$ADMIN_PASS2" ]; then
      break
    fi
    say "Passwords do not match. Try again."
  done
else
  ADMIN_USER=""
  ADMIN_PASS=""
fi

echo ""
hr

if [ -d "$INSTALL_DIR/.git" ]; then
  say "Updating existing installation in $INSTALL_DIR ..."
  $SUDO git -C "$INSTALL_DIR" fetch --quiet
  $SUDO git -C "$INSTALL_DIR" reset --hard origin/main --quiet
else
  say "Cloning repository to $INSTALL_DIR ..."
  $SUDO git clone --quiet "$REPO_URL" "$INSTALL_DIR"
fi

say "Creating data directory at $DATA_DIR ..."
$SUDO mkdir -p "$DATA_DIR/plans"

if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
  say "Stopping existing container ..."
  $SUDO docker stop "$CONTAINER_NAME" 2>/dev/null || true
  $SUDO docker rm "$CONTAINER_NAME" 2>/dev/null || true
fi

say "Building Docker image (this may take a minute) ..."
$SUDO docker build --quiet -t "$IMAGE_NAME" "$INSTALL_DIR"

say "Starting container ..."
$SUDO docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p 80:80 \
  -v "${DATA_DIR}:/app/data" \
  -e "ADMIN_USER=${ADMIN_USER}" \
  -e "ADMIN_PASS=${ADMIN_PASS}" \
  -e "MODE=${MODE}" \
  "$IMAGE_NAME" > /dev/null

hr
echo ""
say "Installation complete."
echo ""

LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$LOCAL_IP" ]; then LOCAL_IP="<server-ip>"; fi

say "  Running at:  http://${LOCAL_IP}"
if [ "$MODE" = "planner" ] || [ "$MODE" = "both" ]; then
  say "  Admin login: http://${LOCAL_IP}/login"
  say "  Admin panel: http://${LOCAL_IP}/admin"
  say "  Admin user:  ${ADMIN_USER}"
fi
echo ""
say "Container name:  $CONTAINER_NAME"
say "Data directory:  $DATA_DIR"
say "To stop:         docker stop $CONTAINER_NAME"
say "To view logs:    docker logs $CONTAINER_NAME"
echo ""
