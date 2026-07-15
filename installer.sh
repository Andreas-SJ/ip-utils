#!/bin/bash
set -e

if [ ! -t 0 ]; then
    TMPSCRIPT=$(mktemp /tmp/ip-utils-install-XXXXX.sh)
  cat > "$TMPSCRIPT" || { echo "Error: failed to read installer script from stdin."; rm -f "$TMPSCRIPT"; exit 1; }
    bash "$TMPSCRIPT" "$@" < /dev/tty
    EXIT_CODE=$?
    rm -f "$TMPSCRIPT"
    exit $EXIT_CODE
fi

REPO_URL="https://github.com/Andreas-SJ/ip-utils.git"
REPO_BRANCH="main"
INSTALL_DIR="/opt/ip-utils"
DATA_DIR="/opt/ip-utils-data"
IMAGE_NAME="ip-utils"
CONTAINER_NAME="ip-utils"

if [ "$EUID" -ne 0 ]; then SUDO="sudo"; else SUDO=""; fi

die() { echo ""; echo "Error: $1" >&2; exit 1; }
say() { echo "$1"; }
hr() { echo "------------------------------------------------------------"; }

normalize_mode() {
  local raw="$1"
  case "$(echo "$raw" | tr '[:upper:]' '[:lower:]')" in
    both|all|full) echo "both" ;;
    planner|ip-planner|ip_planner|subnet-planner|subnet_planner) echo "planner" ;;
    netplan|netplan-gen|netplan_generator|netplan-generator) echo "netplan" ;;
    *) echo "" ;;
  esac
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --testing)
        REPO_BRANCH="testing"
        ;;
      --main)
        REPO_BRANCH="main"
        ;;
      --branch)
        shift
        [ -n "$1" ] || die "--branch requires a branch name."
        REPO_BRANCH="$1"
        ;;
      --branch=*)
        REPO_BRANCH="${1#*=}"
        ;;
      -h|--help)
        echo "Usage: installer.sh [--testing] [--main] [--branch <name>]"
        echo ""
        echo "  --testing        Use the testing branch"
        echo "  --main           Use the main branch (default)"
        echo "  --branch <name>  Use a specific branch"
        exit 0
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
    shift
  done

  if ! echo "$REPO_BRANCH" | grep -qE '^[A-Za-z0-9._/-]+$'; then
    die "Invalid branch name: $REPO_BRANCH"
  fi
}

sync_repo_source() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    say "Pulling latest code from branch '$REPO_BRANCH' ..."
    $SUDO git -C "$INSTALL_DIR" fetch --quiet origin "$REPO_BRANCH" || die "Failed to fetch branch '$REPO_BRANCH'."
    $SUDO git -C "$INSTALL_DIR" reset --hard "origin/${REPO_BRANCH}" --quiet || die "Failed to reset to branch '$REPO_BRANCH'."
  else
    say "Cloning branch '$REPO_BRANCH' to $INSTALL_DIR ..."
    $SUDO git clone --quiet --single-branch --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR" || die "Failed to clone branch '$REPO_BRANCH'."
  fi
}

parse_args "$@"

hr
say "ip-utils installer"
say "Repository: $REPO_URL"
say "Branch: $REPO_BRANCH"
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

upgrade_mode_to_both() {
  local from_mode="$1" trust_proxy="$2"
  local admin_user="" admin_pass="" admin_pass2=""

  if [ "$from_mode" = "netplan" ]; then
    echo ""
    say "Adding IP Planner requires creating an admin account."
    echo ""

    while true; do
      read -r -p "Admin username: " admin_user
      if [ -z "$admin_user" ]; then
        say "Username cannot be empty."
        continue
      fi
      if echo "$admin_user" | grep -qE '^[a-zA-Z0-9_-]{1,32}$'; then
        break
      fi
      say "Username must be 1-32 alphanumeric characters (a-z, A-Z, 0-9, _, -)."
    done

    while true; do
      read -r -s -p "Admin password (min. 8 characters): " admin_pass
      echo ""
      if [ ${#admin_pass} -lt 8 ]; then
        say "Password must be at least 8 characters."
        continue
      fi
      read -r -s -p "Confirm password: " admin_pass2
      echo ""
      if [ "$admin_pass" = "$admin_pass2" ]; then
        break
      fi
      say "Passwords do not match. Try again."
    done
  fi

  echo ""
  hr
  say "Installing missing tool and switching mode to: both"

  sync_repo_source

  COMMIT_SHA=$($SUDO git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || true)
  [ -n "$COMMIT_SHA" ] && printf '%s\n' "$COMMIT_SHA" | $SUDO tee "$INSTALL_DIR/version.txt" > /dev/null

  say "Stopping existing container ..."
  $SUDO docker stop "$CONTAINER_NAME" 2>/dev/null || true
  $SUDO docker rm "$CONTAINER_NAME" 2>/dev/null || true

  say "Removing old Docker image ..."
  $SUDO docker rmi "$IMAGE_NAME" 2>/dev/null || true

  say "Building Docker image (this may take a minute) ..."
  $SUDO docker build --no-cache --quiet -t "$IMAGE_NAME" "$INSTALL_DIR"

  do_start_container "both" "$admin_user" "$admin_pass" "$trust_proxy"

  say "Missing tool installed."
  print_summary "both" "$admin_user"
  exit 0
}

manual_install_missing_tool() {
  local trust_proxy="$1"

  echo ""
  say "Select currently installed single-tool mode:"
  say "  1) IP Planner only  (add Netplan Generator)"
  say "  2) Netplan Generator only  (add IP Planner)"
  say "  3) Cancel"
  echo ""
  read -r -p "Enter choice [1-3]: " missing_choice
  echo ""

  case "$missing_choice" in
    1) upgrade_mode_to_both "planner" "$trust_proxy" ;;
    2) upgrade_mode_to_both "netplan" "$trust_proxy" ;;
    *) say "Cancelled."; exit 0 ;;
  esac
}

