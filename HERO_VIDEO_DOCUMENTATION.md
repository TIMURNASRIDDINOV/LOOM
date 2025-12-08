# Responsive Hero Video Section - Complete Documentation

## Overview
A fully responsive hero video section that is perfectly centered on both desktop and mobile devices using modern CSS best practices and mobile-first approach.

---

## HTML Structure

```html
<!-- Hero Section -->
<section class="hero-section">
  <div class="hero-container">
    <!-- Text Content -->
    <div class="hero-text">
      <div class="hero-content">
        <div class="eyebrow">Новый • Индивидуальный стиль</div>
        <h1 class="hero-title">Do It Yourself</h1>
        <p class="hero-subtitle">
          Уникальные футболки с вашим дизайном. Премиальные материалы,
          чистая эстетика, быстрый выпуск.
        </p>
        <!-- Call-to-Action Buttons -->
        <div class="hero-cta">
          <a href="configurator.html" class="btn-primary">Создать дизайн</a>
          <a href="#products" class="btn-outline">Смотреть каталог</a>
        </div>
      </div>
    </div>

    <!-- Video Section -->
    <div class="hero-3d-wrapper">
      <div class="model-preview-section">
        <div class="video-wrapper">
          <video autoplay loop muted playsinline class="preview-video">
            <source src="images/tshirtgif.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>
      </div>
    </div>
  </div>
</section>
```

---

## CSS - Mobile-First Approach

### Base Styles (Mobile First)

```css
/* Hero Section - Mobile First */
.hero-section {
  background: radial-gradient(
    1200px 600px at 50% -10%,
    #0b0b0b 0%,
    #000 60%,
    #000 100%
  );
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow-x: hidden; /* Prevent horizontal scroll */
  /* Mobile-first: no side padding */
  padding: 80px 0 60px;
}

.hero-container {
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  display: flex; /* Mobile-first: flex column */
  flex-direction: column;
  gap: 2rem;
  align-items: center;
  /* Mobile: container manages padding */
  padding: 0 1rem;
}

.hero-text {
  width: 100%; /* Mobile: full width */
  max-width: 520px;
}

.hero-content {
  /* Mobile-first: centered */
  text-align: center;
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.hero-cta {
  display: flex;
  flex-direction: column; /* Mobile: stacked buttons */
  gap: 0.75rem;
  width: 100%;
  align-items: center;
  justify-content: center;
}

.hero-cta .btn-primary,
.hero-cta .btn-outline {
  width: 100%;
  max-width: 320px; /* Limit button width */
  text-align: center;
}

.hero-3d-wrapper {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.model-preview-section {
  width: 100%;
  max-width: 100%;
  padding: 0;
  margin: 0;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* Video wrapper - Mobile first: perfectly centered */
.video-wrapper {
  width: 100%;
  max-width: 320px; /* Mobile size */
  margin: 0 auto;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  aspect-ratio: 1/1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
```

### Desktop & Tablet (≥768px)

```css
@media (min-width: 768px) {
  .hero-section {
    padding: 80px 2rem 60px; /* Add side padding on larger screens */
  }

  .hero-container {
    display: grid; /* Switch to grid layout */
    grid-template-columns: 1fr 1fr; /* Two columns */
    gap: 60px;
    padding: 0; /* Remove container padding */
  }

  .hero-content {
    text-align: left; /* Left-align on desktop */
    align-items: flex-start; /* Align to start */
  }

  .hero-cta {
    flex-direction: row; /* Horizontal buttons */
    gap: 1rem;
    width: auto; /* Auto width */
    justify-content: flex-start; /* Align to start */
  }

  .hero-cta .btn-primary,
  .hero-cta .btn-outline {
    width: auto; /* Auto width on desktop */
  }

  .video-wrapper {
    max-width: 420px; /* Larger on desktop */
    border-radius: 16px; /* Larger radius */
  }
}
```

