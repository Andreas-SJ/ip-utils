#!/bin/bash
set -e

if [ ! -t 0 ] && [ -p /dev/stdin ] && [ -z "$IP_UTILS_SKIP_STDIN_BOOTSTRAP" ]; then
    TMPSCRIPT=$(mktemp /tmp/ip-utils-install-XXXXX.sh)
  cat > "$TMPSCRIPT" || { echo "Error: failed to read installer script from stdin."; rm -f "$TMPSCRIPT"; exit 1; }
    bash "$TMPSCRIPT" "$@" < /dev/tty
    EXIT_CODE=$?
    rm -f "$TMPSCRIPT"
    exit $EXIT_CODE
fi

REPO_URL="https://github.com/Andreas-SJ/ip-utils.git"
REPO_BRANCH="main"
AUTO_UPDATE_NOW=false
AUTO_REFRESH_DAEMON_ONLY=false
AUTO_PROXY_MODE="keep"
AUTO_PROXY_IP=""
INSTALL_DIR="/opt/ip-utils"
DATA_DIR="/opt/ip-utils-data"
IMAGE_NAME="ip-utils"
CONTAINER_NAME="ip-utils"
UPDATER_DAEMON_SCRIPT="${INSTALL_DIR}/updater-daemon.sh"
UPDATER_SERVICE_NAME="ip-utils-updater.service"
UPDATER_REQUEST_FILE="${DATA_DIR}/update-request.env"
UPDATER_STATUS_FILE="${DATA_DIR}/update-status.env"
UPDATER_OUTPUT_FILE="${DATA_DIR}/update-status.log"
UPDATER_LAST_ID_FILE="${DATA_DIR}/update-last-id"
UPDATER_HEARTBEAT_FILE="${DATA_DIR}/update-heartbeat"

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
      --update-now)
        AUTO_UPDATE_NOW=true
        ;;
      --refresh-daemon-only)
        AUTO_REFRESH_DAEMON_ONLY=true
        ;;
      --proxy-mode)
        shift
        [ -n "$1" ] || die "--proxy-mode requires one of: keep, remove, set"
        AUTO_PROXY_MODE="$1"
        ;;
      --proxy-mode=*)
        AUTO_PROXY_MODE="${1#*=}"
        ;;
      --proxy-ip)
        shift
        [ -n "$1" ] || die "--proxy-ip requires an IPv4 value"
        AUTO_PROXY_IP="$1"
        ;;
      --proxy-ip=*)
        AUTO_PROXY_IP="${1#*=}"
        ;;
      -h|--help)
        echo "Usage: installer.sh [--testing] [--main] [--branch <name>] [--update-now] [--refresh-daemon-only] [--proxy-mode <keep|remove|set>] [--proxy-ip <IPv4>]"
        echo ""
        echo "  --testing        Use the testing branch"
        echo "  --main           Use the main branch (default)"
        echo "  --branch <name>  Use a specific branch"
        echo "  --update-now     Non-interactive update of an existing install"
        echo "  --refresh-daemon-only  Refresh updater daemon/service files and restart daemon"
        echo "  --proxy-mode     Proxy setting for --update-now (keep/remove/set)"
        echo "  --proxy-ip       Proxy IP for --proxy-mode set"
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

  if [ "$AUTO_PROXY_MODE" != "keep" ] && [ "$AUTO_PROXY_MODE" != "remove" ] && [ "$AUTO_PROXY_MODE" != "set" ]; then
    die "Invalid --proxy-mode value: $AUTO_PROXY_MODE"
  fi

  if [ "$AUTO_PROXY_MODE" = "set" ]; then
    if [ -z "$AUTO_PROXY_IP" ]; then
      die "--proxy-ip is required when --proxy-mode is set"
    fi
    if ! echo "$AUTO_PROXY_IP" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then
      die "--proxy-ip must be a valid IPv4 address"
    fi
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

