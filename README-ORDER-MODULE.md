# 📦 Google Sheets Order Submission Module

A complete, modular solution for sending T-shirt configurator orders to Google Sheets via Google Apps Script Web App.

## 🎯 Features

- ✅ **Canvas Export**: Automatically exports design canvas as PNG base64
- ✅ **Form Validation**: Built-in validation for name, phone, and address
- ✅ **Google Sheets Integration**: Direct submission via fetch() API
- ✅ **User Feedback**: Success/error notifications with loading states
- ✅ **Modular Design**: Drop-in solution, easy to integrate
- ✅ **ES6+ Syntax**: Modern JavaScript with classes
- ✅ **Customizable**: Easy configuration via config object
- ✅ **Zero Dependencies**: Pure vanilla JavaScript

---

## 📋 Quick Start

### 1. Set Up Google Sheets Web App

First, you need to create a Google Apps Script to receive the orders:

#### Step 1: Create a new Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new spreadsheet named "LOOM Orders"
3. Add column headers in the first row:
   ```
   Timestamp | Date | Customer Name | Surname | Phone | Address | Coordinates |
   Color | Size | Text | Font | Text Color | Text Size | Has Image | Price | Design Preview
   ```

#### Step 2: Create Apps Script

1. In your Google Sheet, go to **Extensions > Apps Script**
2. Delete any existing code
3. Paste this code:

```javascript
function doPost(e) {
  try {
    // Parse incoming JSON data
    const data = JSON.parse(e.postData.contents);

    // Get the active spreadsheet
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // Prepare row data
    const row = [
      data.timestamp || new Date().toISOString(),
      data.orderDate || new Date().toLocaleString("ru-RU"),
      data.customerName || "",
      data.customerSurname || "",
      data.customerPhone || "",
      data.deliveryAddress || "",
      data.deliveryCoordinates || "",
      data.tshirtColor || "",
      data.tshirtSize || "",
      data.designText || "",
      data.designFont || "",
      data.designTextColor || "",
      data.designTextSize || "",
      data.hasCustomImage ? "Да" : "Нет",
      data.priceFormatted || data.price || "",
      // Note: Design preview (base64 image) can be very large
      // Optionally store it separately or truncate
      data.designPreview ? "Image attached" : "No image",
    ];

    // Append the new row
    sheet.appendRow(row);

    // Return success response
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        message: "Order received",
        rowNumber: sheet.getLastRow(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    // Return error response
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        message: error.toString(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// Optional: doGet for testing
function doGet() {
  return ContentService.createTextOutput("LOOM Order API is running");
}
```

#### Step 3: Deploy as Web App

1. Click **Deploy > New deployment**
2. Click the gear icon ⚙️ and select **Web app**
3. Configure:
   - **Description**: "LOOM Order Submission API"
   - **Execute as**: Me (your email)
   - **Who has access**: Anyone
4. Click **Deploy**
5. **Copy the Web App URL** (it will look like `https://script.google.com/macros/s/AKfycb.../exec`)
6. Click **Authorize access** and allow permissions

---

### 2. Update Your Configuration

In `google-sheets-order-module.js`, update the `GOOGLE_SHEETS_URL`:

```javascript
const OrderSubmissionConfig = {
  // Replace with your Web App URL from Step 3
  GOOGLE_SHEETS_URL:
    "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",

  // ... rest of config
};
```

---

### 3. Integration Options

#### Option A: Already integrated into configurator.html

Your `configurator.html` has already been updated with the submission logic. The key changes:

1. **Canvas export function** added
2. **Google Sheets submission function** added
3. **Order data compilation** enhanced
4. **Error handling** improved

**No additional setup needed** - just update the Google Sheets URL in the script section.

#### Option B: Use the standalone module

If you want to use the modular version:

1. **Include the module** in your HTML:

   ```html
   <script src="google-sheets-order-module.js"></script>
   ```

2. **Initialize after DOM ready**:
   ```javascript
   document.addEventListener("DOMContentLoaded", function () {
     // Your canvas state object
     const canvasState = {
       currentColor: "white",
       text: "",
       textFont: "Inter",
       textColor: "#000000",
       textSize: 32,
       uploadedImage: null,
       showBoundingBox: true,
       selectedSize: "M",
     };

     // Create order handler
     const orderHandler = new OrderSubmissionHandler(
       OrderSubmissionConfig,
       canvasState
     );

     // Initialize
     orderHandler.init();
   });
   ```

---

## 📚 API Reference

### OrderSubmissionHandler Class

#### Constructor

```javascript
new OrderSubmissionHandler(config, canvasState);
```

- **config**: Configuration object (OrderSubmissionConfig)
- **canvasState**: Reference to your canvas state object

#### Methods

##### Validation Methods

```javascript
validateName(); // Validate customer name
validatePhone(); // Validate phone number
validateAddress(); // Validate delivery address
```

##### Canvas Methods

```javascript
exportCanvasAsImage(); // Export canvas as PNG base64
```

Returns: `string` (base64 encoded image) or `null`

##### Data Methods

```javascript
compileOrderData(); // Compile complete order object
getDeliveryData(); // Get delivery information
```

##### Submission Methods

```javascript
sendToGoogleSheets(orderData); // Send order to Google Sheets
```

Returns: `Promise<Object>`

##### UI Methods

```javascript
showLoadingState(); // Show loading on submit button
hideLoadingState(); // Hide loading state
showSuccessNotification(); // Show success message
showErrorNotification(msg); // Show error message
```

##### Main Handler

