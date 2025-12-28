/**
 * ============================================================================
 * GOOGLE APPS SCRIPT - LOOM ORDER RECEIVER
 * ============================================================================
 *
 * This script receives order data from your T-shirt configurator website
 * and saves it to Google Sheets.
 *
 * SETUP INSTRUCTIONS:
 * 1. Create a new Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Delete any existing code
 * 4. Paste this entire file
 * 5. Save the script (Ctrl+S or Cmd+S)
 * 6. Click Deploy > New deployment
 * 7. Select "Web app" type
 * 8. Set "Execute as" to "Me"
 * 9. Set "Who has access" to "Anyone"
 * 10. Click Deploy
 * 11. Copy the Web App URL
 * 12. Paste the URL into your website's configuration
 *
 * @version 1.0.0
 * @date 2025-12-28
 * ============================================================================
 */

/**
 * Handle POST requests (order submissions)
 * This is the main entry point for order data
 */
function doPost(e) {
  try {
    // Parse incoming JSON data
    const data = JSON.parse(e.postData.contents);

    // Log received data (for debugging)
    Logger.log("Received order data: " + JSON.stringify(data));

    // Get the active spreadsheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Get or create the Orders sheet
    let sheet = ss.getSheetByName("Orders");
    if (!sheet) {
      sheet = ss.insertSheet("Orders");
      // Add headers
      setupHeaders(sheet);
    }

    // Prepare row data
    const row = [
      // Column A-P: Core order information
      data.timestamp || new Date().toISOString(),
      data.orderDate || new Date().toLocaleString("ru-RU"),
      data.customerName || "",
      data.customerSurname || "",
      data.customerFullName || "",
      data.customerPhone || "",

      // Delivery information
      data.deliveryType || "",
      data.deliveryAddress || "",
      data.deliveryCoordinates || "",

      // Product configuration
      data.tshirtColor || "",
      data.tshirtSize || "",

      // Design details
      data.designText || "",
      data.designFont || "",
      data.designTextColor || "",
      data.designTextSize || "",
      data.hasCustomImage ? "Да" : "Нет",

      // Pricing
      data.price || 0,
      data.currency || "UZS",
      data.priceFormatted || "",

      // Status (default to "Новый")
      "Новый",

      // Metadata
      data.userAgent || "",
      data.screenResolution || "",
    ];

    // Append the new row
    sheet.appendRow(row);

    // Optional: Save design preview image to Drive
    if (data.designPreview) {
      try {
        saveDesignImage(
          data.designPreview,
          sheet.getLastRow(),
          data.customerFullName
        );
      } catch (imageError) {
        Logger.log("Failed to save image: " + imageError.toString());
        // Don't fail the entire request if image save fails
      }
    }

    // Apply formatting to the new row
    formatNewRow(sheet, sheet.getLastRow());

    // Return success response
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        message: "Order received and saved",
        rowNumber: sheet.getLastRow(),
        orderId: generateOrderId(sheet.getLastRow()),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    // Log error
    Logger.log("Error processing order: " + error.toString());

    // Return error response
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        message: error.toString(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle GET requests (for testing)
 * Visit your Web App URL in a browser to test
 */
function doGet(e) {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>LOOM Order API</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
          }
          .status {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          h1 { color: #0a84ff; }
          .success { color: #27ae60; font-size: 48px; }
          .info { color: #555; margin-top: 20px; }
          code {
            background: #f0f0f0;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
          }
        </style>
      </head>
      <body>
        <div class="status">
          <div class="success">✓</div>
          <h1>LOOM Order API</h1>
          <p>Status: <strong>Running</strong></p>
          <div class="info">
            <p>This API endpoint is ready to receive order submissions.</p>
            <p>Send POST requests with JSON data to this URL.</p>
            <p><strong>Web App URL:</strong><br><code>${ScriptApp.getService().getUrl()}</code></p>
          </div>
        </div>
      </body>
    </html>
  `;

  return HtmlService.createHtmlOutput(html);
}

/**
 * Set up column headers for the Orders sheet
 */
function setupHeaders(sheet) {
  const headers = [
    "Timestamp",
    "Date",
    "Name",
    "Surname",
    "Full Name",
    "Phone",
    "Delivery Type",
    "Address",
    "Coordinates",
    "T-Shirt Color",
    "Size",
    "Design Text",
    "Font",
    "Text Color",
    "Text Size",
    "Has Custom Image",
    "Price",
    "Currency",
    "Price Formatted",
    "Status",
    "User Agent",
    "Screen Resolution",
  ];

  sheet.appendRow(headers);

  // Format header row
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#0a84ff");
  headerRange.setFontColor("#ffffff");
  headerRange.setFontWeight("bold");
  headerRange.setHorizontalAlignment("center");

  // Freeze header row
  sheet.setFrozenRows(1);

  // Auto-resize columns
  for (let i = 1; i <= headers.length; i++) {
    sheet.autoResizeColumn(i);
  }
}

/**
 * Apply formatting to a new order row
 */
function formatNewRow(sheet, rowNumber) {
  // Get the range for the entire row
  const lastColumn = sheet.getLastColumn();
  const rowRange = sheet.getRange(rowNumber, 1, 1, lastColumn);

  // Apply alternating row colors
  if (rowNumber % 2 === 0) {
    rowRange.setBackground("#f9f9f9");
  }

  // Format status column (column 20)
  const statusCell = sheet.getRange(rowNumber, 20);
  statusCell.setBackground("#fff3cd");
  statusCell.setFontWeight("bold");

  // Format price column (column 17)
  const priceCell = sheet.getRange(rowNumber, 17);
  priceCell.setNumberFormat("#,##0");

  // Format timestamp (column 1)
  const timestampCell = sheet.getRange(rowNumber, 1);
  timestampCell.setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

/**
 * Generate a unique order ID
 */
function generateOrderId(rowNumber) {
  const date = new Date();
  const dateStr = Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "yyyyMMdd"
  );
  return `LOOM-${dateStr}-${String(rowNumber).padStart(4, "0")}`;
}

/**
 * Save design preview image to Google Drive
 * Returns the Drive file URL
 */
function saveDesignImage(base64Data, orderRow, customerName) {
  try {
    // Remove data URL prefix if present
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, "");

    // Decode base64 to blob
    const blob = Utilities.newBlob(
      Utilities.base64Decode(base64),
      "image/png",
      `order-${orderRow}-${customerName}.png`
    );

    // Get or create "LOOM Orders" folder in Drive
    const folders = DriveApp.getFoldersByName("LOOM Orders");
    let folder;
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder("LOOM Orders");
    }

    // Save file to Drive
    const file = folder.createFile(blob);

    // Make file publicly viewable (optional)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Get file URL
    const fileUrl = file.getUrl();

    // Update sheet with image URL (add to column after Screen Resolution)
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    sheet.getRange(orderRow, 23).setValue(fileUrl); // Column W

    Logger.log("Design image saved: " + fileUrl);

    return fileUrl;
  } catch (error) {
    Logger.log("Error saving design image: " + error.toString());
    return null;
  }
}

/**
 * Optional: Send email notification when new order is received
 * Uncomment and configure to enable
 */
function sendOrderNotification(orderData) {
  const recipient = "your-email@example.com"; // Change this
  const subject = `Новый заказ от ${orderData.customerFullName}`;

  const body = `
Получен новый заказ:

Клиент: ${orderData.customerFullName}
Телефон: ${orderData.customerPhone}
Адрес: ${orderData.deliveryAddress}

Продукт:
- Цвет: ${orderData.tshirtColor}
- Размер: ${orderData.tshirtSize}
- Текст: ${orderData.designText}

Цена: ${orderData.priceFormatted}

Дата заказа: ${orderData.orderDate}
  `;

  try {
    MailApp.sendEmail(recipient, subject, body);
    Logger.log("Email notification sent");
  } catch (error) {
    Logger.log("Failed to send email: " + error.toString());
  }
}

/**
 * Optional: Create a simple dashboard sheet
 * Run this function once to create a summary dashboard
 */
function createDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Create or get Dashboard sheet
  let dashboard = ss.getSheetByName("Dashboard");
  if (!dashboard) {
    dashboard = ss.insertSheet("Dashboard", 0); // Insert as first sheet
  } else {
    dashboard.clear();
  }

  // Add title
  dashboard.getRange("A1").setValue("LOOM Orders Dashboard");
  dashboard.getRange("A1").setFontSize(24).setFontWeight("bold");

  // Add summary statistics
  dashboard.getRange("A3").setValue("Total Orders:");
  dashboard.getRange("B3").setFormula("=COUNTA(Orders!A:A)-1");

  dashboard.getRange("A4").setValue("Orders Today:");
  dashboard
    .getRange("B4")
    .setFormula('=COUNTIF(Orders!B:B,TEXT(TODAY(),"dd.mm.yyyy*"))');

  dashboard.getRange("A5").setValue("Total Revenue:");
  dashboard.getRange("B5").setFormula("=SUM(Orders!Q:Q)");

  // Format dashboard
  dashboard.setColumnWidth(1, 200);
  dashboard.setColumnWidth(2, 150);
  dashboard.getRange("B3:B5").setFontWeight("bold").setFontSize(14);

  Logger.log("Dashboard created");
}

/**
 * Test function - run this to test the script
 */
function testScript() {
  const testData = {
    postData: {
      contents: JSON.stringify({
        timestamp: new Date().toISOString(),
        orderDate: new Date().toLocaleString("ru-RU"),
        customerName: "Тест",
        customerSurname: "Тестов",
        customerFullName: "Тест Тестов",
        customerPhone: "+998 90 123-45-67",
        deliveryType: "address",
        deliveryAddress: "Тестовый адрес",
        deliveryCoordinates: "",
        tshirtColor: "white",
        tshirtSize: "M",
        designText: "TEST",
        designFont: "Inter",
        designTextColor: "#000000",
        designTextSize: 32,
        hasCustomImage: false,
        price: 150000,
        currency: "UZS",
        priceFormatted: "150 000 UZS",
      }),
    },
  };

  const result = doPost(testData);
  Logger.log("Test result: " + result.getContent());
}
