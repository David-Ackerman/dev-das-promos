#!/usr/bin/env bash
# One-time setup of the Evolution API server on a fresh Ubuntu VM
# (Google Cloud e2-micro free tier; also works on Oracle Cloud or any VPS).
# Safe to run again: it keeps an existing .env.
# Usage, on the VM:  bash deploy/evolution/setup.sh
set -euo pipefail
cd "$(dirname "$0")"

# 1. Docker
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# 1b. Swap, so a 1 GB VM (Google e2-micro, Oracle E2.1.Micro) doesn't run out of memory.
if [ "$(free -m | awk '/Mem:/ {print $2}')" -lt 2000 ] && ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# 2. Open ports 80/443 in the VM's own firewall too. Oracle's Ubuntu images block
#    them even after you open them in the cloud console; Google's allow everything,
#    so this is a no-op there. Inserted at the top: position 1 always exists.
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
    sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
if ! command -v netfilter-persistent >/dev/null; then
  # Fresh cloud images can have empty package lists.
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null
fi
sudo netfilter-persistent save >/dev/null

# 3. Settings: a free hostname for this IP (sslip.io) and random secrets.
if [ ! -f .env ]; then
  ip=$(curl -fsS https://api.ipify.org)
  {
    echo "DOMAIN=${ip//./-}.sslip.io"
    echo "AUTHENTICATION_API_KEY=$(openssl rand -hex 24)"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
  } > .env
  chmod 600 .env
fi

# 4. Start (or update) everything.
sudo docker compose --env-file .env up -d --pull always

set -a; . ./.env; set +a
echo
echo "Evolution API is starting at https://$DOMAIN (the certificate can take a minute)."
echo "Put these in GitHub → Settings → Environments → production:"
echo "  Variable  EVOLUTION_API_URL = https://$DOMAIN"
echo "  Variable  EVOLUTION_INSTANCE = promos"
echo "  Secret    EVOLUTION_API_KEY  = $AUTHENTICATION_API_KEY"