```javascript
handleSubmit(event); // Main form submission handler (async)
```

---

## 🎨 Order Data Structure

The module sends the following data to Google Sheets:

```javascript
{
  // Timestamp
  timestamp: "2025-12-28T10:30:00.000Z",
  orderDate: "28.12.2025, 10:30",

  // Customer
  customerName: "Иван",
  customerSurname: "Петров",
  customerFullName: "Иван Петров",
  customerPhone: "+998 90 123-45-67",

  // Delivery
  deliveryType: "address",
  deliveryAddress: "Ташкент, ул. Амира Темура, 10",
  deliveryCoordinates: "",

  // Product
  tshirtColor: "white",
  tshirtSize: "M",

  // Design
  designText: "LOOM",
  designFont: "Inter",
  designTextColor: "#000000",
  designTextSize: 32,
  hasCustomImage: false,

  // Preview
  designPreview: "data:image/png;base64,iVBORw0KGgoAAAANS...",

  // Price
  price: 150000,
  currency: "UZS",
  priceFormatted: "150 000 UZS",

  // Metadata
  userAgent: "Mozilla/5.0...",
  screenResolution: "1920x1080"
}
```

---

## ⚙️ Configuration Options

### OrderSubmissionConfig

```javascript
const OrderSubmissionConfig = {
  // Google Sheets Web App URL
  GOOGLE_SHEETS_URL: "https://script.google.com/...",

  // Canvas element ID
  CANVAS_ID: "designCanvas",

  // Form field IDs
  FORM_IDS: {
    name: "nameInput",
    surname: "surnameInput",
    phone: "phoneInput",
    address: "addressInput",
    submitButton: "submitBtn",
    submitText: "submitText",
    submitLoader: "submitLoader",
  },

  // Validation rules
  VALIDATION: {
    nameMinLength: 2,
    nameMaxLength: 50,
    phonePattern: /^\+998\s?\d{2}\s?\d{3}[-\s]?\d{2}[-\s]?\d{2}$/,
  },

  // UI Messages (customize as needed)
  MESSAGES: {
    success: "Заказ успешно оформлен!",
    error: "Ошибка при отправке заказа.",
    nameRequired: "Пожалуйста, введите имя",
    phoneRequired: "Пожалуйста, введите телефон",
    phoneInvalid: "Неверный формат телефона",
    addressRequired: "Пожалуйста, укажите адрес",
  },

  // Pricing
  DEFAULT_PRICE: 150000,
  CURRENCY: "UZS",
};
```

---

## 🧪 Testing

### Test the Integration

1. **Open** `order-submission-example.html` in a browser
2. **Configure** a design (color, size, text)
3. **Fill** the order form
4. **Click** "Оформить заказ"
5. **Check** your Google Sheet for the new row

### Debugging

Enable console logging:

```javascript
console.log("Order data:", orderHandler.compileOrderData());
```

Check for errors in browser DevTools Console (F12).

---

## 🔧 Customization

### Change Phone Validation

```javascript
VALIDATION: {
  phonePattern: /^\+7\s?\d{3}\s?\d{3}[-\s]?\d{2}[-\s]?\d{2}$/, // Russia
}
```

### Add Custom Fields

In `compileOrderData()` method:

```javascript
compileOrderData() {
  return {
    ...existingFields,
    customField1: this.state.customValue,
    customField2: document.getElementById('customInput').value,
  };
}
```

### Change Success Message

```javascript
MESSAGES: {
  success: 'Order placed successfully! ✅',
}
```

---

## 📁 File Structure

```
LOOM/
├── configurator.html                  # Main configurator (updated)
├── google-sheets-order-module.js      # Standalone module
├── order-submission-example.html      # Integration example
└── README-ORDER-MODULE.md             # This file
```

---

## 🚨 Important Notes

### CORS and no-cors Mode

- Google Apps Script requires `mode: 'no-cors'`
- This prevents reading the response body
- Assume success if no error is thrown
- For testing, check Google Sheet directly

### Image Size Limitations

- Canvas exports can be large (500KB+)
- Consider reducing image quality or dimensions
- Google Sheets has cell size limits (50,000 characters)
- Alternative: Upload images to Google Drive and store URL

### Security Considerations

- Web App is publicly accessible (required for client-side fetch)
- Add server-side validation in Apps Script
- Consider adding rate limiting
- Don't expose sensitive data in client-side code

---

## 🐛 Troubleshooting

### Orders not appearing in sheet

1. **Check Web App URL** is correct
2. **Verify deployment** is set to "Anyone" access
3. **Check Apps Script execution logs**:
   - Open Apps Script editor
   - Go to **Executions** tab
   - Look for errors

### CORS errors

- Ensure `mode: 'no-cors'` is set in fetch options
- Web App must be deployed, not just saved

### Validation not working

- Check HTML field IDs match config
- Verify error elements exist: `<span id="fieldNameError"></span>`

### Canvas export returns null

- Check canvas element exists
- Ensure images are loaded with `crossOrigin: 'anonymous'`
- Images must be from same origin or CORS-enabled

---

## 📞 Support

For issues or questions:

1. Check browser console for errors
2. Verify Google Sheets Apps Script logs
3. Test with `order-submission-example.html`
4. Review configuration in `OrderSubmissionConfig`

---

## 📄 License

This module is provided as-is for the LOOM project.

---

## 🎉 You're Done!

Your T-shirt configurator is now connected to Google Sheets. Every order will be automatically logged with:

- Customer details
- Product configuration
- Design preview
- Delivery information
- Timestamp

**Happy selling! 🚀**