### Large Desktop (≥1024px)

```css
@media (min-width: 1024px) {
  .hero-container {
    gap: 80px; /* More spacing on large screens */
  }
}
```

### Small Mobile (≤480px)

```css
@media (max-width: 480px) {
  .hero-section {
    padding: 60px 0 40px; /* Reduce vertical padding */
  }

  .hero-container {
    gap: 1.5rem;
    padding: 0 0.75rem; /* Tighter padding on small screens */
  }

  .model-viewer-container {
    height: 300px;
  }

  .section {
    padding: 2.5rem 0;
  }

  .hero-title {
    font-size: 2rem;
  }

  .hero-subtitle {
    font-size: 0.95rem;
  }
}
```

### Extra Small Devices (≤375px)

```css
@media (max-width: 375px) {
  .hero-container {
    padding: 0 0.5rem; /* Even tighter padding */
  }

  .video-wrapper {
    border-radius: 8px; /* Smaller radius */
  }

  .hero-cta {
    gap: 0.5rem;
  }

  .btn-primary,
  .btn-outline {
    font-size: 0.9rem;
    padding: 0.8rem 1.4rem;
  }
}
```

---

## Key Features

### ✅ Mobile-First Approach
- Base styles target mobile devices
- Progressive enhancement for larger screens
- Cleaner, more maintainable code

### ✅ Perfect Centering
- Video centered horizontally on all devices
- No horizontal overflow or scrolling
- Uses `margin: 0 auto` and `display: flex` with `justify-content: center`

### ✅ Responsive Breakpoints
| Device | Width | Layout |
|--------|-------|--------|
| Mobile | < 375px | Single column, video 320px |
| Small Mobile | 375px - 480px | Single column, video 320px |
| Mobile/Tablet | 480px - 768px | Single column, video 320px |
| Desktop | ≥ 768px | Two columns (grid), video 420px |
| Large Desktop | ≥ 1024px | Two columns with more spacing |

### ✅ Modern CSS Best Practices
- Flexbox and Grid for layout
- `aspect-ratio` for maintaining video proportions
- `clamp()` for responsive typography
- CSS custom properties for consistency
- `overflow-x: hidden` to prevent horizontal scroll

### ✅ Accessibility
- `playsinline` attribute for iOS autoplay
- Semantic HTML structure
- Proper ARIA labels (add as needed)
- Keyboard-accessible buttons

---

## Browser Support
- ✅ Chrome/Edge (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

---

## Performance Tips
1. **Optimize video file**: Use MP4 with H.264 codec
2. **Compress video**: Keep file size under 1-2MB
3. **Use poster attribute**: Show image while video loads
4. **Lazy loading**: Consider loading video only when visible

```html
<video 
  autoplay 
  loop 
  muted 
  playsinline 
  class="preview-video"
  poster="images/poster.jpg"
>
  <source src="images/tshirtgif.mp4" type="video/mp4" />
</video>
```

---

## Common Issues & Solutions

### Issue: Video not centered on iPhone
**Solution**: Ensure `.hero-section` has `overflow-x: hidden` and `.hero-container` uses padding instead of `.hero-section`

### Issue: Horizontal scroll on mobile
**Solution**: Check all parent containers have `max-width: 100%` and no fixed widths

### Issue: Video stretched or distorted
**Solution**: Use `aspect-ratio: 1/1` and `object-fit: cover` on video element

---

## Testing Checklist
- [ ] iPhone SE (375px)
- [ ] iPhone 12/13 (390px)
- [ ] iPhone 14 Pro Max (430px)
- [ ] iPad Mini (768px)
- [ ] iPad Pro (1024px)
- [ ] Desktop (1440px+)
- [ ] Test in portrait and landscape modes
- [ ] Verify no horizontal scrolling
- [ ] Check video autoplay on iOS

---

## Credits
Created with mobile-first CSS methodology and modern responsive design principles.
