#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# EC2 Setup Script for Outreach Tool
# Run once on a fresh Ubuntu 22.04 t2.micro instance as the ubuntu user.
# Usage: bash setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

APP_DIR="/home/ubuntu/outreach-tool"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"

echo "────────────────────────────────────────────"
echo " Outreach Tool — EC2 Setup"
echo "────────────────────────────────────────────"

# ── 1. System packages ────────────────────────────────────────────────────────
echo "[1/8] Updating system packages..."
sudo apt-get update -q
sudo apt-get install -y -q python3 python3-venv python3-pip nginx git curl unzip

# ── 2. Node.js 20 ─────────────────────────────────────────────────────────────
echo "[2/8] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null 2>&1
sudo apt-get install -y -q nodejs

# ── 3. Python virtualenv ──────────────────────────────────────────────────────
echo "[3/8] Creating Python virtualenv and installing dependencies..."
python3 -m venv "$BACKEND_DIR/venv"
"$BACKEND_DIR/venv/bin/pip" install --quiet --upgrade pip
"$BACKEND_DIR/venv/bin/pip" install --quiet -r "$BACKEND_DIR/requirements.txt"

# ── 4. Build React frontend ───────────────────────────────────────────────────
echo "[4/8] Building React frontend..."
cd "$FRONTEND_DIR"
npm install --silent
npm run build

# ── 5. Init database ──────────────────────────────────────────────────────────
echo "[5/8] Initialising SQLite database..."
cd "$BACKEND_DIR"
"$BACKEND_DIR/venv/bin/python" -c "from db import init_db; init_db(); print('  DB ready.')"

# ── 6. Nginx config ───────────────────────────────────────────────────────────
echo "[6/8] Configuring Nginx..."
sudo cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/outreach
sudo ln -sf /etc/nginx/sites-available/outreach /etc/nginx/sites-enabled/outreach
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

# ── 7. Systemd services ───────────────────────────────────────────────────────
echo "[7/8] Installing systemd services..."
sudo cp "$APP_DIR/deploy/outreach-api.service"    /etc/systemd/system/outreach-api.service
sudo cp "$APP_DIR/deploy/outreach-worker.service" /etc/systemd/system/outreach-worker.service
sudo systemctl daemon-reload
sudo systemctl enable outreach-api outreach-worker
sudo systemctl start  outreach-api outreach-worker

# ── 8. Firewall ───────────────────────────────────────────────────────────────
echo "[8/8] Configuring firewall..."
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw --force enable

echo ""
echo "────────────────────────────────────────────"
echo " Setup complete!"
echo " API:     http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
echo " Logs:    sudo journalctl -u outreach-api -f"
echo "          sudo journalctl -u outreach-worker -f"
echo "          tail -f $BACKEND_DIR/worker.log"
echo "────────────────────────────────────────────"
