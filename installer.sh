#!/bin/bash
set -e

if [ ! -t 0 ]; then
    SCRIPT_URL="https://raw.githubusercontent.com/Andreas-SJ/ip-utils/main/installer.sh"
    TMPSCRIPT=$(mktemp /tmp/ip-utils-install-XXXXX.sh)
    curl -fsSL "$SCRIPT_URL" -o "$TMPSCRIPT" < /dev/null || { echo "Error: failed to download installer."; rm -f "$TMPSCRIPT"; exit 1; }
    bash "$TMPSCRIPT" < /dev/tty
    EXIT_CODE=$?
    rm -f "$TMPSCRIPT"
    exit $EXIT_CODE
fi

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

do_start_container() {
  local mode="$1" admin_user="$2" admin_pass="$3" trust_proxy="$4"
  say "Starting container ..."
  local args=(
    run -d
    --name "$CONTAINER_NAME"
    --restart unless-stopped
    --network host
    --cap-add NET_RAW
    -v "${DATA_DIR}:/app/data"
    -e "ADMIN_USER=${admin_user}"
    -e "ADMIN_PASS=${admin_pass}"
    -e "MODE=${mode}"
  )
  if [ -n "$trust_proxy" ]; then
    args+=(-e "TRUST_PROXY=${trust_proxy}")
  fi
  args+=("$IMAGE_NAME")
  $SUDO docker "${args[@]}" > /dev/null
}

print_summary() {
  local mode="$1" admin_user="$2"
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  if [ -z "$LOCAL_IP" ]; then LOCAL_IP="<server-ip>"; fi
  hr
  echo ""
  say "  Running at:  http://${LOCAL_IP}"
  if [ "$mode" = "planner" ] || [ "$mode" = "both" ]; then
    say "  Admin login: http://${LOCAL_IP}/login"
    say "  Admin panel: http://${LOCAL_IP}/admin"
    if [ -n "$admin_user" ]; then
      say "  Admin user:  ${admin_user}"
    fi
  fi
  echo ""
  say "Container name:  $CONTAINER_NAME"
  say "Data directory:  $DATA_DIR"
  say "To stop:         docker stop $CONTAINER_NAME"
  say "To view logs:    docker logs $CONTAINER_NAME"
  echo ""
}

EXISTING_CONTAINER=false
if $SUDO docker container inspect "$CONTAINER_NAME" &>/dev/null; then
  EXISTING_CONTAINER=true
fi

