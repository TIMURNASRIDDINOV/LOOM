# 🔧 Troubleshooting Guide - Order Submission System

## Common Issues & Solutions

---

## 📋 Table of Contents

1. [Orders Not Saving](#orders-not-saving)
2. [CORS Errors](#cors-errors)
3. [Canvas Export Issues](#canvas-export-issues)
4. [Validation Problems](#validation-problems)
5. [Loading State Stuck](#loading-state-stuck)
6. [No Response from Google Sheets](#no-response-from-google-sheets)
7. [Image Storage Issues](#image-storage-issues)
8. [Performance Issues](#performance-issues)

---

## 1. Orders Not Saving

### Symptom

- Form submits successfully
- Success notification shows
- But no row appears in Google Sheet

### Possible Causes & Solutions

#### ❌ Wrong Web App URL

**Check:**

```javascript
const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/.../exec";
```

**Solution:**

1. Go to Apps Script editor
2. Click **Deploy → Manage deployments**
3. Copy the Web App URL (must end with `/exec`)
4. Update in configurator.html
5. Hard refresh browser (Cmd+Shift+R or Ctrl+Shift+R)

#### ❌ Apps Script Not Deployed

**Solution:**

1. Open Apps Script editor
2. **Deploy → New deployment**
3. Type: **Web app**
4. Execute as: **Me**
5. Who has access: **Anyone**
6. Click **Deploy**

#### ❌ Apps Script Has Errors

**Check:**

1. Apps Script editor → **Executions** tab
2. Look for failed executions (red X)
3. Click to view error message

**Common errors:**

```javascript
// Error: Cannot call method "getActiveSheet" of null
// Fix: Make sure you have an active sheet

// Error: SpreadsheetApp not defined
// Fix: Check you're in bound script, not standalone
```

#### ❌ Sheet Name Mismatch

**Solution:**

- Apps Script expects sheet named "Orders"
- Or update script to use different name:

```javascript
let sheet = ss.getSheetByName("YourSheetName");
```

---

## 2. CORS Errors

### Symptom

```
Access to fetch at '...' from origin '...' has been blocked by CORS policy
```

### Solutions

#### ✅ Ensure no-cors Mode

```javascript
fetch(GOOGLE_SHEETS_URL, {
  method: "POST",
  mode: "no-cors", // ← Must have this
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(data),
});
```

#### ✅ Verify Deployment

- Apps Script must be **deployed** (not just saved)
- Deployment must be **active**
- Access must be set to **Anyone**

#### ✅ Check URL Format

```
✅ Correct:  https://script.google.com/macros/s/ABC.../exec
❌ Wrong:    https://script.google.com/home/projects/...
❌ Wrong:    https://script.google.com/macros/s/ABC.../dev
```

---

## 3. Canvas Export Issues

### Symptom

- Canvas appears blank in exported image
- `exportCanvasAsImage()` returns null
- Console error: "Tainted canvas"

### Solutions

#### ❌ CORS-Tainted Canvas

**Problem:** Images loaded without CORS headers

**Solution:**

```javascript
const img = new Image();
img.crossOrigin = "anonymous"; // ← Add this
img.onload = function () {
  // Use image
};
img.src = imageUrl;
```

#### ❌ Images Not Loaded

**Solution:** Wait for images to load

```javascript
function loadTshirtImage(color) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      state.tshirtImage = img;
      resolve();
    };
    img.onerror = reject;
    img.src = colorImages[color];
  });
}

// Then await before exporting
await loadTshirtImage("white");
const imageData = exportCanvasAsImage();
```

#### ❌ Canvas Context Lost

**Solution:** Check canvas exists

```javascript
function exportCanvasAsImage() {
  if (!canvas || !canvas.getContext) {
    console.error("Canvas not available");
    return null;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.error("Canvas context not available");
    return null;
  }

  // Proceed with export...
}
```

---

## 4. Validation Problems

### Symptom

- Form submits even with invalid data
- Validation messages don't appear
- Error styling not applied

### Solutions

#### ❌ Missing Error Elements

**Check HTML:**

```html
<div class="form-field">
  <label for="nameInput">Name</label>
  <input type="text" id="nameInput" class="form-input" />
  <span class="field-error" id="nameInputError"></span>
  <!-- ← Must exist -->
</div>
```

#### ❌ Field IDs Don't Match

**Verify IDs match between HTML and JS:**

```javascript
// In configuration
FORM_IDS: {
  name: 'nameInput',  // ← Must match HTML id="nameInput"
}
```

#### ❌ Validation Logic Not Running

**Debug:**

```javascript
function validateName() {
  console.log("Validating name:", this.elements.nameInput.value);
  // ... rest of validation
  console.log("Validation result:", isValid);
  return isValid;
}
```

---

## 5. Loading State Stuck

### Symptom

- Submit button shows spinner forever
- Button stays disabled
- No error or success message

### Solutions

#### ❌ Error Not Caught

**Solution:** Wrap in try-catch

```javascript
async function handleOrderSubmit(event) {
  event.preventDefault();

  showLoadingState();

  try {
    await sendToGoogleSheets(orderData);
    showSuccessNotification();
  } catch (error) {
    console.error("Submission failed:", error);
    showErrorNotification();
  } finally {
    hideLoadingState(); // ← Always runs
  }
}
```

#### ❌ Missing Finally Block

**Always reset UI in finally:**

```javascript
finally {
  submitBtn.disabled = false;
  submitText.style.display = 'block';
  submitLoader.style.display = 'none';
}
```

---

## 6. No Response from Google Sheets

### Symptom

- Request completes but can't read response
- `response.json()` fails
- Can't tell if submission succeeded

### Understanding no-cors Mode

**With `mode: 'no-cors'`:**

- ✅ Request succeeds
- ❌ Cannot read response body
- ❌ Cannot read status code
- ❌ Cannot read headers

**This is expected behavior!**

### Solutions

#### ✅ Assume Success if No Error

```javascript
try {
  await fetch(url, { mode: 'no-cors', ... });
  // If we get here, assume success
  showSuccessNotification();
} catch (error) {
  // Network error or fetch failed
  showErrorNotification();
}
```

#### ✅ Verify in Google Sheet

- Orders should appear in sheet
- Check Apps Script execution logs
- Look at timestamp of last execution

#### ✅ Add Logging to Apps Script

```javascript
function doPost(e) {
  Logger.log('Request received at: ' + new Date());
  Logger.log('Request data: ' + e.postData.contents);

  try {
    // Process order...
    Logger.log('Order saved successfully');
    return success response;
  } catch (error) {
    Logger.log('Error: ' + error.toString());
    return error response;
  }
}
```

---

## 7. Image Storage Issues

### Symptom

- Large base64 strings fail
- Cell size limit exceeded
- Image not visible in sheet

### Solutions

#### ❌ Base64 Too Large

**Solution 1:** Store in separate Google Drive

```javascript
// In Apps Script
function saveDesignImage(base64Data, orderRow) {
  const blob = Utilities.newBlob(
    Utilities.base64Decode(base64Data.split(",")[1]),
    "image/png"
  );

  const folder = DriveApp.getFolderByName("LOOM Orders");
  const file = folder.createFile(blob);
  const url = file.getUrl();

  // Store URL instead of base64
  sheet.getRange(orderRow, imageColumn).setValue(url);

  return url;
}
```

**Solution 2:** Reduce image quality

```javascript
// Reduce quality to 80%
const imageData = canvas.toDataURL("image/png", 0.8);

// Or reduce canvas size before export
const tempCanvas = document.createElement("canvas");
tempCanvas.width = 300; // Half size
tempCanvas.height = 350;
const tempCtx = tempCanvas.getContext("2d");
tempCtx.drawImage(canvas, 0, 0, 300, 350);
const imageData = tempCanvas.toDataURL("image/png");
```

**Solution 3:** Store link only

```javascript
// In spreadsheet, just note "Image attached"
designPreview: data.designPreview ? "Image attached" : "No image";
```

---

## 8. Performance Issues

### Symptom

- Slow form submission
- Long wait for response
- Browser freezes

### Solutions

#### ❌ Large Images

**Solution:** Optimize canvas export

```javascript
// Reduce canvas dimensions for export
function exportOptimizedCanvas() {
  const maxWidth = 600;
  const maxHeight = 700;

  const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height, 1);

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width * scale;
  exportCanvas.height = canvas.height * scale;

  const ctx = exportCanvas.getContext("2d");
  ctx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);

  return exportCanvas.toDataURL("image/png", 0.85);
}
```

#### ❌ Too Much Data

**Solution:** Send only essential fields

```javascript
// Remove unnecessary fields
const orderData = {
  // Required fields only
  customerName: name,
  customerPhone: phone,
  tshirtColor: color,
  tshirtSize: size,
  // Skip: userAgent, screenResolution, etc.
};
```

#### ❌ Blocking UI

**Solution:** Use setTimeout for async operations

```javascript
setTimeout(async () => {
  try {
    await sendToGoogleSheets(orderData);
  } catch (error) {
    console.error(error);
  }
}, 100);
```

---

## 🔍 Debugging Checklist

### Client-Side (Browser)

1. **Open DevTools** (F12)
2. **Console Tab** - Look for errors
3. **Network Tab** - Check request:
   - ✅ Request sent (200 status)
   - ✅ URL is correct
   - ✅ Method is POST
   - ✅ Payload has data
4. **Check Variables:**
   ```javascript
   console.log("Canvas state:", state);
   console.log("Order data:", orderData);
   console.log("Canvas element:", canvas);
   ```

### Server-Side (Google Apps Script)

1. **Open Apps Script Editor**
2. **View → Executions**
3. **Check for:**
   - ✅ Recent executions
   - ✅ Success status (green checkmark)
   - ❌ Failed executions (red X)
4. **Click execution** to see logs
5. **Add debug logs:**
   ```javascript
   Logger.log("Step 1: Parsing data");
   Logger.log("Data: " + JSON.stringify(data));
   Logger.log("Step 2: Saving to sheet");
   ```

---

## 🧪 Test Suite

### Test 1: Basic Submission

```javascript
// In browser console
const testData = {
  customerName: "Test",
  customerPhone: "+998 90 123-45-67",
  tshirtColor: "white",
  tshirtSize: "M",
  designText: "TEST",
  price: 150000,
};

fetch(GOOGLE_SHEETS_URL, {
  method: "POST",
  mode: "no-cors",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(testData),
})
  .then(() => console.log("✅ Request sent"))
  .catch((err) => console.error("❌ Error:", err));
```

### Test 2: Canvas Export

```javascript
// In browser console
const imageData = canvas.toDataURL("image/png");
console.log("Image size:", imageData.length, "characters");
console.log("Image preview:", imageData.substring(0, 50) + "...");

// Should start with: data:image/png;base64,iVBORw0KG...
```

### Test 3: Form Validation

```javascript
// In browser console
orderHandler.validateName(); // Should return true/false
orderHandler.validatePhone(); // Should return true/false
orderHandler.validateAddress(); // Should return true/false
```

### Test 4: Apps Script (Server)

```javascript
// In Apps Script editor → Run → testScript
function testScript() {
  const testData = {
    postData: {
      contents: JSON.stringify({
        customerName: "Test User",
        customerPhone: "+998 90 123-45-67",
        timestamp: new Date().toISOString(),
      }),
    },
  };

  const result = doPost(testData);
  Logger.log("Result: " + result.getContent());
}
```

---

## 📞 Getting Help

### Where to Look

1. **Browser Console** (F12 → Console)

   - JavaScript errors
   - Network requests
   - Variable values

2. **Apps Script Logs** (Executions tab)

   - Server-side errors
   - Request data
   - Execution timeline

3. **Google Sheet**
   - Check if data appears
   - Verify column headers
   - Check for empty rows

### What to Include When Asking for Help

1. **Error Message** (exact text)
2. **Browser & Version** (Chrome 120, Safari 17, etc.)
3. **Console Logs** (screenshot or copy-paste)
4. **Network Tab** (screenshot of failed request)
5. **Apps Script Execution Logs**
6. **What You've Tried**

---

## ✅ Prevention Checklist

Before going live:

- [ ] Test with real form data
- [ ] Test with different browsers
- [ ] Test with different devices (mobile, tablet)
- [ ] Test with slow internet connection
- [ ] Verify all data appears in sheet correctly
- [ ] Test canvas export with different designs
- [ ] Test validation with invalid inputs
- [ ] Check Apps Script execution quota
- [ ] Set up monitoring/alerts
- [ ] Document configuration for team

---

## 🚑 Emergency Fixes

### Quick Rollback

If something breaks in production:

1. **Revert configurator.html** to previous version
2. **Temporarily disable form:**
   ```javascript
   // At top of submit handler
   alert(
     "Order submission temporarily unavailable. Please contact us directly."
   );
   return;
   ```

### Temporary Workaround

```javascript
// Send to email instead of Google Sheets
async function handleOrderSubmit(event) {
  event.preventDefault();

  const orderData = compileOrderData();

  // Email fallback
  const subject = `New Order from ${orderData.customerName}`;
  const body = JSON.stringify(orderData, null, 2);

  window.location.href = `mailto:your-email@example.com?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}
```

---

_Troubleshooting guide last updated: December 28, 2025_
