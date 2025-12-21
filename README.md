# LOOM - Custom T-Shirt Design Platform

> Modern e-commerce platform for custom apparel design with real-time 3D preview, interactive configurator, and seamless user experience.

🌐 **Live Site:** [looom.me](https://looom.me)

---

## 🎯 Project Overview

LOOM is a browser-based custom apparel design platform that enables users to personalize t-shirts, sweatshirts, hoodies, and other clothing items with custom text, images, and colors. The platform features:

- **Interactive Product Catalog** - Browse 9 customizable apparel items with dynamic product cards
- **Real-Time 3D Previews** - Three.js-powered 3D model viewer with interactive rotation
- **Design Configurator** - Canvas-based design tool with text, image upload, and color customization
- **Zero-Build Architecture** - Pure HTML/CSS/JavaScript with CDN dependencies for instant deployment
- **Mobile-First Design** - Fully responsive layouts with Apple-inspired aesthetics

The platform is built with a focus on performance, accessibility, and modern web standards, delivering a seamless design experience across all devices.

---

## ✨ Key Features

### Product Management

- **9 Product Types** - T-shirts, sweatshirts, hoodies (regular & zip), polo shirts, caps, sweatpants
- **Dynamic Pricing** - Real-time price display in Uzbek сум (ranging from 100,000 to 280,000 сум)
- **Smart Image Fallbacks** - Graceful degradation with placeholder images on load failure
- **Product State Management** - Customizable vs. unavailable product differentiation

### Design Configurator

- **Canvas-Based Editor** - 600x700px HTML5 Canvas with printable area boundaries (250x250px)
- **Text Customization** - Multi-font support (Inter, Helvetica, Arial, Georgia, Times New Roman)
- **Image Upload** - PNG/JPEG/SVG support with drag-and-drop functionality
- **Color Palette** - 5 pre-defined colors (White, Black, Navy, Gray, Red)
- **Transform Controls** - Size scaling (50%-150%) and rotation (-180° to 180°)
- **Real-Time Preview** - Instant visual feedback with canvas redraw

### 3D Visualization

- **Three.js Integration** - WebGL-based 3D rendering with OBJLoader
- **Interactive Controls** - OrbitControls for model rotation and zoom
- **Responsive Canvas** - Adaptive sizing for various screen resolutions

### User Experience

- **Glassmorphism UI** - Backdrop-blur effects with 18px blur and 140% saturation
- **Smooth Animations** - Cubic-bezier transitions (0.4, 0, 0.2, 1)
- **Mobile Optimization** - Breakpoints at 480px, 768px, and 1024px
- **Accessibility** - ARIA labels, semantic HTML, keyboard navigation

---

## 🛠 Technical Stack

### Core Technologies

| Category      | Technology         | Version      | Purpose                                             |
| ------------- | ------------------ | ------------ | --------------------------------------------------- |
| **Markup**    | HTML5              | -            | Semantic structure, meta tags, accessibility        |
| **Styling**   | CSS3               | -            | Grid/Flexbox layouts, custom properties, animations |
| **Scripting** | Vanilla JavaScript | ES6+         | DOM manipulation, event handling, canvas rendering  |
| **Framework** | Tailwind CSS       | Latest (CDN) | Utility-first styling, responsive utilities         |

### External Libraries (CDN)

| Library          | Version | Usage                                 | Load Strategy           |
| ---------------- | ------- | ------------------------------------- | ----------------------- |
| **React**        | 18.x    | Legacy component support              | UMD bundle              |
| **React DOM**    | 18.x    | Legacy rendering                      | UMD bundle              |
| **Three.js**     | 0.160.0 | 3D graphics, OBJLoader, OrbitControls | ES Module via importmap |
| **Lucide Icons** | Latest  | Modern icon set                       | Script tag              |

### Typography & Assets

- **Primary Font:** Inter (weights 300-900) via Google Fonts
- **System Fallbacks:** `-apple-system`, `BlinkMacSystemFont`, `sans-serif`
- **Font Loading:** Preconnect with preload hints to prevent layout shift

### Design System

```css
:root {
  --bg: #ffffff; /* Background */
  --text: #0a0a0a; /* Primary text */
  --muted: #6b7280; /* Secondary text */
  --hairline: rgba(0, 0, 0, 0.08); /* Borders */
  --panel: #ffffff; /* Card backgrounds */
  --brand: #0a84ff; /* Apple blue */
  --brand-ink: #0b66d6; /* Hover state */
}
```

---

## 📁 Project Structure

```
LOOM/
├── index.html                   # Landing page with hero, catalog, features
├── catalog.html                 # Product browse with 3D viewer
├── configurator.html            # Interactive design tool
├── tshirt_3d-white_front_001.html  # Standalone 3D model demo
│
├── products-catalog.js          # Product data & rendering engine
├── products-catalog.css         # Product card styles
├── ProductList.css              # Legacy React styles (unused)
│
├── CNAME                        # Custom domain: looom.me
│
├── assets/
│   └── models/
│       └── oversized-tshirt.obj # 3D OBJ model for Three.js
│
├── configuratorprodutcs/
│   └── tshirt_basic2d_white_001.png  # Configurator base image
│
├── images/
│   ├── tshirt.png              # Hero thumbnail
│   └── tshirtgif.mp4           # Hero video (1:1 aspect ratio)
│
└── products/
    ├── tshirt_regular_white_001.jpg
    ├── sweatshirt_regular_white_001.jpg
    ├── hoodie_ziphoodie_white_001.jpg
    ├── hoodie_regular_white_001.jpg
    ├── polo_regular_white_001.jpg
    ├── cap_regular_white_001.jpg
    ├── sweatpants_regular_white_001.jpg
    ├── tshirt_cropped_white_001.jpg
    ├── tshirt_muscle_white_001.jpg
    └── product_comingsoon.jpg
```

### File Responsibilities

#### **index.html** (Main Landing Page)

- Fixed glassmorphism navigation bar with 3 links
- Gradient hero section with video (max-width 420px, aspect-ratio 1:1)
- Product grid powered by `products-catalog.js`
- 3-column features section
- Footer with contact info and social links
- **Lines:** 1,284 | **Dependencies:** Tailwind, Lucide, products-catalog.js

#### **catalog.html** (Product Browser)

- Black gradient hero section with 3D model viewer
- Three.js canvas (550x600px) with OrbitControls
- Product grid with hover animations
- Mobile-responsive layout (2 cols → 1 col)
- **Lines:** 1,068 | **Dependencies:** React 18, Three.js 0.160.0, Tailwind

#### **configurator.html** (Design Tool)

- 2-column layout (60% preview / 40% controls on desktop)
- Canvas editor (600x700px) with printable area overlay
- 5-color t-shirt palette
- Text input with font selection
- Image upload with drag-and-drop
- Size/rotation sliders with live preview
- **Lines:** 1,280 | **Dependencies:** Tailwind, HTML5 Canvas API

#### **products-catalog.js** (Catalog Engine)

- Product data array (9 items with pricing, images, types)
- Dynamic DOM generation (`createElement`, `appendChild`)
- Price formatting with `toLocaleString('ru-RU')`
- Image error handling with placeholder fallbacks
- Grid and carousel rendering modes
- **Lines:** 254 | **Pure Vanilla JavaScript**

---

## 🚀 Current Implementation Status

### ✅ Completed Features

- [x] Responsive landing page with hero section
- [x] Product catalog with 9 items (t-shirts, sweatshirts, hoodies, etc.)
- [x] Canvas-based design configurator
- [x] Color selection (5 colors)
- [x] Text customization with 5 font options
- [x] Image upload (PNG/JPEG/SVG)
- [x] Size and rotation controls
- [x] Three.js 3D model viewer (OBJ format)
- [x] Mobile-responsive layouts (480px, 768px, 1024px breakpoints)
- [x] Glassmorphism navigation
- [x] GitHub Pages deployment with custom domain

### 🚧 In Progress / Partially Implemented

- [ ] **3D Model Integration in Catalog** - Three.js setup exists but model loading needs refinement
- [ ] **Configurator Canvas State Persistence** - Design changes not saved between sessions
- [ ] **Mobile Navigation** - Hidden on mobile; needs hamburger menu implementation

### ❌ Not Yet Implemented

- [ ] Shopping cart functionality
- [ ] User authentication system
- [ ] Order management backend
- [ ] Payment gateway integration
- [ ] Product filtering/sorting
- [ ] Dark mode toggle
- [ ] Loading states for images
- [ ] Design export (PNG/PDF)

---

## 📦 Dependencies

### Runtime Dependencies (CDN)

All dependencies are loaded via CDN at runtime - no `package.json` or build tools required.

```html
<!-- Styling Framework -->
<script src="https://cdn.tailwindcss.com"></script>

<!-- React (Legacy Support) -->
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>

<!-- 3D Graphics -->
<script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
  }
</script>

<!-- Icons -->
<script src="https://unpkg.com/lucide@latest"></script>

<!-- Fonts -->
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;900&display=swap"
  rel="stylesheet"
/>
```

### Browser Requirements

| Feature     | Minimum Version |
| ----------- | --------------- |
| **Chrome**  | 90+             |
| **Firefox** | 88+             |
| **Safari**  | 14+             |
| **Edge**    | 90+             |

**Required Browser Features:**

- ES6+ (arrow functions, template literals, destructuring)
- CSS Grid & Flexbox
- CSS Custom Properties (variables)
- `backdrop-filter` (for glassmorphism effects)
- HTML5 Canvas API
- WebGL (for Three.js)
- Import Maps (for ES module imports)

### Development Tools

**Not Required** - Project runs directly in browser without build step.

**Optional (for local development):**

- Python 3 (for `http.server`)
- PHP (for `php -S`)
- Node.js (for `npx serve`)

---

## 🐛 Known Issues and Limitations

### Critical Issues

1. **Mobile Navigation Hidden** - Nav links disappear on screens <768px; hamburger menu not implemented
2. **No Backend Integration** - Designs cannot be saved or ordered (front-end only)
3. **Canvas State Loss** - Configurator state resets on page reload

### Performance Issues

4. **Large Image Loads** - Product images not optimized (no lazy loading)
5. **No Service Worker** - Offline functionality absent
6. **Font Flash** - FOIT (Flash of Invisible Text) on slow connections despite preconnect

### Browser Compatibility

7. **Safari `backdrop-filter` Lag** - Glassmorphism causes performance drop on older Macs
8. **Import Maps Unsupported** - Older browsers cannot load Three.js (needs polyfill)

### UX/UI Issues

9. **No Loading States** - Users see blank space while images load
10. **Missing Error Feedback** - Upload failures have no user-facing messages
11. **Configurator Reset Lacks Confirmation** - "Сбросить всё" button has no undo
12. **Mobile Canvas Pinch-Zoom** - Touch gestures conflict with design manipulation

### Code Quality

13. **Legacy React Code** - Unused React imports in `catalog.html` increase bundle size
14. **Hardcoded Product Data** - Products defined in JS file instead of API/database
15. **No Input Validation** - Text/image inputs lack size/format constraints

### Accessibility

16. **Keyboard Navigation Incomplete** - Color picker not fully accessible via keyboard
17. **Missing Alt Text** - Some product images lack descriptive alt attributes
18. **Color Contrast** - Some gray text fails WCAG AA standards

---

## 🗺 Future Roadmap

### Phase 1: Core Functionality (Q1 2026)

- [ ] Implement hamburger menu for mobile navigation
- [ ] Add shopping cart with localStorage persistence
- [ ] Create design export feature (PNG download)
- [ ] Implement loading skeletons for product cards
- [ ] Add form validation for configurator inputs

### Phase 2: Backend Integration (Q2 2026)

- [ ] Build Node.js/Express API server
- [ ] Implement user authentication (JWT)
- [ ] Create order management system
- [ ] Integrate payment gateway (Stripe/PayPal)
- [ ] Set up PostgreSQL/MongoDB database

### Phase 3: Enhanced Features (Q3 2026)

- [ ] Multi-view 3D preview (front/back/side)
- [ ] Advanced text effects (shadows, outlines, gradients)
- [ ] Template library with pre-made designs
- [ ] Product filtering by type, price, popularity
- [ ] Wishlist and favorites system
- [ ] Order history and tracking

### Phase 4: Optimization & Polish (Q4 2026)

- [ ] Dark mode implementation
- [ ] Progressive Web App (PWA) conversion
- [ ] Image lazy loading and optimization
- [ ] Internationalization (i18n) - English, Russian, Uzbek
- [ ] Analytics integration (Google Analytics/Plausible)
- [ ] SEO improvements (meta tags, structured data)
- [ ] Accessibility audit and WCAG 2.1 AAA compliance

### Phase 5: Advanced Features (2027+)

- [ ] AI-powered design suggestions
- [ ] Augmented Reality (AR) try-on
- [ ] Bulk ordering for businesses
- [ ] Social sharing and design collaboration
- [ ] Mobile native apps (React Native)

---

## 🚀 Getting Started

### Prerequisites

- Modern web browser (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- Local web server (optional but recommended)

### Installation

```bash
# Clone the repository
git clone https://github.com/TIMURNASRIDDINOV/TIMURNASRIDDINOV.github.io.git

# Navigate to directory
cd TIMURNASRIDDINOV.github.io
```

### Local Development

#### Option 1: Python HTTP Server (Recommended)

```bash
python3 -m http.server 8000
# Open http://localhost:8000
```

#### Option 2: PHP Built-in Server

```bash
php -S localhost:8000
# Open http://localhost:8000
```

#### Option 3: Node.js Serve

```bash
npx serve
# Open http://localhost:3000
```

#### Option 4: VS Code Live Server

1. Install "Live Server" extension
2. Right-click `index.html`
3. Select "Open with Live Server"

### Testing Checklist

- [ ] Navigate all 3 pages (Home, Catalog, Configurator)
- [ ] Test product catalog rendering
- [ ] Upload image in configurator
- [ ] Add custom text with different fonts
- [ ] Change t-shirt colors
- [ ] Test size/rotation sliders
- [ ] Verify mobile responsiveness (320px, 768px, 1024px)
- [ ] Check 3D model loading in catalog

---

## 📐 Design System Reference

### Color Palette

| Name               | Hex                | Usage                   |
| ------------------ | ------------------ | ----------------------- |
| **Primary Text**   | `#0a0a0a`          | Headings, body text     |
| **Secondary Text** | `#6b7280`          | Descriptions, captions  |
| **Brand Blue**     | `#0a84ff`          | CTAs, links, selections |
| **Brand Hover**    | `#0b66d6`          | Button hover states     |
| **Background**     | `#ffffff`          | Page background         |
| **Panel**          | `#ffffff`          | Card backgrounds        |
| **Hairline**       | `rgba(0,0,0,0.08)` | Borders, dividers       |

### Typography Scale

```css
/* Headings */
.hero-title {
  font-size: clamp(2.5rem, 5vw, 3.5rem);
  font-weight: 900;
}
.section-title {
  font-size: clamp(2rem, 4.5vw, 2.75rem);
  font-weight: 800;
}
.page-title {
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 900;
}

/* Body */
.hero-subtitle {
  font-size: clamp(1rem, 1.8vw, 1.15rem);
  font-weight: 400;
}
.body-text {
  font-size: 1rem;
  line-height: 1.65;
}
```

### Spacing System

```css
/* Based on 0.25rem (4px) increments */
--space-xs: 0.5rem; /* 8px */
--space-sm: 0.75rem; /* 12px */
--space-md: 1rem; /* 16px */
--space-lg: 1.5rem; /* 24px */
--space-xl: 2rem; /* 32px */
--space-2xl: 3rem; /* 48px */
--space-3xl: 4rem; /* 64px */
```

### Border Radius

```css
--radius-sm: 8px; /* Buttons, inputs */
--radius-md: 12px; /* Cards */
--radius-lg: 16px; /* Panels */
--radius-xl: 20px; /* Sections */
--radius-2xl: 24px; /* Hero elements */
--radius-full: 999px; /* Pills */
```

### Shadow System

```css
--shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.06);
--shadow-md: 0 4px 16px rgba(0, 0, 0, 0.08);
--shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.12);
--shadow-xl: 0 24px 60px rgba(0, 0, 0, 0.15);
```

---

## 🔧 Configuration

### Custom Domain Setup (GitHub Pages)

The `CNAME` file contains:

```
looom.me
```

**DNS Configuration:**

```
Type  | Name | Value
------|------|------
A     | @    | 185.199.108.153
A     | @    | 185.199.109.153
A     | @    | 185.199.110.153
A     | @    | 185.199.111.153
CNAME | www  | timurnasriddinov.github.io
```

### Canvas Configuration

Located in `configurator.html`:

```javascript
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 700;

const PRINT_AREA = {
  x: 175,
  y: 220,
  width: 250,
  height: 250, // Printable design area
};
```

### Product Data

Edit `products-catalog.js` to modify products:

```javascript
const products = [
  {
    id: 1,
    name: "Классическая футболка",
    nameEn: "Regular T-shirt",
    type: "Обычная футболка",
    image: "products/tshirt_regular_white_001.jpg",
    price: 150000,
    customizable: true,
  },
  // ... add more products
];
```

---

## 📞 Support & Contact

**Author:** Timur Nasriddinov  
**Website:** [looom.me](https://looom.me)  
**GitHub:** [@TIMURNASRIDDINOV](https://github.com/TIMURNASRIDDINOV)

---

## 📄 License

This project is proprietary. All rights reserved.

---

## 🙏 Acknowledgments

- **Three.js** - Ricardo Cabello (mrdoob) for 3D rendering library
- **Tailwind CSS** - Adam Wathan & Tailwind Labs
- **Lucide Icons** - Lucide contributors
- **Google Fonts** - Inter typeface by Rasmus Andersson
- **React Team** - For React 18 UMD builds

---

**Last Updated:** December 22, 2025  
**Version:** 1.0.0-alpha  
**Build:** GitHub Pages Static Deploy