if [ "$EXISTING_CONTAINER" = "true" ]; then
  echo ""
  say "An existing ip-utils installation was detected."
  echo ""
  say "  1) Update  (pull latest code, rebuild, keep all data)  [default]"
  say "  2) Full reinstall  (asks for new settings and admin credentials)"
  say "  3) Exit"
  echo ""
  read -r -p "Enter choice [1-3, default 1]: " install_choice
  echo ""

  case "$install_choice" in
    2) say "Proceeding with full reinstall..." ;;
    3) say "Exiting."; exit 0 ;;
    *)
      say "Updating installation..."
      echo ""

      EXISTING_MODE=$($SUDO docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER_NAME" 2>/dev/null | grep '^MODE=' | cut -d= -f2- || true)
      if [ -z "$EXISTING_MODE" ]; then EXISTING_MODE="both"; fi
      EXISTING_TRUST_PROXY=$($SUDO docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER_NAME" 2>/dev/null | grep '^TRUST_PROXY=' | cut -d= -f2- || true)

      if [ -n "$EXISTING_TRUST_PROXY" ]; then
        say "Current trusted proxy IP: $EXISTING_TRUST_PROXY"
        read -r -p "Change proxy IP? [y/N]: " change_proxy
        if [[ "$change_proxy" =~ ^[Yy]$ ]]; then
          while true; do
            read -r -p "New trusted proxy IP (leave blank to remove): " NEW_PROXY
            if [ -z "$NEW_PROXY" ]; then
              EXISTING_TRUST_PROXY=""
              say "Reverse proxy disabled."
              break
            fi
            if echo "$NEW_PROXY" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then
              EXISTING_TRUST_PROXY="$NEW_PROXY"
              say "Trusted proxy IP set to: $EXISTING_TRUST_PROXY"
              break
            fi
            say "Please enter a valid IPv4 address."
          done
        fi
      else
        read -r -p "Is this installation behind a reverse proxy? [y/N]: " proxy_choice
        if [[ "$proxy_choice" =~ ^[Yy]$ ]]; then
          while true; do
            read -r -p "Trusted reverse proxy IP (e.g. 127.0.0.1): " EXISTING_TRUST_PROXY
            if [ -z "$EXISTING_TRUST_PROXY" ]; then
              say "IP cannot be empty."
              continue
            fi
            if echo "$EXISTING_TRUST_PROXY" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then
              say "Trusted proxy IP set to: $EXISTING_TRUST_PROXY"
              break
            fi
            say "Please enter a valid IPv4 address."
          done
        fi
      fi
      echo ""

      hr

      if [ -d "$INSTALL_DIR/.git" ]; then
        say "Pulling latest code ..."
        $SUDO git -C "$INSTALL_DIR" fetch --quiet
        $SUDO git -C "$INSTALL_DIR" reset --hard origin/main --quiet
      else
        say "Cloning repository to $INSTALL_DIR ..."
        $SUDO git clone --quiet "$REPO_URL" "$INSTALL_DIR"
      fi

      say "Stopping existing container ..."
      $SUDO docker stop "$CONTAINER_NAME" 2>/dev/null || true
      $SUDO docker rm "$CONTAINER_NAME" 2>/dev/null || true

      say "Removing old Docker image ..."
      $SUDO docker rmi "$IMAGE_NAME" 2>/dev/null || true

      say "Building Docker image (this may take a minute) ..."
      $SUDO docker build --no-cache --quiet -t "$IMAGE_NAME" "$INSTALL_DIR"

      do_start_container "$EXISTING_MODE" "" "" "$EXISTING_TRUST_PROXY"

      say "Update complete."
      print_summary "$EXISTING_MODE" ""
      exit 0
      ;;
  esac
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
read -r -p "Is this installation behind a reverse proxy? [y/N]: " proxy_choice
echo ""
if [[ "$proxy_choice" =~ ^[Yy]$ ]]; then
  while true; do
    read -r -p "Trusted reverse proxy IP (e.g. 127.0.0.1): " TRUST_PROXY
    if [ -z "$TRUST_PROXY" ]; then
      say "IP cannot be empty."
      continue
    fi
    if echo "$TRUST_PROXY" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then
      break
    fi
    say "Please enter a valid IPv4 address."
  done
  say "Reverse proxy trusted IP: $TRUST_PROXY"
else
  TRUST_PROXY=""
  say "Running in HTTP mode (no reverse proxy)."
fi

echo ""
hr

if [ -d "$INSTALL_DIR/.git" ]; then
  say "Pulling latest code in $INSTALL_DIR ..."
  $SUDO git -C "$INSTALL_DIR" fetch --quiet
  $SUDO git -C "$INSTALL_DIR" reset --hard origin/main --quiet
else
  say "Cloning repository to $INSTALL_DIR ..."
  $SUDO git clone --quiet "$REPO_URL" "$INSTALL_DIR"
fi

say "Creating data directory at $DATA_DIR ..."
$SUDO mkdir -p "$DATA_DIR/plans"

say "Removing any existing container ..."
$SUDO docker stop "$CONTAINER_NAME" 2>/dev/null || true
$SUDO docker rm "$CONTAINER_NAME" 2>/dev/null || true
$SUDO docker rmi "$IMAGE_NAME" 2>/dev/null || true

say "Building Docker image (this may take a minute) ..."
$SUDO docker build --no-cache --quiet -t "$IMAGE_NAME" "$INSTALL_DIR"

do_start_container "$MODE" "$ADMIN_USER" "$ADMIN_PASS" "$TRUST_PROXY"

say "Installation complete."
print_summary "$MODE" "$ADMIN_USER"
