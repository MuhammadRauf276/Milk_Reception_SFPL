# Milk Reception App - Live Production Workflow Guide

This document describes the 2-step automated process to develop locally and update the live production server at **`https://mpd.sfpl.com.pk`**.

---

## 🔁 The Complete 2-Step Workflow

```
[Local Computer: C:\MilkReceptionApp]
   │ 1. Make code changes, test locally
   ▼
Double-click: push-to-github.bat   (Auto-stages, commits, and pushes to GitHub)
   │
   ▼
[GitHub Repository]
   │
   ▼
[Live Windows Server VM: C:\app]
Double-click: update.bat           (Auto-pulls, syncs DB migrations, builds, and reloads PM2)
```

---

### Step 1: On Your Local Computer

Whenever you finish working or make any changes:

1. Double-click **`push-to-github.bat`** (located in `C:\MilkReceptionApp`).
2. Type a short description of what you changed (e.g. `improved login screen`) and press **Enter**.
3. It will automatically stage, commit, and push your changes to GitHub.

---

### Step 2: On the Virtual Machine (Live Server)

To update the live server with your latest changes:

1. Open your Virtual Machine via RDP.
2. Double-click **`C:\app\update.bat`** (or create a shortcut on the VM Desktop).
3. `update.bat` will automatically:
   - Pull the latest code from GitHub (`git pull origin main`).
   - Run database schema sync and migrations (`migrate deploy`).
   - Clean temporary dev caches and build production Next.js (`npm run build`).
   - Gracefully reload PM2 production services (`pm2 restart ecosystem.config.js`).
   - Save the PM2 process list (`pm2 save`).

In ~40 seconds, the live domain `https://mpd.sfpl.com.pk` is updated with **zero manual terminal commands required**!

---

## 🛠️ Emergency Server Commands (Cheat Sheet)

If you ever need to check the server status in PowerShell at `PS C:\app`:

| Action | Command |
| :--- | :--- |
| **Check service status** | `pm2 status` |
| **View live logs** | `pm2 logs milk-app --lines 30` |
| **Restart all services** | `pm2 restart ecosystem.config.js` |
| **Restart WhatsApp only** | `pm2 restart whatsapp-gateway` |
| **Restore after reboot** | `pm2 resurrect` |
| **Full 1-click update** | `.\update.bat` |
