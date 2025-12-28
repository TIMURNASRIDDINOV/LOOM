# 🏗️ Architecture Diagram - Order Submission System

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│                      (configurator.html)                        │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ User designs T-shirt
                               │ Fills order form
                               │ Clicks "Submit Order"
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND PROCESSING                        │
│                     (JavaScript Module)                         │
├─────────────────────────────────────────────────────────────────┤
│  1. Validate form data (name, phone, address)                  │
│  2. Export canvas as PNG base64                                 │
│  3. Compile order object (JSON)                                 │
│  4. Show loading state                                          │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ fetch() POST request
                               │ mode: 'no-cors'
                               │ Content-Type: application/json
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      GOOGLE APPS SCRIPT                         │
│                        (Web App API)                            │
├─────────────────────────────────────────────────────────────────┤
│  function doPost(e) {                                           │
│    - Parse JSON data                                            │
│    - Validate structure                                         │
│    - Format data                                                │
│    - Save to sheet                                              │
│    - Return response                                            │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ SpreadsheetApp API
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       GOOGLE SHEETS                             │
│                     (Data Storage)                              │
├─────────────────────────────────────────────────────────────────┤
│  Orders Sheet:                                                  │
│  ┌──────┬────────┬──────┬─────────┬──────┬─────────┬────────┐ │
│  │ Time │  Date  │ Name │  Phone  │ Size │  Color  │  Text  │ │
│  ├──────┼────────┼──────┼─────────┼──────┼─────────┼────────┤ │
│  │ ...  │  ...   │ ...  │   ...   │ ...  │   ...   │  ...   │ │
│  └──────┴────────┴──────┴─────────┴──────┴─────────┴────────┘ │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ Optional: Save images
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       GOOGLE DRIVE                              │
│                    (Image Storage)                              │
├─────────────────────────────────────────────────────────────────┤
│  Folder: "LOOM Orders"                                          │
│  - order-1-customer.png                                         │
│  - order-2-customer.png                                         │
│  - order-3-customer.png                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagram

```
┌──────────────┐
│    USER      │
│   Browser    │
└──────┬───────┘
       │
       │ 1. Fill form
       │    Configure design
       │
       ▼
┌──────────────────────────────────────┐
│     Canvas Element (HTML5)           │
│  ┌────────────────────────────────┐  │
│  │                                │  │
│  │     [T-Shirt Design]           │  │
│  │                                │  │
│  │     ████████████               │  │
│  │     ██ LOOM ██                 │  │
│  │     ████████████               │  │
│  │                                │  │
│  └────────────────────────────────┘  │
└───────────────┬──────────────────────┘
                │
                │ 2. Export canvas
                │    canvas.toDataURL()
                │
                ▼
┌────────────────────────────────────────┐
│   Order Data Object (JSON)             │
├────────────────────────────────────────┤
│ {                                      │
│   customerName: "Иван",                │
│   customerPhone: "+998 90 123-45-67",  │
│   tshirtColor: "white",                │
│   tshirtSize: "M",                     │
│   designText: "LOOM",                  │
│   designPreview: "data:image/png;..."  │
│   price: 150000,                       │
│   timestamp: "2025-12-28T10:30:00Z"    │
│ }                                      │
└────────────────┬───────────────────────┘
                 │
                 │ 3. Send via fetch()
                 │    POST request
                 │
                 ▼
┌─────────────────────────────────────────┐
│   Google Apps Script Web App            │
│   URL: https://script.google.com/.../   │
├─────────────────────────────────────────┤
│   function doPost(e) {                  │
│     const data = JSON.parse(e.postData) │
│     sheet.appendRow([...data])          │
│     return { status: 'success' }        │
│   }                                     │
└────────────────┬────────────────────────┘
                 │
                 │ 4. Save to sheet
                 │    SpreadsheetApp
                 │
                 ▼
┌──────────────────────────────────────────┐
│   Google Sheets                          │
│   Spreadsheet: "LOOM Orders"             │
├──────────────────────────────────────────┤
│ Row added:                               │
│ [2025-12-28 | Иван | +998... | M | ...] │
└────────────────┬─────────────────────────┘
                 │
                 │ 5. Response
                 │    { status: 'success' }
                 │
                 ▼
┌──────────────────────────────────────────┐
│   User Interface                         │
├──────────────────────────────────────────┤
│   ✅ Success notification shown          │
│   📧 Order confirmation displayed        │
│   🔄 Form reset                          │
└──────────────────────────────────────────┘
```

---

## Component Architecture

```
┌────────────────────────────────────────────────────────────┐
│                 CONFIGURATOR.HTML                          │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Canvas Component                                 │    │
│  │  - Design rendering                               │    │
│  │  - Image upload                                   │    │
│  │  - Text rendering                                 │    │
│  │  - Export function                                │    │
│  └──────────────────────────────────────────────────┘    │
│                                                            │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Product Configuration Component                  │    │
│  │  - Color selector                                 │    │
│  │  - Size selector                                  │    │
│  │  - Text input                                     │    │
│  │  - Font selector                                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                            │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Order Form Component                             │    │
│  │  - Customer name input                            │    │
│  │  - Phone input                                    │    │
│  │  - Address/Map selector                           │    │
│  │  - Validation                                     │    │
│  └──────────────────────────────────────────────────┘    │
│                                                            │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Order Submission Module                          │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │  exportCanvasAsImage()                   │    │    │
│  │  │  - Hide bounding box                     │    │    │
│  │  │  - Export PNG                            │    │    │
│  │  │  - Return base64                         │    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │  compileOrderData()                      │    │    │
│  │  │  - Gather customer info                  │    │    │
│  │  │  - Gather product config                 │    │    │
│  │  │  - Add metadata                          │    │    │
│  │  │  - Return JSON object                    │    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │  sendToGoogleSheets(data)                │    │    │
│  │  │  - fetch() POST request                  │    │    │
│  │  │  - Error handling                        │    │    │
│  │  │  - Return promise                        │    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │  handleOrderSubmit(event)                │    │    │
│  │  │  - Validate form                         │    │    │
│  │  │  - Export canvas                         │    │    │
│  │  │  - Compile data                          │    │    │
│  │  │  - Submit to API                         │    │    │
│  │  │  - Show feedback                         │    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  └──────────────────────────────────────────────────┘    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## Class Diagram (Standalone Module)

```
┌────────────────────────────────────────────┐
│     OrderSubmissionConfig (Object)         │
├────────────────────────────────────────────┤
│ + GOOGLE_SHEETS_URL: string                │
│ + CANVAS_ID: string                        │
│ + FORM_IDS: object                         │
│ + VALIDATION: object                       │
│ + MESSAGES: object                         │
│ + DEFAULT_PRICE: number                    │
│ + CURRENCY: string                         │
└────────────────────────────────────────────┘
                    │
                    │ used by
                    ▼
┌────────────────────────────────────────────┐
│   OrderSubmissionHandler (Class)           │
├────────────────────────────────────────────┤
│ - config: OrderSubmissionConfig            │
│ - state: object                            │
│ - canvas: HTMLCanvasElement                │
│ - ctx: CanvasRenderingContext2D            │
│ - elements: object                         │
├────────────────────────────────────────────┤
│ + constructor(config, state)               │
│                                            │
│ # Validation Methods                       │
│ + validateName(): boolean                  │
│ + validatePhone(): boolean                 │
│ + validateAddress(): boolean               │
│ + hasCoordinates(): boolean                │
│ + showFieldError(id, msg): void            │
│ + clearFieldError(id): void                │
│                                            │
│ # Canvas Methods                           │
│ + exportCanvasAsImage(): string            │
│                                            │
│ # Data Methods                             │
│ + compileOrderData(): object               │
│ + getDeliveryData(): object                │
│                                            │
│ # API Methods                              │
│ + sendToGoogleSheets(data): Promise        │
│                                            │
│ # UI Methods                               │
│ + showLoadingState(): void                 │
│ + hideLoadingState(): void                 │
│ + showSuccessNotification(): void          │
│ + showErrorNotification(msg): void         │
│                                            │
│ # Main Handler                             │
│ + handleSubmit(event): Promise             │
│ + resetForm(): void                        │
│ + init(): void                             │
└────────────────────────────────────────────┘
```

---

## Sequence Diagram

```
User          Browser         Module          Google Apps      Google
              (UI)           (JS)             Script           Sheets
 │              │              │                │                │
 │ Configure    │              │                │                │
 │ T-shirt     │              │                │                │
 │─────────────>│              │                │                │
 │              │              │                │                │
 │ Fill form    │              │                │                │
 │─────────────>│              │                │                │
 │              │              │                │                │
 │ Click Submit │              │                │                │
 │─────────────>│              │                │                │
 │              │              │                │                │
 │              │ Validate()   │                │                │
 │              │─────────────>│                │                │
 │              │              │                │                │
 │              │ exportCanvas()│               │                │
 │              │─────────────>│                │                │
 │              │<─────────────│                │                │
 │              │ base64 image │                │                │
 │              │              │                │                │
 │              │ compileData()│                │                │
 │              │─────────────>│                │                │
 │              │<─────────────│                │                │
 │              │ order object │                │                │
 │              │              │                │                │
 │              │              │ POST request   │                │
 │              │              │───────────────>│                │
 │              │              │ (JSON data)    │                │
 │              │              │                │                │
 │              │              │                │ appendRow()    │
 │              │              │                │───────────────>│
 │              │              │                │                │
 │              │              │                │<───────────────│
 │              │              │                │ row added      │
 │              │              │                │                │
 │              │              │<───────────────│                │
 │              │              │ {success:true} │                │
 │              │              │                │                │
 │              │ showSuccess()│                │                │
 │              │<─────────────│                │                │
 │              │              │                │                │
 │<─────────────│              │                │                │
 │ ✅ Success   │              │                │                │
 │ notification │              │                │                │
 │              │              │                │                │
```

---

## File Dependencies

```
┌────────────────────────────────────┐
│    configurator.html (Main)        │
│                                    │
│  Includes:                         │
│  - Tailwind CSS                    │
│  - Inter Font                      │
│  - products-catalog.css            │
│  - Yandex Maps API                 │
│  - Inline JavaScript               │
│    ├─ Canvas rendering             │
│    ├─ Product configuration        │
│    ├─ Form validation              │
│    └─ Order submission ⭐          │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│  google-sheets-order-module.js     │
│  (Standalone - Optional)           │
│                                    │
│  Exports:                          │
│  - OrderSubmissionConfig           │
│  - OrderSubmissionHandler class    │
│                                    │
│  Dependencies: None (vanilla JS)   │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│  order-submission-example.html     │
│  (Demo)                            │
│                                    │
│  Includes:                         │
│  - google-sheets-order-module.js   │
│  - Inline styles                   │
│  - Demo canvas logic               │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│  google-apps-script.js             │
│  (Google Apps Script)              │
│                                    │
│  APIs Used:                        │
│  - SpreadsheetApp                  │
│  - DriveApp (optional)             │
│  - MailApp (optional)              │
│  - ContentService                  │
│  - Logger                          │
└────────────────────────────────────┘
```

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      PRODUCTION                             │
└─────────────────────────────────────────────────────────────┘

┌──────────────────────┐         ┌──────────────────────┐
│   Static Website     │         │   Google Cloud       │
│   Hosting            │         │   Platform           │
│   (Your server)      │         │                      │
│                      │         │                      │
│  configurator.html   │◀────────▶│  Apps Script        │
│  + assets            │  HTTPS  │  Web App            │
│  + images            │         │                      │
└──────────────────────┘         └──────────┬───────────┘
                                            │
                                            │ API calls
                                            ▼
                                 ┌──────────────────────┐
                                 │   Google Sheets      │
                                 │   (Database)         │
                                 │                      │
                                 │  + Orders Sheet      │
                                 │  + Dashboard Sheet   │
                                 └──────────────────────┘
                                            │
                                            │ Optional
                                            ▼
                                 ┌──────────────────────┐
                                 │   Google Drive       │
                                 │   (Image Storage)    │
                                 │                      │
                                 │  + Design previews   │
                                 └──────────────────────┘
```

---

## Security Considerations

```
┌────────────────────────────────────────────────────────┐
│  CLIENT SIDE (Browser)                                 │
├────────────────────────────────────────────────────────┤
│  ⚠️  Public code - never store secrets                 │
│  ✅  Client-side validation (UX only)                  │
│  ✅  HTTPS required                                    │
│  ✅  CORS handled by no-cors mode                      │
└────────────────────────────────────────────────────────┘
                          │
                          │ HTTPS
                          ▼
┌────────────────────────────────────────────────────────┐
│  GOOGLE APPS SCRIPT (Server)                           │
├────────────────────────────────────────────────────────┤
│  ✅  Server-side validation (recommended)              │
│  ✅  Rate limiting (recommended)                       │
│  ✅  Data sanitization                                 │
│  ✅  Access control via Google permissions             │
│  ✅  Execution logs for monitoring                     │
└────────────────────────────────────────────────────────┘
                          │
                          │ OAuth
                          ▼
┌────────────────────────────────────────────────────────┐
│  GOOGLE SHEETS (Storage)                               │
├────────────────────────────────────────────────────────┤
│  ✅  Access controlled by Google account               │
│  ✅  Share permissions managed                         │
│  ✅  Version history maintained                        │
│  ✅  Backup automatically                              │
└────────────────────────────────────────────────────────┘
```

---

_Architecture documentation - December 28, 2025_