install_update_daemon() {
  if [ "$AUTO_UPDATE_NOW" = "true" ]; then
    say "Update daemon: skipping daemon setup during --update-now run."
    return 0
  fi

  if [ -n "$IP_UTILS_SKIP_DAEMON_SETUP" ]; then
    say "Update daemon: skipping daemon setup in daemon-managed update context."
    return 0
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    say "Update daemon: systemd not found; skipping daemon setup on this OS."
    return 0
  fi

  $SUDO mkdir -p "$DATA_DIR"

  $SUDO tee "$UPDATER_DAEMON_SCRIPT" > /dev/null <<EOF
#!/bin/bash
set -u

DATA_DIR="$DATA_DIR"
INSTALLER="$INSTALL_DIR/installer.sh"
REQUEST_FILE="$UPDATER_REQUEST_FILE"
STATUS_FILE="$UPDATER_STATUS_FILE"
OUTPUT_FILE="$UPDATER_OUTPUT_FILE"
LAST_ID_FILE="$UPDATER_LAST_ID_FILE"
HEARTBEAT_FILE="$UPDATER_HEARTBEAT_FILE"

read_kv() {
  local key="\$1" file="\$2"
  [ -f "\$file" ] || { echo ""; return; }
  awk -F= -v key="\$key" '\$1 == key { sub(/^[^=]*=/, ""); print; exit }' "\$file"
}

write_status() {
  local id="\$1" status="\$2" started_at="\$3" ended_at="\$4" exit_code="\$5" branch="\$6" error="\$7" public_token="\$8"
  {
    echo "id=\$id"
    echo "status=\$status"
    echo "started_at=\$started_at"
    echo "ended_at=\$ended_at"
    echo "exit_code=\$exit_code"
    echo "branch=\$branch"
    echo "error=\$error"
    echo "public_token=\$public_token"
    echo "output_file=\$OUTPUT_FILE"
  } > "\$STATUS_FILE"
}

schedule_daemon_refresh() {
  local req_id="\$1"
  if ! command -v systemd-run >/dev/null 2>&1; then
    echo "[updater] WARNING: systemd-run not available; daemon refresh not scheduled." >> "\$OUTPUT_FILE"
    return 1
  fi

  local refresh_unit="ip-utils-updater-refresh-\${req_id}"
  if systemd-run --unit "\$refresh_unit" --property=Type=oneshot --property=After=network.target /bin/bash -lc "IP_UTILS_SKIP_STDIN_BOOTSTRAP=1 bash \"\$INSTALLER\" --refresh-daemon-only" >> "\$OUTPUT_FILE" 2>&1; then
    echo "[updater] Scheduled daemon refresh via transient unit: \$refresh_unit" >> "\$OUTPUT_FILE"
    return 0
  fi

  echo "[updater] WARNING: failed to schedule daemon refresh transient unit." >> "\$OUTPUT_FILE"
  return 1
}

touch "\$OUTPUT_FILE"
date +%s > "\$HEARTBEAT_FILE"

while true; do
  date +%s > "\$HEARTBEAT_FILE"

  if [ -f "\$REQUEST_FILE" ]; then
    req_id="\$(read_kv id "\$REQUEST_FILE")"
    branch="\$(read_kv branch "\$REQUEST_FILE")"
    proxy_mode="\$(read_kv proxy_mode "\$REQUEST_FILE")"
    proxy_ip="\$(read_kv proxy_ip "\$REQUEST_FILE")"
    public_token="\$(read_kv public_token "\$REQUEST_FILE")"

    [ -n "\$branch" ] || branch="main"
    [ -n "\$proxy_mode" ] || proxy_mode="keep"

    last_id=""
    [ -f "\$LAST_ID_FILE" ] && last_id="\$(cat "\$LAST_ID_FILE" 2>/dev/null || true)"

    if [ -n "\$req_id" ] && [ "\$req_id" != "\$last_id" ]; then
      started_at="\$(date -Iseconds)"
      write_status "\$req_id" "running" "\$started_at" "" "" "\$branch" "" "\$public_token"

      : > "\$OUTPUT_FILE"
      cmd=(env IP_UTILS_SKIP_STDIN_BOOTSTRAP=1 IP_UTILS_SKIP_DAEMON_SETUP=1 bash "\$INSTALLER" --branch "\$branch" --update-now --proxy-mode "\$proxy_mode")
      if [ "\$proxy_mode" = "set" ] && [ -n "\$proxy_ip" ]; then
        cmd+=(--proxy-ip "\$proxy_ip")
      fi

      if "\${cmd[@]}" > "\$OUTPUT_FILE" 2>&1; then
        exit_code=0
        status="succeeded"
        error=""
      else
        exit_code=\$?
        status="failed"
        error="installer exited with code \$exit_code"
      fi

      ended_at="\$(date -Iseconds)"
      write_status "\$req_id" "\$status" "\$started_at" "\$ended_at" "\$exit_code" "\$branch" "\$error" "\$public_token"
      echo "\$req_id" > "\$LAST_ID_FILE"

      if [ "\$status" = "succeeded" ]; then
        schedule_daemon_refresh "\$req_id" || true
      fi
    fi
  fi

  sleep 2
done
EOF

  $SUDO chmod +x "$UPDATER_DAEMON_SCRIPT"

  $SUDO tee "/etc/systemd/system/$UPDATER_SERVICE_NAME" > /dev/null <<EOF
[Unit]
Description=ip-utils host updater daemon
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
ExecStart=$UPDATER_DAEMON_SCRIPT
Restart=always
RestartSec=2
User=root

[Install]
WantedBy=multi-user.target
EOF

  if ! $SUDO systemctl daemon-reload; then
    die "Failed to reload systemd for updater daemon ($UPDATER_SERVICE_NAME)."
  fi
  if ! $SUDO systemctl enable "$UPDATER_SERVICE_NAME" >/dev/null 2>&1; then
    die "Failed to enable updater daemon service ($UPDATER_SERVICE_NAME)."
  fi
  if ! $SUDO systemctl restart "$UPDATER_SERVICE_NAME"; then
    die "Failed to start updater daemon service ($UPDATER_SERVICE_NAME)."
  fi

  if ! $SUDO systemctl is-active --quiet "$UPDATER_SERVICE_NAME"; then
    die "Updater daemon service is not active after restart ($UPDATER_SERVICE_NAME). Check: journalctl -u $UPDATER_SERVICE_NAME -n 100 --no-pager"
  fi

  say "Update daemon installed and running ($UPDATER_SERVICE_NAME)."
  say "Note: a 'systemd-ssh-generator ... AF_VSOCK CID' warning from systemd can appear on some hosts and is non-fatal."
  return 0
}

