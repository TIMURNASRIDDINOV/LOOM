# LOOM - Technical Documentation for AI Review

**Project Type:** E-commerce Web Application (Custom Apparel Design Platform)  
**Deployment:** GitHub Pages Static Site  
**Live URL:** [looom.me](https://looom.me)  
**Repository:** https://github.com/TIMURNASRIDDINOV/TIMURNASRIDDINOV.github.io

---

## Project Purpose

LOOM is a browser-based custom apparel design platform that allows users to:

1. Browse a catalog of 9 customizable apparel products (t-shirts, hoodies, sweatshirts, etc.)
2. Customize products using an interactive canvas-based design configurator
3. Add custom text, upload images, select colors
4. Preview designs on 3D models using Three.js
5. View products in an interactive 3D viewer

**Current State:** Front-end only MVP with no backend, payment processing, or order fulfillment. Designs are not persisted.

---

## Architecture Overview

### Build System

- **Type:** Zero-build static site
- **Dependencies:** All loaded via CDN at runtime (no npm, no bundler, no transpilation)
- **Deployment:** Direct file push to GitHub Pages
- **No compilation step** - HTML/CSS/JS files are served as-is

### Technology Stack

#### Core

- **HTML5** - Semantic markup, accessibility features
- **CSS3** - Custom properties, Grid, Flexbox, backdrop-filter
- **Vanilla JavaScript (ES6+)** - No framework for business logic
- **Tailwind CSS** - Loaded via CDN script tag

#### External Libraries (CDN)

- **React 18.x** - Loaded via UMD but largely unused (legacy code remnants)
- **React DOM 18.x** - UMD bundle
- **Three.js 0.160.0** - ES modules via import maps for 3D rendering
- **Lucide Icons** - Icon library via script tag
- **Google Fonts** - Inter font family (weights 300-900)

#### Browser APIs Used

- HTML5 Canvas API (configurator design tool)
- WebGL (Three.js 3D rendering)
- ES6+ modules (import/export via import maps)
- File API (image upload)
- localStorage (potential future use - not currently implemented)

---

## File Structure & Responsibilities

```
LOOM/
├── index.html                    # Main landing page
├── catalog.html                  # Product browser with 3D viewer
├── configurator.html             # Canvas-based design tool
├── tshirt_3d-white_front_001.html # Standalone 3D demo
│
├── products-catalog.js           # Product data array + rendering logic
├── products-catalog.css          # Product card styles
├── ProductList.css               # Unused legacy React styles
│
├── google-apps-script.js         # Google Sheets integration (unused)
├── google-sheets-order-module.js # Order submission module (unused)
│
├── CNAME                         # Custom domain configuration
│
├── assets/
│   └── models/
│       └── oversized-tshirt.obj  # 3D model file for Three.js
│
├── configuratorprodutcs/
│   └── tshirt_basic2d_white_001.png # 2D preview base image
│
├── images/
│   ├── tshirt.png                # Hero section thumbnail
│   └── tshirtgif.mp4             # Hero section video
│
├── products/
│   ├── tshirt_regular_white_001.jpg
│   ├── sweatshirt_regular_white_001.jpg
│   ├── hoodie_ziphoodie_white_001.jpg
│   ├── hoodie_regular_white_001.jpg
│   ├── polo_regular_white_001.jpg
│   ├── cap_regular_white_001.jpg
│   ├── sweatpants_regular_white_001.jpg
│   ├── tshirt_cropped_white_001.jpg
│   ├── tshirt_muscle_white_001.jpg
│   └── product_comingsoon.jpg
│
└── cloudflare-worker/            # Potential Cloudflare Workers backend
    ├── package.json
    ├── wrangler.jsonc
    ├── README.md
    └── src/
        └── worker.js
```

---

## Detailed Component Analysis

### 1. index.html (Landing Page)

**Purpose:** Marketing page with hero, product grid, features, and footer

**Key Sections:**

- **Fixed Navigation Bar** - Glassmorphism effect with `backdrop-filter: blur(18px) saturate(140%)`
- **Hero Section**
  - Gradient background (purple to orange)
  - Video element (1:1 aspect ratio, max-width 420px)
  - CTA buttons to catalog and configurator
- **Product Grid** - Dynamically populated by `products-catalog.js`
- **Features Section** - 3-column grid showcasing platform capabilities
- **Footer** - Contact info, social links

**Dependencies:**

```html
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/lucide@latest"></script>
<script src="products-catalog.js"></script>
```

**Responsive Breakpoints:**

- Mobile: < 768px (single column)
- Tablet: 768px - 1024px (2 columns)
- Desktop: > 1024px (3-4 columns)

---

### 2. catalog.html (Product Browser)

**Purpose:** Display products with 3D model viewer

**Key Features:**

- **Three.js 3D Viewer**
  - Canvas size: 550x600px
  - OBJLoader for loading `.obj` model files
  - OrbitControls for interactive rotation/zoom
  - PerspectiveCamera with FOV 45°
  - Directional lighting setup

**Three.js Implementation:**

```javascript
import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  45,
  canvas.width / canvas.height,
  0.1,
  1000
);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

// Model loading
const loader = new OBJLoader();
loader.load("assets/models/oversized-tshirt.obj", (object) => {
  scene.add(object);
});
```

**React Usage:**

- React 18 UMD bundles loaded but minimal React code
- Mostly legacy/unused imports

---

### 3. configurator.html (Design Tool)

**Purpose:** Canvas-based design editor for customizing apparel

**Layout:**

- **Desktop:** 60% preview (left) / 40% controls (right)
- **Mobile:** Stacked layout (preview on top, controls below)

**Canvas Configuration:**

```javascript
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 700;

const PRINT_AREA = {
  x: 175, // X offset
  y: 220, // Y offset
  width: 250, // Printable width
  height: 250, // Printable height
};
```

**Features Implemented:**

1. **T-Shirt Color Selection**

   - 5 colors: White (#FFFFFF), Black (#000000), Navy (#1e3a8a), Gray (#6b7280), Red (#dc2626)
   - Changes base image via DOM manipulation

2. **Text Customization**

   - Input field for custom text
   - Font selection: Inter, Helvetica, Arial, Georgia, Times New Roman
   - Rendered on canvas with `ctx.fillText()`

3. **Image Upload**

   - Accepts PNG, JPEG, SVG
   - FileReader API for local file loading
   - Draws image to canvas via `ctx.drawImage()`

4. **Transform Controls**

   - Size slider: 50% - 150% scale
   - Rotation slider: -180° to 180°
   - Real-time canvas redraw on input

5. **Canvas Rendering**

```javascript
function drawCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw t-shirt base image
  ctx.drawImage(tshirtImage, 0, 0, canvas.width, canvas.height);

  // Draw print area boundary
  ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
  ctx.strokeRect(
    PRINT_AREA.x,
    PRINT_AREA.y,
    PRINT_AREA.width,
    PRINT_AREA.height
  );

  // Draw user design (text/image) within print area
  if (uploadedImage) {
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(
      uploadedImage,
      -imageWidth / 2,
      -imageHeight / 2,
      imageWidth,
      imageHeight
    );
    ctx.restore();
  }

  if (text) {
    ctx.font = `${fontSize}px ${selectedFont}`;
    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.fillText(text, centerX, centerY);
  }
}
```

**Current Limitations:**

- No design export (PNG/PDF download)
- No state persistence (designs lost on page reload)
- No layer management (text and image conflict)
- No undo/redo functionality
- No design preview on 3D model

---

### 4. products-catalog.js (Data & Rendering)

**Purpose:** Product data source and dynamic DOM generation

**Product Data Structure:**

```javascript
const products = [
  {
    id: 1,
    name: "Классическая футболка", // Russian name
    nameEn: "Regular T-shirt", // English name
    type: "Обычная футболка", // Category
    image: "products/tshirt_regular_white_001.jpg",
    price: 150000, // Uzbek сум
    customizable: true, // Can be customized
  },
  // ... 8 more products
];
```

**Price Range:**

- Min: 100,000 сум (caps)
- Max: 280,000 сум (zip hoodies)

**Rendering Logic:**

```javascript
function renderProducts(containerId) {
  const container = document.getElementById(containerId);

  products.forEach((product) => {
    const card = document.createElement("div");
    card.className = "product-card";

    const img = document.createElement("img");
    img.src = product.image;
    img.onerror = () => {
      img.src = "products/product_comingsoon.jpg";
    };

    const price = document.createElement("p");
    price.textContent = `${product.price.toLocaleString("ru-RU")} сум`;

    const button = document.createElement("button");
    button.textContent = product.customizable ? "Настроить" : "Скоро";
    button.onclick = () => {
      if (product.customizable) {
        window.location.href = "configurator.html";
      }
    };

    card.append(img, name, price, button);
    container.appendChild(card);
  });
}
```

**Error Handling:**

- Image load failure → fallback to `product_comingsoon.jpg`
- No try/catch blocks (relies on browser error handling)

---

## CSS Architecture

### Design System

**CSS Custom Properties:**

```css
:root {
  --bg: #ffffff; /* Page background */
  --text: #0a0a0a; /* Primary text */
  --muted: #6b7280; /* Secondary text */
  --hairline: rgba(0, 0, 0, 0.08); /* Borders */
  --panel: #ffffff; /* Card backgrounds */
  --brand: #0a84ff; /* Primary CTA */
  --brand-ink: #0b66d6; /* Hover state */
}
```

**Typography:**

- Primary font: Inter (Google Fonts)
- Fallbacks: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`
- Weights: 300, 400, 500, 600, 700, 900
- Font loading: `<link rel="preconnect">` for performance

**Layout Patterns:**

1. **Glassmorphism Nav:**

   ```css
   backdrop-filter: blur(18px) saturate(140%);
   background: rgba(255, 255, 255, 0.8);
   ```

2. **Product Cards:**

   ```css
   border-radius: 16px;
   transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
   box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
   ```

3. **Responsive Grid:**
   ```css
   display: grid;
   grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
   gap: 2rem;
   ```

**Animations:**

- Cubic-bezier easing: `(0.4, 0, 0.2, 1)` (Material Design standard)
- Transition duration: 200-300ms for interactions

---

## Current Implementation Status

### ✅ Fully Implemented

- [x] Responsive landing page with video hero
- [x] Product catalog with 9 items
- [x] Canvas-based design configurator
- [x] 5-color t-shirt palette
- [x] Text input with 5 font choices
- [x] Image upload (PNG/JPEG/SVG)
- [x] Size/rotation sliders
- [x] Three.js 3D model viewer setup
- [x] Mobile-responsive layouts (3 breakpoints)
- [x] Glassmorphism UI effects
- [x] GitHub Pages deployment
- [x] Custom domain (looom.me)

### 🚧 Partially Implemented

- [ ] **3D Model Loading** - Three.js code exists but model loading may fail
- [ ] **Mobile Navigation** - Links hidden on mobile (no hamburger menu)
- [ ] **Canvas State** - Designs not saved between page reloads

### ❌ Not Implemented (No Code Exists)

- [ ] Shopping cart
- [ ] User authentication
- [ ] Backend API
- [ ] Payment processing
- [ ] Order management
- [ ] Database
- [ ] Design export (PNG/PDF)
- [ ] Design-to-3D model mapping
- [ ] Email notifications
- [ ] Admin panel

---

## Technical Limitations & Issues

### Critical Issues

1. **No Backend** - Platform is 100% client-side

   - Cannot save user designs
   - Cannot process orders
   - Cannot handle payments
   - No user accounts

2. **No State Persistence**

   - Canvas state lost on refresh
   - No localStorage implementation
   - No session management

3. **Mobile Navigation Broken**
   - Nav links use `hidden md:flex` (Tailwind)
   - No hamburger menu component
   - Users cannot navigate on mobile

### Performance Issues

4. **Unoptimized Images**

   - Product images are full-size JPGs
   - No lazy loading
   - No responsive image srcsets
   - No WebP/AVIF formats

5. **No Service Worker**

   - No offline capabilities
   - No asset caching
   - No PWA features

6. **Blocking CDN Requests**
   - Multiple render-blocking CDN scripts
   - No async/defer on non-critical scripts

### Browser Compatibility

7. **Import Maps Support**

   - Required for Three.js ES modules
   - Not supported in Safari < 16.4
   - Firefox < 108 unsupported

8. **Backdrop Filter**
   - Safari on older Macs has performance issues
   - May cause janky scrolling

### Code Quality Issues

9. **Unused Dependencies**

   - React loaded but barely used (catalog.html)
   - ProductList.css file exists but unused
   - Google Sheets modules present but not integrated

10. **Hardcoded Data**

    - Products defined in JavaScript (not API-fetched)
    - Prices hardcoded (no dynamic pricing)
    - No CMS or admin interface

11. **No Input Validation**

    - File upload has no size limits
    - Text input has no length constraints
    - Image dimensions not validated

12. **No Error Handling**
    - Try/catch blocks missing
    - Failed API calls would crash (if backend existed)
    - Image upload errors not user-facing

### Accessibility Issues

13. **Keyboard Navigation**

    - Color picker not fully keyboard-accessible
    - Focus states inconsistent
    - Tab order not optimized

14. **ARIA Labels**

    - Some interactive elements lack labels
    - Canvas has no accessible alternative

15. **Color Contrast**
    - Gray text (#6b7280) on white may fail WCAG AA
    - Button states need higher contrast

---

## Dependencies Analysis

### Runtime (CDN-loaded)

| Library       | Version | Size (est.) | Usage               | Removable? |
| ------------- | ------- | ----------- | ------------------- | ---------- |
| Tailwind CSS  | Latest  | ~100KB      | Utility styling     | No         |
| React         | 18.x    | ~6KB (UMD)  | Minimal/Legacy      | Yes        |
| React DOM     | 18.x    | ~130KB      | Minimal/Legacy      | Yes        |
| Three.js      | 0.160.0 | ~600KB      | 3D rendering        | No         |
| OBJLoader     | 0.160.0 | ~15KB       | 3D model loading    | No         |
| OrbitControls | 0.160.0 | ~30KB       | 3D camera controls  | No         |
| Lucide Icons  | Latest  | ~50KB       | UI icons            | No         |
| Google Fonts  | -       | ~20KB       | Inter font (subset) | No         |
| **Total**     | -       | **~951KB**  | -                   | -          |

**Potential Optimizations:**

- Remove React/ReactDOM (save ~136KB) - currently unused
- Self-host Tailwind with only used utilities (save ~60KB)
- Use icon subset instead of full Lucide library (save ~30KB)

### Browser Requirements

**Minimum:**

- Chrome 90+ / Edge 90+
- Firefox 88+
- Safari 14+

**Critical Features Required:**

- ES6 Modules (import/export)
- Import Maps
- Canvas API
- WebGL 1.0
- backdrop-filter CSS property
- CSS Grid/Flexbox
- CSS Custom Properties
- FileReader API

**Unsupported Browsers:**

- IE 11 (no ES6 modules)
- Safari < 14 (no backdrop-filter)
- Firefox < 88 (no Import Maps without polyfill)

---

## Configuration Details

### GitHub Pages Setup

**CNAME File:**

```
looom.me
```

**DNS Records:**

```
Type  | Name | Value
------|------|------
A     | @    | 185.199.108.153
A     | @    | 185.199.109.153
A     | @    | 185.199.110.153
A     | @    | 185.199.111.153
CNAME | www  | timurnasriddinov.github.io
```

### Three.js Import Map

```html
<script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
  }
</script>
```

### Canvas Print Area

```javascript
// Located in configurator.html
const PRINT_AREA = {
  x: 175, // Left offset from canvas edge
  y: 220, // Top offset from canvas edge
  width: 250, // Printable area width
  height: 250, // Printable area height
};

// Center point for design placement
const centerX = PRINT_AREA.x + PRINT_AREA.width / 2; // 300
const centerY = PRINT_AREA.y + PRINT_AREA.height / 2; // 345
```

---

## Potential Backend Architecture (Not Implemented)

### Cloudflare Worker (Folder Exists)

Located in `/cloudflare-worker/` but not deployed or integrated.

**Potential Use Cases:**

- Handle image uploads to cloud storage (R2/S3)
- Process design exports (PNG generation)
- Forward orders to database/email
- Rate limiting
- CORS proxy for external APIs

**Current Status:**

- Boilerplate files exist
- No actual worker code implemented
- Not connected to front-end

### Google Sheets Integration (Files Exist)

Files present but unused:

- `google-apps-script.js`
- `google-sheets-order-module.js`

**Intended Purpose:**

- Submit orders to Google Sheets
- Acts as simple database alternative
- No server infrastructure needed

**Why Not Used:**

- CORS issues with client-side Google Sheets API
- Authentication complexity
- Not scalable for production

---

## Code Patterns & Conventions

### JavaScript Style

- **Module Type:** ES6+ with import/export
- **Variable Naming:** camelCase
- **Constants:** UPPER_SNAKE_CASE
- **No TypeScript** - Plain JavaScript only
- **No JSX** - Despite React being loaded

### DOM Manipulation

```javascript
// Vanilla JS approach
const container = document.getElementById("products-grid");
const card = document.createElement("div");
card.className = "product-card";
card.innerHTML = `<h3>${product.name}</h3>`;
container.appendChild(card);
```

### Event Handling

```javascript
// Direct event listeners
button.addEventListener('click', () => {
  // Handle click
});

// Inline onclick (some legacy code)
<button onclick="handleClick()">
```

### Canvas Rendering Pattern

```javascript
// Redraw entire canvas on state change
function updateDesign() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBaseImage();
  drawDesignElements();
  drawPrintAreaBoundary();
}

