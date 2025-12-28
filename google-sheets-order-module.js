/**
 * ============================================================================
 * GOOGLE SHEETS ORDER SUBMISSION MODULE
 * ============================================================================
 * 
 * A modular, drop-in solution for sending T-shirt configurator orders
 * to Google Sheets via Web App URL.
 * 
 * Features:
 * - Canvas export as PNG base64
 * - Form validation
 * - Success/error feedback
 * - Easy configuration
 * - Modern ES6+ syntax
 * 
 * Dependencies: None (vanilla JavaScript)
 * 
 * @version 1.0.0
 * @author LOOM Team
 * @date 2025-12-28
 * ============================================================================
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const OrderSubmissionConfig = {
  // Your Google Sheets Web App URL
  // Replace this with your actual deployment URL
  GOOGLE_SHEETS_URL: 'https://script.google.com/macros/s/AKfycbxJpfl9PNQc8xSpX5OnoORNl4atc7lIORrV06UrN1D6m_xhHTUknrKJr3ypwWE01BbQ5g/exec',
  
  // Canvas ID (update if your canvas has a different ID)
  CANVAS_ID: 'designCanvas',
  
  // Form field IDs (update these to match your HTML)
  FORM_IDS: {
    name: 'nameInput',
    surname: 'surnameInput',
    phone: 'phoneInput',
    address: 'addressInput',
    submitButton: 'submitBtn',
    submitText: 'submitText',
    submitLoader: 'submitLoader',
  },
  
  // Validation rules
  VALIDATION: {
    nameMinLength: 2,
    nameMaxLength: 50,
    phonePattern: /^\+998\s?\d{2}\s?\d{3}[-\s]?\d{2}[-\s]?\d{2}$/,
  },
  
  // UI Messages (Russian by default, customize as needed)
  MESSAGES: {
    success: 'Заказ успешно оформлен!',
    error: 'Ошибка при отправке заказа. Пожалуйста, попробуйте снова.',
    nameRequired: 'Пожалуйста, введите имя',
    phoneRequired: 'Пожалуйста, введите телефон',
    phoneInvalid: 'Неверный формат телефона',
    addressRequired: 'Пожалуйста, укажите адрес доставки',
  },
  
  // Price configuration
  DEFAULT_PRICE: 150000,
  CURRENCY: 'UZS',
};

// ============================================================================
// ORDER SUBMISSION CLASS
// ============================================================================

class OrderSubmissionHandler {
  constructor(config, canvasState) {
    this.config = config;
    this.state = canvasState; // Reference to your canvas state object
    this.canvas = document.getElementById(config.CANVAS_ID);
    this.ctx = this.canvas?.getContext('2d');
    
    // Cache DOM elements
    this.elements = {
      nameInput: document.getElementById(config.FORM_IDS.name),
      surnameInput: document.getElementById(config.FORM_IDS.surname),
      phoneInput: document.getElementById(config.FORM_IDS.phone),
      addressInput: document.getElementById(config.FORM_IDS.address),
      submitBtn: document.getElementById(config.FORM_IDS.submitButton),
      submitText: document.getElementById(config.FORM_IDS.submitText),
      submitLoader: document.getElementById(config.FORM_IDS.submitLoader),
    };
  }

  // ==========================================================================
  // VALIDATION METHODS
  // ==========================================================================

  /**
   * Validate customer name
   * @returns {boolean} Validation result
   */
  validateName() {
    const name = this.elements.nameInput.value.trim();
    const { nameMinLength, nameMaxLength } = this.config.VALIDATION;
    
    if (!name || name.length < nameMinLength) {
      this.showFieldError('nameInput', this.config.MESSAGES.nameRequired);
      return false;
    }
    
    if (name.length > nameMaxLength) {
      this.showFieldError('nameInput', 'Имя слишком длинное');
      return false;
    }
    
    this.clearFieldError('nameInput');
    return true;
  }

  /**
   * Validate phone number
   * @returns {boolean} Validation result
   */
  validatePhone() {
    const phone = this.elements.phoneInput.value.trim();
    const { phonePattern } = this.config.VALIDATION;
    
    if (!phone) {
      this.showFieldError('phoneInput', this.config.MESSAGES.phoneRequired);
      return false;
    }
    
    if (!phonePattern.test(phone)) {
      this.showFieldError('phoneInput', this.config.MESSAGES.phoneInvalid);
      return false;
    }
    
    this.clearFieldError('phoneInput');
    return true;
  }

  /**
   * Validate delivery address
   * @returns {boolean} Validation result
   */
  validateAddress() {
    const address = this.elements.addressInput?.value.trim();
    
    // Skip validation if address field doesn't exist or has coordinates
    if (!this.elements.addressInput || this.hasCoordinates()) {
      return true;
    }
    
    if (!address) {
      this.showFieldError('addressInput', this.config.MESSAGES.addressRequired);
      return false;
    }
    
    this.clearFieldError('addressInput');
    return true;
  }

  /**
   * Check if location is set via coordinates (map selection)
   * @returns {boolean}
   */
  hasCoordinates() {
    // This should be customized based on your map implementation
    return typeof selectedCoords !== 'undefined' && selectedCoords.lat && selectedCoords.lng;
  }

  /**
   * Show validation error for a field
   * @param {string} fieldId - Field identifier
   * @param {string} message - Error message
   */
  showFieldError(fieldId, message) {
    const input = document.getElementById(fieldId);
    const errorElement = document.getElementById(`${fieldId}Error`);
    
    if (input) {
      input.classList.add('error');
      input.classList.remove('success');
    }
    
    if (errorElement) {
      errorElement.textContent = message;
    }
  }

  /**
   * Clear validation error for a field
   * @param {string} fieldId - Field identifier
   */
  clearFieldError(fieldId) {
    const input = document.getElementById(fieldId);
    const errorElement = document.getElementById(`${fieldId}Error`);
    
    if (input) {
      input.classList.remove('error');
      input.classList.add('success');
    }
    
    if (errorElement) {
      errorElement.textContent = '';
    }
  }

  // ==========================================================================
  // CANVAS EXPORT
  // ==========================================================================

  /**
   * Export canvas as PNG base64 image
   * Temporarily hides bounding box for clean export
   * @returns {string|null} Base64 encoded PNG image or null on error
   */
  exportCanvasAsImage() {
    if (!this.canvas || !this.ctx) {
      console.error('Canvas not found');
      return null;
    }

    try {
      // Store original bounding box state
      const originalShowBoundingBox = this.state.showBoundingBox;
      
      // Hide bounding box for clean export
      this.state.showBoundingBox = false;
      
      // Redraw canvas without bounding box
      // Note: Assumes you have a global redrawCanvas() function
      if (typeof redrawCanvas === 'function') {
        redrawCanvas();
      }
      
      // Export as PNG base64
      const imageData = this.canvas.toDataURL('image/png', 0.95); // 95% quality
      
      // Restore original bounding box state
      this.state.showBoundingBox = originalShowBoundingBox;
      
      // Redraw with bounding box restored
      if (typeof redrawCanvas === 'function') {
        redrawCanvas();
      }
      
      return imageData;
      
    } catch (error) {
      console.error('Canvas export failed:', error);
      return null;
    }
  }

  // ==========================================================================
  // DATA COMPILATION
  // ==========================================================================

  /**
   * Compile complete order data for Google Sheets
   * @returns {Object} Order data object
   */
  compileOrderData() {
    const now = new Date();
    
    // Get canvas preview
    const canvasImage = this.exportCanvasAsImage();
    
    // Get customer data
    const customerName = this.elements.nameInput.value.trim();
    const customerSurname = this.elements.surnameInput?.value.trim() || '';
    const customerPhone = this.elements.phoneInput.value.trim();
    
    // Get location data
    const deliveryData = this.getDeliveryData();
    
    // Get product configuration from state
    const productConfig = {
      color: this.state.currentColor || 'white',
      size: this.state.selectedSize || 'M',
      text: this.state.text || '',
      textFont: this.state.textFont || 'Inter',
      textColor: this.state.textColor || '#000000',
      textSize: this.state.textSize || 32,
      hasCustomImage: this.state.uploadedImage !== null,
    };
    
    // Compile complete order object
    return {
      // Timestamp
      timestamp: now.toISOString(),
      orderDate: now.toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      
      // Customer information
      customerName: customerName,
      customerSurname: customerSurname,
      customerFullName: `${customerName} ${customerSurname}`.trim(),
      customerPhone: customerPhone,
      
      // Delivery information
      deliveryType: deliveryData.type,
      deliveryAddress: deliveryData.address,
      deliveryCoordinates: deliveryData.coordinates,
      
      // Product configuration
      tshirtColor: productConfig.color,
      tshirtSize: productConfig.size,
      
      // Design details
      designText: productConfig.text,
      designFont: productConfig.textFont,
      designTextColor: productConfig.textColor,
      designTextSize: productConfig.textSize,
      hasCustomImage: productConfig.hasCustomImage,
      
      // Canvas preview (base64)
      designPreview: canvasImage,
      
      // Pricing
      price: this.config.DEFAULT_PRICE,
      currency: this.config.CURRENCY,
      priceFormatted: `${this.config.DEFAULT_PRICE.toLocaleString('ru-RU')} ${this.config.CURRENCY}`,
      
      // Additional metadata
      userAgent: navigator.userAgent,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
    };
  }

  /**
   * Get delivery data (address or coordinates)
   * @returns {Object} Delivery information
   */
  getDeliveryData() {
    // Check if coordinates are available (map selection)
    if (this.hasCoordinates()) {
      return {
        type: 'coordinates',
        address: '',
        coordinates: `${selectedCoords.lat}, ${selectedCoords.lng}`,
      };
    }
    
    // Otherwise use address input
    const address = this.elements.addressInput?.value.trim() || '';
    return {
      type: 'address',
      address: address,
      coordinates: '',
    };
  }

  // ==========================================================================
  // GOOGLE SHEETS SUBMISSION
  // ==========================================================================

  /**
   * Send order data to Google Sheets Web App
   * @param {Object} orderData - Complete order information
   * @returns {Promise<Object>} Response object
   */
  async sendToGoogleSheets(orderData) {
    try {
      const response = await fetch(this.config.GOOGLE_SHEETS_URL, {
        method: 'POST',
        mode: 'no-cors', // Required for Google Apps Script
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderData)
      });

      // Note: mode: 'no-cors' prevents reading response
      // If fetch doesn't throw, we assume success
      return { success: true, message: 'Order sent successfully' };
      
    } catch (error) {
      console.error('Google Sheets submission error:', error);
      throw new Error(`Failed to submit order: ${error.message}`);
    }
  }

  // ==========================================================================
  // UI FEEDBACK
  // ==========================================================================

  /**
   * Show loading state on submit button
   */
  showLoadingState() {
    const { submitBtn, submitText, submitLoader } = this.elements;
    
    if (submitBtn) submitBtn.disabled = true;
    if (submitText) submitText.style.display = 'none';
    if (submitLoader) submitLoader.style.display = 'flex';
  }

  /**
   * Hide loading state on submit button
   */
  hideLoadingState() {
    const { submitBtn, submitText, submitLoader } = this.elements;
    
    if (submitBtn) submitBtn.disabled = false;
    if (submitText) submitText.style.display = 'block';
    if (submitLoader) submitLoader.style.display = 'none';
  }

  /**
   * Show success notification
   */
  showSuccessNotification() {
    const notification = document.getElementById('successNotification');
    if (notification) {
      notification.style.display = 'flex';
      setTimeout(() => {
        notification.style.display = 'none';
      }, 4000);
    } else {
      // Fallback to alert if notification element doesn't exist
      alert(this.config.MESSAGES.success);
    }
  }

  /**
   * Show error notification
   * @param {string} message - Error message to display
   */
  showErrorNotification(message) {
    const errorMessage = message || this.config.MESSAGES.error;
    
    // You can customize this to use a toast notification instead of alert
    alert(errorMessage);
    
    // Log to console for debugging
    console.error('Order submission error:', errorMessage);
  }

  // ==========================================================================
  // MAIN SUBMISSION HANDLER
  // ==========================================================================

  /**
   * Handle form submission
   * Main entry point for order submission flow
   * @param {Event} event - Form submit event
   */
  async handleSubmit(event) {
    event.preventDefault();

    // Validate all fields
    const isNameValid = this.validateName();
    const isPhoneValid = this.validatePhone();
    const isAddressValid = this.validateAddress();

    if (!isNameValid || !isPhoneValid || !isAddressValid) {
      console.log('Validation failed');
      return;
    }

    // Show loading state
    this.showLoadingState();

    try {
      // Compile order data
      const orderData = this.compileOrderData();
      
      // Log for debugging (optional, remove in production)
      console.log('Submitting order:', orderData);

      // Send to Google Sheets
      await this.sendToGoogleSheets(orderData);

      // Show success feedback
      this.showSuccessNotification();

      // Optional: Close modal or reset form after success
      setTimeout(() => {
        this.resetForm();
      }, 2000);

    } catch (error) {
      console.error('Order submission failed:', error);
      this.showErrorNotification(error.message);
      
    } finally {
      // Always hide loading state
      this.hideLoadingState();
    }
  }

  /**
   * Reset form to initial state
   */
  resetForm() {
    if (this.elements.nameInput) this.elements.nameInput.value = '';
    if (this.elements.surnameInput) this.elements.surnameInput.value = '';
    if (this.elements.phoneInput) this.elements.phoneInput.value = '+998';
    if (this.elements.addressInput) this.elements.addressInput.value = '';
    
    // Clear all errors
    ['nameInput', 'phoneInput', 'addressInput'].forEach(fieldId => {
      this.clearFieldError(fieldId);
    });
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initialize the order submission handler
   * Call this after DOM is loaded
   */
  init() {
    const form = document.querySelector('form'); // Update selector as needed
    
    if (form) {
      form.addEventListener('submit', (e) => this.handleSubmit(e));
      console.log('Order submission handler initialized');
    } else {
      console.error('Form not found. Please check your HTML structure.');
    }
  }
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

/*

// Initialize after DOM is loaded and canvas state is available
document.addEventListener('DOMContentLoaded', function() {
  
  // Your existing canvas state object
  const canvasState = {
    currentColor: 'white',
    text: '',
    textFont: 'Inter',
    textColor: '#000000',
    textSize: 32,
    uploadedImage: null,
    showBoundingBox: true,
    selectedSize: 'M',
    // ... other state properties
  };
  
  // Create order handler instance
  const orderHandler = new OrderSubmissionHandler(
    OrderSubmissionConfig,
    canvasState
  );
  
  // Initialize (attaches event listeners)
  orderHandler.init();
  
  // Now your form will automatically send orders to Google Sheets!
});

*/

// ============================================================================
// EXPORT (for ES6 modules)
// ============================================================================

// If using ES6 modules, uncomment these lines:
// export { OrderSubmissionHandler, OrderSubmissionConfig };

// ============================================================================
// END OF MODULE
// ============================================================================