parse_args "$@"

hr
say "ip-utils installer"
say "Repository: $REPO_URL"
say "Branch: $REPO_BRANCH"
hr
echo ""

if [ "$AUTO_REFRESH_DAEMON_ONLY" = "true" ]; then
  say "Refreshing updater daemon only ..."
  install_update_daemon
  say "Updater daemon refresh complete."
  exit 0
fi

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
  install_update_daemon
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
  local updater_status="unknown"
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  if [ -z "$LOCAL_IP" ]; then LOCAL_IP="<server-ip>"; fi

  if command -v systemctl >/dev/null 2>&1; then
    if $SUDO systemctl is-active --quiet "$UPDATER_SERVICE_NAME"; then
      updater_status="active"
    else
      updater_status="inactive"
    fi
  else
    updater_status="unsupported (no systemd)"
  fi

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
  say "Updater daemon: $UPDATER_SERVICE_NAME ($updater_status)"
  say "To stop:         docker stop $CONTAINER_NAME"
  say "To view logs:    docker logs $CONTAINER_NAME"
  if [ "$updater_status" = "inactive" ]; then
    say "Daemon logs:     journalctl -u $UPDATER_SERVICE_NAME -n 100 --no-pager"
  fi
  echo ""
}

EXISTING_CONTAINER=false
if $SUDO docker container inspect "$CONTAINER_NAME" &>/dev/null; then
  EXISTING_CONTAINER=true
fi

if [ "$EXISTING_CONTAINER" = "true" ]; then
  if [ "$AUTO_UPDATE_NOW" != "true" ]; then
    say "Ensuring updater daemon is installed ..."
    install_update_daemon
  fi

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

  if [ "$AUTO_UPDATE_NOW" = "true" ]; then
    case "$AUTO_PROXY_MODE" in
      remove) EXISTING_TRUST_PROXY="" ;;
      set) EXISTING_TRUST_PROXY="$AUTO_PROXY_IP" ;;
      *) : ;;
    esac

    echo ""
    hr
    say "Running non-interactive update..."
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

if [ "$AUTO_UPDATE_NOW" = "true" ]; then
  die "--update-now requires an existing ip-utils installation/container."
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
