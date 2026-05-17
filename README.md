# QR Attendance System

Mobile-friendly school attendance tracker with QR code scanning. Works offline and syncs to Supabase when online.

## Features
- Generate QR codes per student — print and distribute
- Scan multiple QR codes quickly with your phone camera
- Works offline — syncs to cloud when back online
- Attendance history per section and date
- Per-student attendance rate reports
- Export to CSV / Excel

---

## Setup Guide

### Step 1 — Supabase (Database)

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Click **New Project** — give it a name (e.g. `qr-attendance`)
3. Wait for the project to finish setting up (~1 min)
4. Go to **SQL Editor** (left sidebar)
5. Click **New Query**, paste the contents of `sql/schema.sql`, and click **Run**
6. Go to **Project Settings → API**
7. Copy your **Project URL** and **anon/public key**
8. Open `js/config.js` and replace the placeholders:

```js
const SUPABASE_URL = 'https://your-project-id.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key-here';
```

---

### Step 2 — GitHub (Hosting)

1. Go to [github.com](https://github.com) and sign in (or create a free account)
2. Click **New repository**
   - Name: `qr-attendance` (or anything you want)
   - Set to **Public**
   - Click **Create repository**
3. Upload your files:
   - Click **uploading an existing file** on the repo page
   - Drag and drop ALL your project files (keeping the folder structure)
   - Click **Commit changes**

---

### Step 3 — GitHub Pages (Free Hosting)

1. In your GitHub repo, go to **Settings**
2. Scroll down to **Pages** (left sidebar)
3. Under **Source**, select `main` branch and `/ (root)` folder
4. Click **Save**
5. Wait 1–2 minutes — your app will be live at:
   ```
   https://YOUR_GITHUB_USERNAME.github.io/qr-attendance/
   ```

---

### Step 4 — Open on Mobile

- Open the URL above on your phone browser (Chrome or Safari)
- Add to Home Screen for app-like experience:
  - **iPhone**: tap Share → Add to Home Screen
  - **Android**: tap menu (⋮) → Add to Home Screen

---

## File Structure

```
qr-attendance/
├── index.html          ← Main app
├── css/
│   └── style.css       ← Stylesheet
├── js/
│   ├── config.js       ← Supabase keys (edit this!)
│   └── app.js          ← All app logic
├── sql/
│   └── schema.sql      ← Run this in Supabase SQL Editor
└── README.md
```

---

## How to Use

### First time setup
1. Go to **Students** tab
2. Add your sections/classes (e.g. "Grade 7-A")
3. Add students with their name and LRN/ID
4. Go to **QR Codes** tab → tap **Print All QR**
5. Print and give each student their QR card

### Taking attendance
1. Go to **Scan** tab
2. Select section and date
3. Tap **Start Scanning**
4. Students hold their QR card in front of the camera one at a time
5. System marks them Present instantly

### Viewing records
- **History** tab — see all sessions per section
- **Report** tab — attendance rates per student, export to CSV

---

## Offline Support

The app saves all data locally on the device. Any scans done offline are queued and automatically synced to Supabase when the internet connection is restored.
