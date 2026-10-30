# Complete Docker Deployment Guide for Virtual Machine (VM)

This guide explains how to package, deploy, and run the complete **Milk Reception System** inside a Virtual Machine (Linux, Ubuntu, Debian, or Windows Server) using Docker and Docker Compose.

---

## Architecture Overview

The containerized stack includes:
1. **Next.js Web Application (`app` container)**:
   - Next.js 16 (App Router + React 19) on Node.js 22 LTS (Debian Bookworm Slim).
   - Serves the frontend and API routes on port `3000`.
   - Built with Prisma 7 client and automatic schema migration on startup.
2. **WhatsApp Gateway Daemon**:
   - Runs `scripts/whatsapp_service.js` on port `3001` inside the container.
   - WhatsApp QR session data is saved to a persistent Docker volume (`milk_reception_whatsapp_data`).
3. **PostgreSQL Database (`postgres` container)**:
   - Official PostgreSQL 16 Alpine image on port `5432`.
   - Database files are saved to a persistent Docker volume (`milk_reception_postgres_data`).
4. **Persistent Photo Storage**:
   - Captured photos and test documents are preserved in `milk_reception_storage_data` mounted at `/app/storage`.

---

## Method 1: Deploy Directly in the Virtual Machine (Recommended)

This is the cleanest and fastest method. You copy the project folder to the VM, and Docker builds the container natively inside the VM.

### Step 1: Copy Project Files to the VM

On your local machine, you can copy the project files to the VM using **SCP**, **Git**, or by zipping the folder.

*(Note: Do not copy `node_modules/` or `.next/`; Docker will build them cleanly inside the VM)*

Using `scp` (replace `user@vm-ip` with your VM user and IP):
```bash
# Example from PowerShell or Git Bash
scp -r C:\MilkReceptionApp user@192.168.1.100:/home/user/MilkReceptionApp
```
Or create a zip file excluding `node_modules` and extract it on the VM.

---

### Step 2: Configure Environment on the VM

SSH into your VM:
```bash
ssh user@192.168.1.100
cd /home/user/MilkReceptionApp
```

Create your `.env` configuration file from the template:
```bash
cp .env.docker.example .env
```

Edit `.env` (using `nano .env`):
- Change `POSTGRES_PASSWORD` to a strong secret.
- Update `NEXT_PUBLIC_APP_URL` to your VM's IP address (e.g., `http://192.168.1.100:3000`).
- Update `JWT_SECRET` to a random string (minimum 32 characters).
- (Optional) Set `RUN_SEED=true` if you want initial seed data created on first launch.

---

### Step 3: Launch with Docker Compose

Run the deployment script:
```bash
chmod +x scripts/deploy-vm.sh
./scripts/deploy-vm.sh
```

Or run Docker Compose directly:
```bash
docker compose up -d --build
```

Docker will:
1. Download Node 22 and PostgreSQL 16.
2. Install npm dependencies and generate the Prisma Client.
3. Build the optimized Next.js production bundle.
4. Launch PostgreSQL and verify its health.
5. Automatically run `prisma migrate deploy` to create all tables and indexes.
6. Launch the Next.js server on port `3000` and the WhatsApp gateway on port `3001`.

---

### Step 4: Access Your Application

Open your browser and visit:
- **Web Application:** `http://<VM-IP>:3000`
- **WhatsApp Gateway:** `http://<VM-IP>:3001` (or via `/whatsapp-gateway` in the web app)

---

## (Optional) Move Existing Local Database Data to the VM

If you already have records on your local machine that you want transferred to the VM:

### 1. Export local database (on your Windows machine)
Run the provided PowerShell export script:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\export-local-db.ps1
```
This generates `milk_reception_backup.sql` in your project folder.

### 2. Copy the backup file to your VM
```bash
scp milk_reception_backup.sql user@192.168.1.100:/home/user/MilkReceptionApp/
```

### 3. Import into the Docker PostgreSQL container (on the VM)
```bash
chmod +x scripts/import-db-docker.sh
./scripts/import-db-docker.sh milk_reception_backup.sql
```

---

## Method 2: Offline Image Export / Transfer (No Internet on VM)

If your virtual machine does not have an internet connection, you can build the Docker image on a machine that has Docker Desktop and transfer the image file.

### 1. Build the image locally
```bash
docker compose build
```

### 2. Save the image to a tar archive
```bash
docker save -o milk-reception-app.tar milk-reception-app:latest
docker pull postgres:16-alpine
docker save -o postgres-16.tar postgres:16-alpine
```

### 3. Transfer the `.tar` files and `docker-compose.yml` to the VM
```bash
scp milk-reception-app.tar postgres-16.tar docker-compose.yml .env user@<VM-IP>:/home/user/app/
```

### 4. Load the images on the VM
```bash
docker load -i milk-reception-app.tar
docker load -i postgres-16.tar
```

### 5. Start containers on the VM
```bash
docker compose up -d
```

---

## Useful Day-to-Day Operations

| Action | Command |
| :--- | :--- |
| **Check container status** | `docker compose ps` |
| **View real-time logs** | `docker compose logs -f` |
| **View application logs only** | `docker compose logs -f app` |
| **Restart services** | `docker compose restart` |
| **Stop all services** | `docker compose down` |
| **Run Prisma Seed manually** | `docker compose exec app npm run db:seed` |
| **Execute command inside container** | `docker compose exec app sh` |
| **Access PostgreSQL CLI** | `docker compose exec postgres psql -U postgres -d milk_reception_db` |
| **Update to latest code** | `git pull && docker compose up -d --build` |