// Triggered by input events
sizeSlider.addEventListener("input", updateDesign);
rotationSlider.addEventListener("input", updateDesign);
```

---

## API Endpoints (None Exist)

**Expected Future Endpoints:**

```
POST   /api/designs          - Save design
GET    /api/designs/:id      - Retrieve design
POST   /api/orders           - Submit order
GET    /api/products         - Fetch product catalog
POST   /api/uploads          - Handle image uploads
POST   /api/export/:id       - Generate design PNG
```

**Current Reality:** All data is hardcoded in JavaScript files

---

## Environment Variables (None)

No `.env` file exists. All configuration is hardcoded.

**Potential Future Env Vars:**

```
API_BASE_URL=https://api.looom.me
STRIPE_PUBLIC_KEY=pk_live_...
CLOUDFLARE_R2_BUCKET=looom-designs
GOOGLE_ANALYTICS_ID=G-...
```

---

## Testing Status

**Current State:** Zero tests

**No Test Framework Configured:**

- No Jest
- No Vitest
- No Cypress/Playwright
- No unit tests
- No integration tests
- No E2E tests

**Manual Testing Only:**

- Browser-based manual QA
- No automated CI/CD testing

---

## Performance Metrics (Estimated)

**Lighthouse Scores (Expected):**

- Performance: ~75-80 (CDN dependencies, unoptimized images)
- Accessibility: ~85-90 (some ARIA issues)
- Best Practices: ~80-85 (missing service worker, no HTTPS headers)
- SEO: ~90-95 (basic meta tags present)

**Load Time:**

- First Contentful Paint: ~1.5s
- Time to Interactive: ~3s
- Total Blocking Time: ~500ms (CDN scripts)

---

## Security Considerations

### Current Security Posture

**Strengths:**

- No backend = no API attack surface
- No user data stored = no data breach risk
- Static site = no server vulnerabilities

**Weaknesses:**

- No input sanitization (XSS vulnerable if backend added)
- No CSRF protection (not needed currently)
- No rate limiting (if backend added)
- File upload not validated (size, type, malicious content)

**Required for Production:**

- Content Security Policy (CSP) headers
- Input validation/sanitization
- File upload scanning (antivirus)
- Rate limiting on API endpoints
- HTTPS enforcement
- Secure cookie settings (if auth added)

---

## Internationalization

**Current Language Support:**

- Primary: Russian (product names, UI labels)
- Prices: Uzbek сум (UZS)
- Some English fallbacks (nameEn field)

**Not Implemented:**

- No i18n framework
- No locale switching
- Hardcoded strings in HTML/JS
- No translation files

---

## Browser DevTools Console Output

**Expected Warnings:**

- Three.js: "OBJLoader: No material library found" (non-critical)
- Possible CORS warnings if loading local files via file://
- React warnings if running in development mode

**No Errors Expected** (in normal operation)

---

## Recommendations for AI Review

When reviewing this project, consider:

1. **Architecture Assessment**

   - Is zero-build approach sustainable?
   - Should React be removed or fully adopted?
   - CDN vs. bundled dependencies trade-offs

2. **Missing Critical Features**

   - Backend API design suggestions
   - State management approach (localStorage vs. database)
   - Payment integration strategy

3. **Code Quality**

   - Refactoring opportunities
   - Error handling gaps
   - Input validation needs

4. **Performance Optimization**

   - Image optimization strategy
   - Code splitting opportunities
   - Caching strategies

5. **Accessibility Improvements**

   - WCAG 2.1 AA compliance path
   - Keyboard navigation enhancements
   - Screen reader compatibility

6. **Security Hardening**

   - CSP headers
   - Input sanitization
   - File upload security

7. **Scalability**
   - Database design for user designs
   - CDN for assets
   - Backend architecture (serverless vs. traditional)

---

**Last Updated:** January 11, 2026  
**Document Version:** 1.0  
**Intended Audience:** AI code review assistants, technical stakeholders
