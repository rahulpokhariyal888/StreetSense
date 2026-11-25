# Putting StreetSense on a server

Pick one path.

| Path | Best for | Time | Cost |
|---|---|---|---|
| **A. Tunnel from your laptop** | Showing the site to judges or friends this week | 5 min | Free |
| **B. Your own server (VPS)** | A real, always-on site with your own domain | 1–2 hours | A small monthly fee |
| **C. "Free" app hosts (Render, Railway…)** | Not recommended | – | – |

---

## A. Share your laptop for a demo (Cloudflare Tunnel)

1. Start StreetSense as usual (`start.bat`). It must stay running.
2. Install the tunnel tool once (Windows PowerShell): `winget install Cloudflare.cloudflared`
3. In a second window run: `cloudflared tunnel --url http://localhost:8000`
4. It prints a link like `https://random-words.trycloudflare.com`. Anyone can open it while both windows stay open.

Notes: your laptop must stay on; the link changes every time; anyone with the link can create a citizen account, so do not leave it running unattended. Your admin account already exists in your `data` folder, so nobody can claim it.

---

## B. Your own server (Ubuntu VPS + HTTPS)

**You need:** an Ubuntu 24.04 VPS with at least 2 CPU cores, **4 GB RAM** and 20 GB disk (the AI model needs the memory), plus a domain name pointed at the server's IP (an "A record").

### 1. First login and firewall
```bash
ssh root@YOUR_SERVER_IP
adduser streetsense
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
# Only if the server has 2 GB RAM or less, add swap so the AI model does not crash:
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
```

### 2. Install the software
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs python3-venv python3-pip sqlite3 unzip
# Caddy (the web server that gives you free HTTPS): follow https://caddyserver.com/docs/install#debian-ubuntu-raspbian
node --version     # must be v22 or newer
```

### 3. Upload the project
On your Windows PC, zip your StreetSense folder **without** `.venv-ai`, `dataset` and `backups`. Keep `data` if you want to keep your admin account and reports, and keep `models/road_defects.pt`.
```bash
# on your PC (PowerShell)
scp StreetSense.zip root@YOUR_SERVER_IP:/tmp/
# on the server
mkdir -p /opt/streetsense && unzip /tmp/StreetSense.zip -d /opt/streetsense
# if the zip created a sub-folder, move its contents up so server.js sits directly in /opt/streetsense
chown -R streetsense:streetsense /opt/streetsense
```

### 4. Set up the AI (once)
```bash
su - streetsense
cd /opt/streetsense
python3 -m venv .venv-ai
.venv-ai/bin/pip install --upgrade pip
.venv-ai/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
.venv-ai/bin/pip install -r ai/requirements.txt
```
Your Windows `.venv-ai` cannot be copied. It must be rebuilt on the server like this. The server finds `.venv-ai/bin/python` by itself.

### 5. Test it, and create the admin BEFORE it is public
```bash
node server.js            # you should see "StreetSense 4.2 running at http://127.0.0.1:8000"
```
If you did **not** upload a `data` folder with an admin account, create one now, from the server itself, with a strong password. The first person to do this becomes admin, so do it before the site is reachable from the internet:
```bash
curl -X POST http://127.0.0.1:8000/api/auth/setup -H 'content-type: application/json' \
  -d '{"email":"you@example.com","name":"Your Name","password":"a-long-strong-password"}'
```
Press Ctrl+C to stop the test run, then type `exit` to go back to root.

### 6. Keep it running (systemd)
```bash
cp /opt/streetsense/deploy/streetsense.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now streetsense
systemctl status streetsense          # should say "active (running)"
journalctl -u streetsense -f          # live log (Ctrl+C to leave)
```

### 7. HTTPS and your domain (Caddy)
1. At your domain provider add an **A record**: `your-domain.example` → your server IP.
2. Copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile` and replace `your-domain.example` with your domain.
3. `systemctl reload caddy`
4. Open `https://your-domain.example`. HTTPS works automatically. The service file already sets `COOKIE_SECURE=1` so sign-in cookies are HTTPS-only.

### 8. Backups
```bash
chmod +x /opt/streetsense/deploy/backup.sh
sudo -u streetsense crontab -e      # add this line:  30 2 * * * /opt/streetsense/deploy/backup.sh
```
This keeps 14 days of database and photo backups in `/var/backups/streetsense` (create it and give the streetsense user write access: `mkdir -p /var/backups/streetsense && chown streetsense /var/backups/streetsense`). Also copy those backups off the server now and then.

### 9. Updating later
Upload the new files over `/opt/streetsense` (**never overwrite the `data` folder**), then `systemctl restart streetsense` and press Ctrl+F5 in the browser. If the Intelligence desk shows a "Version mismatch" banner, `server.js` and `insights.js` were not both updated.

---

## C. Why not Render / Railway / free hosts?
Your data lives in files (`data/streetsense.sqlite`, photos, videos). Most free hosts wipe the disk on every restart and have too little memory for the AI model. They can work only with a paid persistent disk plus `HOST=0.0.0.0`, so a small VPS is simpler and usually cheaper.

---

## Checklist before telling anyone the link
- [ ] Strong admin password; no test accounts left
- [ ] Do **not** press "Load sample Delhi dataset" on the live site
- [ ] `https://your-domain/data/streetsense.sqlite` and `https://your-domain/server.js` both show "Not Found"
- [ ] Sign in, restart the service (`systemctl restart streetsense`), reload: you are still signed in
- [ ] Upload one real photo report and check the AI result appears
- [ ] Backup script ran once by hand without errors
- [ ] Only ports 22, 80 and 443 are open (`ufw status`)

## Good to know
- Anyone can create a citizen account (that is how reporting works). Only admins can review, delete or use the desks.
- There is no login rate limiting yet, so keep Caddy/Cloudflare in front and use long passwords.
- One server with one SQLite file is fine for a pilot ward, not for a whole city.
- Settings you can change with environment variables: `PORT` (default 8000), `HOST` (default 127.0.0.1, keep it), `COOKIE_SECURE=1` (use with HTTPS), `PYTHON`, `STREETSENSE_MODEL`, `STREETSENSE_IMGSZ` (image size for the model; by default it uses the size the model was trained at).
