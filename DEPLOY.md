# JajaCare API — Deployment Guide

> This guide is for the person helping deploy this project. Follow steps 1-6 in order.

---

## What is already done
- All source code is complete and tested (151 unit tests passing)
- Dockerfile and docker-compose.yml are ready
- GitHub Actions CI is configured (.github/workflows/ci.yml)
- .env.example has all required variables documented

## What you need to do

---

## Step 1 - Get a free PostgreSQL database (Neon)

1. Go to https://neon.tech and sign up (free, no credit card)
2. Create a new project, name it jajacare
3. Copy the connection string - it looks like:
   postgresql://jajacare_owner:xxxx@ep-xxx.us-east-2.aws.neon.tech/jajacare?sslmode=require
4. Keep this, you will use it in Steps 2 and 4

Alternative: Railway, Supabase, or any PostgreSQL 16+ provider works.
The extension btree_gist must be allowed (it is on all major providers).

---

## Step 2 - Generate database migrations (run on your machine)

You need Node.js 22+ and the connection string from Step 1.

  git clone <repo-url>
  cd jajacare-api
  npm install
  cp .env.example .env

Edit .env and set:
  DATABASE_URL=<your-neon-connection-string>
  JWT_ACCESS_SECRET=<run: openssl rand -hex 32>

Then:
  npx prisma migrate dev --name init
  npx prisma migrate dev --create-only --name appointment_constraints

After the second command, open the new migration file at:
  prisma/migrations/<timestamp>_appointment_constraints/migration.sql

Paste the entire contents of prisma/sql/appointment_no_overlap.sql into it, then:
  npx prisma migrate dev

Commit and push:
  git add prisma/migrations
  git commit -m "Add database migrations"
  git push

---

## Step 3 - Create a GitHub repository

1. Go to https://github.com/new
2. Name it jajacare-api, set it to Private
3. Do NOT add README, .gitignore, or license (the repo already has them)
4. Push the code:
   git remote add origin https://github.com/<your-username>/jajacare-api.git
   git branch -M main
   git push -u origin main

---

## Step 4 - Deploy on Railway (recommended - free tier)

1. Go to https://railway.app and sign in with GitHub
2. Click New Project > Deploy from GitHub repo > select jajacare-api
3. Set these environment variables in Railway dashboard:

   NODE_ENV         = production
   DATABASE_URL     = your Neon/Railway Postgres URL
   JWT_ACCESS_SECRET= 32+ char random string (openssl rand -hex 32)
   CORS_ORIGINS     = https://your-frontend.vercel.app,https://your-frontend-*.vercel.app
   TRUST_PROXY      = 1

4. Railway auto-detects the Dockerfile and deploys
5. Set health check to: GET /api/v1/health
6. Copy the deployed URL (e.g. https://jajacare-api-production.up.railway.app)

---

## Step 5 - Create the first admin account

In Railway dashboard > your service > Shell:

  ADMIN_STAFF_ID=JC-ADM-001 \
  ADMIN_EMAIL=admin@jajacare.local \
  ADMIN_PASSWORD=ChangeThisNow1! \
  node dist/scripts/bootstrap-admin.js

Run once only. Forces password change at first login.

---

## Step 6 - Details for the frontend developer

API Base URL:   https://<your-railway-url>/api/v1
Swagger Docs:   Disabled in production. Use staging env to explore the API.
Health Check:   https://<your-railway-url>/api/v1/health

Seed accounts (staging/dev only - blocked in production):
  JC-ADM-001  |  admin@jajacare.local      |  Admin         |  SEED_PASSWORD value
  JC-REC-001  |  reception@jajacare.local  |  Receptionist  |  SEED_PASSWORD value
  JC-NUR-001  |  nurse@jajacare.local      |  Nurse         |  SEED_PASSWORD value
  JC-DOC-001  |  doctor@jajacare.local     |  Doctor        |  SEED_PASSWORD value

To run seed on staging: npm run db:seed

---

## Known Limitations

Password reset email: Not built. Admins reset passwords from the Users screen.
Notifications: In-memory only. Fine for single instance; needs Redis to scale.
Swagger: Disabled in production (NODE_ENV=production).

---

## More docs

- docs/frontend-integration.md  - full API contract for the frontend team
- docs/deployment.md            - additional deployment notes
- README.md                     - full feature list and architecture overview