do_reset_password() {
  local raw_existing_mode existing_mode current_admins current_admin_user new_admin_user new_admin_pass new_admin_pass2 was_running

  raw_existing_mode=$($SUDO docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER_NAME" 2>/dev/null | grep '^MODE=' | cut -d= -f2- || true)
  existing_mode=$(normalize_mode "$raw_existing_mode")
  if [ -z "$existing_mode" ]; then existing_mode="both"; fi

  if [ "$existing_mode" != "planner" ] && [ "$existing_mode" != "both" ]; then
    die "Current installation mode ($existing_mode) does not use authentication; there is no admin password to reset."
  fi

  # NOTE: ip-utils only reads ADMIN_USER/ADMIN_PASS once, to bootstrap the very
  # first admin account if that username doesn't already exist in users.json.
  # Existing accounts and their passwords live in users.json inside the data
  # volume, so resetting the password has to edit that file directly (using
  # the app's own bcrypt module inside the container) rather than restarting
  # the container with different env vars.

  was_running=$($SUDO docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo "false")
  if [ "$was_running" != "true" ]; then
    say "Starting container to perform the reset ..."
    $SUDO docker start "$CONTAINER_NAME" > /dev/null 2>&1 || die "Could not start the container to reset the password."
    sleep 2
  fi

  current_admins=$($SUDO docker exec "$CONTAINER_NAME" node -e "
    const fs = require('fs');
    try {
      const users = JSON.parse(fs.readFileSync('/app/data/users.json', 'utf8'));
      console.log(Object.values(users).filter(u => u.isAdmin).map(u => u.username).join(','));
    } catch (e) { console.log(''); }
  " 2>/dev/null || true)
  current_admin_user=$(echo "$current_admins" | cut -d, -f1)

  echo ""
  if [ -n "$current_admin_user" ]; then
    say "Current admin username: $current_admin_user"
  else
    say "No existing admin account was found; this will create one."
  fi

  while true; do
    read -r -p "New admin username (leave blank to keep '${current_admin_user}'): " new_admin_user
    if [ -z "$new_admin_user" ]; then
      if [ -z "$current_admin_user" ]; then
        say "Username cannot be empty."
        continue
      fi
      new_admin_user="$current_admin_user"
    fi
    if echo "$new_admin_user" | grep -qE '^[a-zA-Z0-9_-]{1,32}$'; then
      break
    fi
    say "Username must be 1-32 alphanumeric characters (a-z, A-Z, 0-9, _, -)."
  done

  while true; do
    read -r -s -p "New admin password (min. 8 characters): " new_admin_pass
    echo ""
    if [ ${#new_admin_pass} -lt 8 ]; then
      say "Password must be at least 8 characters."
      continue
    fi
    read -r -s -p "Confirm password: " new_admin_pass2
    echo ""
    if [ "$new_admin_pass" = "$new_admin_pass2" ]; then
      break
    fi
    say "Passwords do not match. Try again."
  done

  echo ""
  hr
  say "Updating admin credentials ..."

  if ! $SUDO docker exec \
    -e RESET_USER="$new_admin_user" \
    -e RESET_PASS="$new_admin_pass" \
    -e OLD_USER="$current_admin_user" \
    "$CONTAINER_NAME" node -e "
      const fs = require('fs');
      const bcrypt = require('bcrypt');
      const file = '/app/data/users.json';
      let users = {};
      try { users = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
      const newUser = process.env.RESET_USER;
      const oldUser = process.env.OLD_USER;
      bcrypt.hash(process.env.RESET_PASS, 10).then(hash => {
        if (oldUser && oldUser !== newUser && users[oldUser]) delete users[oldUser];
        users[newUser] = { username: newUser, passwordHash: hash, isAdmin: true };
        fs.writeFileSync(file, JSON.stringify(users, null, 2));
        console.log('OK');
      }).catch(err => { console.error(err); process.exit(1); });
    " > /dev/null; then
    if [ "$was_running" != "true" ]; then
      $SUDO docker stop "$CONTAINER_NAME" > /dev/null 2>&1 || true
    fi
    die "Failed to update admin credentials inside the container."
  fi

  if [ "$was_running" != "true" ]; then
    say "Stopping container (it was not running before the reset) ..."
    $SUDO docker stop "$CONTAINER_NAME" > /dev/null 2>&1 || true
  fi

  echo ""
  hr
  say "Admin password reset complete."
  echo ""
  say "  Admin user: $new_admin_user"
  echo ""
  exit 0
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
  RAW_EXISTING_MODE=$($SUDO docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER_NAME" 2>/dev/null | grep '^MODE=' | cut -d= -f2- || true)
  EXISTING_MODE=$(normalize_mode "$RAW_EXISTING_MODE")
  EXISTING_TRUST_PROXY=$($SUDO docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER_NAME" 2>/dev/null | grep '^TRUST_PROXY=' | cut -d= -f2- || true)

  if [ -z "$EXISTING_MODE" ]; then
    echo ""
    say "Could not determine installed tool mode from container env: MODE=${RAW_EXISTING_MODE:-<unset>}"
    say "Please select current installed mode so installer options are correct:"
    say "  1) Both tools"
    say "  2) IP Planner only"
    say "  3) Netplan Generator only"
    echo ""
    read -r -p "Enter choice [1-3, default 1]: " detected_mode_choice
    case "$detected_mode_choice" in
      2) EXISTING_MODE="planner" ;;
      3) EXISTING_MODE="netplan" ;;
      *) EXISTING_MODE="both" ;;
    esac
  fi

  echo ""
  say "An existing ip-utils installation was detected."
  echo ""
  if [ "$EXISTING_MODE" = "planner" ]; then
    say "Detected mode: IP Planner only"
    say "  1) Update  (pull latest code, rebuild, keep all data)  [default]"
    say "  2) Reset admin password  (keep everything else unchanged)"
    say "  3) Install Netplan Generator  (switch mode to both)"
    say "  4) Full reinstall  (asks for new settings and admin credentials)"
    say "  5) Exit"
  elif [ "$EXISTING_MODE" = "netplan" ]; then
    say "Detected mode: Netplan Generator only"
    say "  1) Update  (pull latest code, rebuild, keep all data)  [default]"
    say "  2) Install IP Planner  (switch mode to both)"
    say "  3) Full reinstall  (asks for new settings and admin credentials)"
    say "  4) Exit"
  else
    say "Detected mode: Both tools"
    say "  1) Update  (pull latest code, rebuild, keep all data)  [default]"
    say "  2) Reset admin password  (keep everything else unchanged)"
    say "  3) Install missing tool  (manual mode selection, switches to both)"
    say "  4) Full reinstall  (asks for new settings and admin credentials)"
    say "  5) Exit"
  fi
  echo ""

  if [ "$EXISTING_MODE" = "planner" ]; then
    read -r -p "Enter choice [1-5, default 1]: " install_choice
  elif [ "$EXISTING_MODE" = "netplan" ]; then
    read -r -p "Enter choice [1-4, default 1]: " install_choice
  else
    read -r -p "Enter choice [1-5, default 1]: " install_choice
  fi
  echo ""

  if [ "$EXISTING_MODE" = "planner" ]; then
    case "$install_choice" in
      2) do_reset_password ;;
      3) upgrade_mode_to_both "planner" "$EXISTING_TRUST_PROXY" ;;
      4) say "Proceeding with full reinstall..." ;;
      5) say "Exiting."; exit 0 ;;
      *)
        say "Updating installation..."
        echo ""

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

        sync_repo_source

        COMMIT_SHA=$($SUDO git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || true)
        [ -n "$COMMIT_SHA" ] && printf '%s\n' "$COMMIT_SHA" | $SUDO tee "$INSTALL_DIR/version.txt" > /dev/null

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
  elif [ "$EXISTING_MODE" = "netplan" ]; then
    case "$install_choice" in
      2) upgrade_mode_to_both "netplan" "$EXISTING_TRUST_PROXY" ;;
      3) say "Proceeding with full reinstall..." ;;
      4) say "Exiting."; exit 0 ;;
      *)
        say "Updating installation..."
        echo ""

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

        sync_repo_source

        COMMIT_SHA=$($SUDO git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || true)
        [ -n "$COMMIT_SHA" ] && printf '%s\n' "$COMMIT_SHA" | $SUDO tee "$INSTALL_DIR/version.txt" > /dev/null

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
  else
    case "$install_choice" in
      2) do_reset_password ;;
      3) manual_install_missing_tool "$EXISTING_TRUST_PROXY" ;;
      4) say "Proceeding with full reinstall..." ;;
      5) say "Exiting."; exit 0 ;;
      *)
      say "Updating installation..."
      echo ""

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

      sync_repo_source

      COMMIT_SHA=$($SUDO git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || true)
      [ -n "$COMMIT_SHA" ] && printf '%s\n' "$COMMIT_SHA" | $SUDO tee "$INSTALL_DIR/version.txt" > /dev/null

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

sync_repo_source

COMMIT_SHA=$($SUDO git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || true)
[ -n "$COMMIT_SHA" ] && printf '%s\n' "$COMMIT_SHA" | $SUDO tee "$INSTALL_DIR/version.txt" > /dev/null

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
