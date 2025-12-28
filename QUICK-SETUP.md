# 🚀 Quick Setup Guide - LOOM Order Submission

## ⚡ 5-Minute Setup

### Step 1: Create Google Sheet (1 min)

1. Go to [sheets.google.com](https://sheets.google.com)
2. Create new sheet: "LOOM Orders"
3. Done! (Headers will be auto-created)

### Step 2: Deploy Apps Script (2 min)

1. In Google Sheet: **Extensions → Apps Script**
2. Delete existing code
3. Copy & paste code from `google-apps-script.js`
4. **Deploy → New deployment**
5. Type: **Web app**
6. Execute as: **Me**
7. Access: **Anyone**
8. Click **Deploy** → **Copy Web App URL**

### Step 3: Update Your Website (1 min)

1. Open `configurator.html`
2. Find line with `GOOGLE_SHEETS_URL` (around line 2249)
3. Replace with your Web App URL:

```javascript
const GOOGLE_SHEETS_URL = "YOUR_WEB_APP_URL_HERE";
```

4. Save file

### Step 4: Test (1 min)

1. Open `configurator.html` in browser
2. Configure a T-shirt design
3. Fill order form
4. Click "Оформить заказ"
5. Check Google Sheet → New row should appear! ✅

---

## 📱 What Gets Saved?

Every order includes:

- ✅ Customer name, phone, address
- ✅ T-shirt color, size
- ✅ Design text, font, color
- ✅ Canvas preview (PNG image)
- ✅ Price and timestamp
- ✅ Device info (browser, screen)

---

## 🔧 Already Integrated Files

### ✅ configurator.html

**Updated with:**

- Canvas export function
- Google Sheets submission
- Error handling
- Success notifications

**Just update the URL on line ~2249:**

```javascript
const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/YOUR_ID/exec";
```

### 📦 Standalone Module (Optional)

If you prefer modular code:

- `google-sheets-order-module.js` - Reusable class
- `order-submission-example.html` - Integration example

---

## 🎯 Quick Reference

### Your Files:

```
LOOM/
├── configurator.html              ← Already integrated! ✅
├── google-sheets-order-module.js  ← Standalone version
├── google-apps-script.js          ← Copy to Google Apps Script
├── order-submission-example.html  ← Test/demo page
├── README-ORDER-MODULE.md         ← Full documentation
└── QUICK-SETUP.md                 ← This file
```

### Your Web App URL:

```
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

Replace `YOUR_DEPLOYMENT_ID` with your actual ID

---

## 🐛 Troubleshooting

### "Orders not saving"

- ✅ Check Web App URL is correct
- ✅ Verify deployment set to "Anyone" access
- ✅ Check browser console (F12) for errors

### "CORS error"

- ✅ Make sure Apps Script is **deployed** (not just saved)
- ✅ Check `mode: 'no-cors'` is in fetch options

### "Permission denied"

- ✅ Re-authorize Apps Script
- ✅ Make sure "Execute as: Me" is selected

---

## 💡 Pro Tips

1. **Test First**: Use `order-submission-example.html` to test integration
2. **Check Logs**: Apps Script → Executions tab shows all requests
3. **Image Storage**: Large canvas images → stored in Google Drive
4. **Dashboard**: Run `createDashboard()` in Apps Script for stats

---

## 📞 Need Help?

1. Check browser console (F12 → Console tab)
2. Check Apps Script logs (Executions tab)
3. Test with example HTML file first
4. Read full docs in `README-ORDER-MODULE.md`

---

## ✨ You're Ready!

Your configurator is now connected to Google Sheets. Every order will automatically appear in your spreadsheet with all details and design preview.

**Happy selling! 🎉**

---

## 🔗 Useful Links

- [Google Apps Script Docs](https://developers.google.com/apps-script)
- [Google Sheets API](https://developers.google.com/sheets/api)
- [Fetch API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)

---

_Last updated: December 28, 2025_
