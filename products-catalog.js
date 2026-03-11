// Vanilla JavaScript Product Catalog
(function () {
  "use strict";

  // Products data
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
    {
      id: 2,
      name: "Белый свитшот",
      nameEn: "White Sweatshirt",
      type: "Свитшот",
      image: "products/sweatshirt_regular_white_001.jpg",
      price: 250000,
      customizable: true,
    },
    {
      id: 3,
      name: "Худи на молнии",
      nameEn: "Zip Hoodie",
      type: "Худи с застежкой",
      image: "products/hoodie_ziphoodie_white_001.jpg",
      price: 280000,
      customizable: true,
    },
    {
      id: 4,
      name: "Поло",
      nameEn: "Polo Shirt",
      type: "Поло рубашка",
      image: "products/polo_regular_white_001.jpg",
      price: 180000,
      customizable: true,
    },
    {
      id: 5,
      name: "Кепка",
      nameEn: "Cap",
      type: "Бейсболка",
      image: "products/cap_regular_white_001.jpg",
      price: 100000,
      customizable: true,
    },
    {
      id: 6,
      name: "Спортивные штаны",
      nameEn: "Sweatpants",
      type: "Спортивные брюки",
      image: "products/sweatpants_regular_white_001.jpg",
      price: 220000,
      customizable: true,
    },
    {
      id: 7,
      name: "Худи классическое",
      nameEn: "Regular Hoodie",
      type: "Обычное худи",
      image: "products/hoodie_regular_white_001.jpg",
      price: 270000,
      customizable: true,
    },
    {
      id: 8,
      name: "Футболка с укороченным рукавом",
      nameEn: "Cropped T-shirt",
      type: "Кроп-топ",
      image: "products/tshirt_cropped_white_001.jpg",
      price: 140000,
      customizable: true,
    },
    {
      id: 9,
      name: "Футболка без рукавов",
      nameEn: "Muscle T-shirt",
      type: "Майка",
      image: "products/tshirt_muscle_white_001.jpg",
      price: 130000,
      customizable: true,
    },
  ];

  // Format price in сум
  function formatPrice(price) {
    return price.toLocaleString("ru-RU") + " сум";
  }

  // Create product card element
  function createProductCard(product, options = {}) {
    const { showPrice = true, showButton = true } = options;
    // Main card container
    const card = document.createElement("div");
    card.className = "product-card";
    card.setAttribute("data-product-id", product.id);

    // Image container
    const imageContainer = document.createElement("div");
    imageContainer.className = "product-card__image-container";

    const img = document.createElement("img");
    img.src = product.image;
    img.alt = `${product.name} - ${product.type}`;
    img.className = "product-card__image";

    // Image error handling
    img.onerror = function () {
      this.src =
        "https://via.placeholder.com/400x400/f5f5f5/666666?text=" +
        encodeURIComponent(product.name);
    };

    imageContainer.appendChild(img);

    // Content container
    const content = document.createElement("div");
    content.className = "product-card__content";

    // Product name
    const title = document.createElement("h3");
    title.className = "product-card__title";
    title.textContent = product.name;

    // Product description
    const description = document.createElement("p");
    description.className = "product-card__description";
    description.textContent = product.type;

    content.appendChild(title);
    content.appendChild(description);

    if (showPrice) {
      const priceDiv = document.createElement("div");
      priceDiv.className = "product-card__price";
      priceDiv.textContent = formatPrice(product.price);
      content.appendChild(priceDiv);
    }

    if (showButton) {
      const actions = document.createElement("div");
      actions.className = "product-card__actions";

      const button = document.createElement("button");
      button.className = product.customizable
        ? "customize-btn btn-primary"
        : "customize-btn btn-disabled";
      button.textContent = product.customizable
        ? "Настроить дизайн"
        : "Недоступно";
      button.disabled = !product.customizable;
      button.setAttribute(
        "aria-label",
        product.customizable
          ? `Настроить дизайн ${product.name}`
          : `Недоступно для ${product.name}`
      );

      if (product.customizable) {
        button.addEventListener("click", function () {
          window.location.href = "configurator.html";
        });
      }

      actions.appendChild(button);
      content.appendChild(actions);
    }

    // Assemble card
    card.appendChild(imageContainer);
    card.appendChild(content);

    return card;
  }

  function renderGrid(container) {
    const grid = document.createElement("div");
    grid.className = "product-grid";

    products.forEach(function (product) {
      const card = createProductCard(product);
      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  function renderCarousel(container) {
    var featuredProducts = products.slice(0, 3);
    var currentIndex = 0;

    var wrapper = document.createElement("div");
    wrapper.className = "product-carousel";

    var prevBtn = document.createElement("button");
    prevBtn.className = "carousel-arrow carousel-arrow--prev";
    prevBtn.setAttribute("aria-label", "Предыдущий товар");
    prevBtn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';

    var nextBtn = document.createElement("button");
    nextBtn.className = "carousel-arrow carousel-arrow--next";
    nextBtn.setAttribute("aria-label", "Следующий товар");
    nextBtn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

    var viewport = document.createElement("div");
    viewport.className = "product-carousel__viewport";

    var track = document.createElement("div");
    track.className = "product-carousel__track";

    featuredProducts.forEach(function (product) {
      var card = createProductCard(product, {
        showPrice: true,
        showButton: false,
      });
      card.style.cursor = "pointer";
      card.addEventListener("click", function () {
        window.location.href = "configurator.html";
      });
      track.appendChild(card);
    });

    var dotsEl = document.createElement("div");
    dotsEl.className = "carousel-dots";
    featuredProducts.forEach(function (_, i) {
      var dot = document.createElement("button");
      dot.className = "carousel-dot" + (i === 0 ? " active" : "");
      dot.setAttribute("aria-label", "Перейти к товару " + (i + 1));
      dot.addEventListener("click", function () {
        goTo(i);
      });
      dotsEl.appendChild(dot);
    });

    function cardScrollOffset(index) {
      var card = track.children[index];
      // Center the card in the viewport
      return card.offsetLeft - (viewport.offsetWidth - card.offsetWidth) / 2;
    }

    function updateState() {
      prevBtn.disabled = currentIndex === 0;
      nextBtn.disabled = currentIndex === featuredProducts.length - 1;
      dotsEl.querySelectorAll(".carousel-dot").forEach(function (d, i) {
        d.classList.toggle("active", i === currentIndex);
      });
    }

    function goTo(index) {
      currentIndex = Math.max(0, Math.min(index, featuredProducts.length - 1));
      viewport.scrollTo({
        left: cardScrollOffset(currentIndex),
        behavior: "smooth",
      });
      updateState();
    }

    prevBtn.addEventListener("click", function () {
      goTo(currentIndex - 1);
    });
    nextBtn.addEventListener("click", function () {
      goTo(currentIndex + 1);
    });

    // Sync dot state when user manually scrolls
    viewport.addEventListener(
      "scroll",
      function () {
        var center = viewport.scrollLeft + viewport.offsetWidth / 2;
        var closest = 0;
        var closestDist = Infinity;
        for (var i = 0; i < track.children.length; i++) {
          var card = track.children[i];
          var cardCenter = card.offsetLeft + card.offsetWidth / 2;
          var dist = Math.abs(center - cardCenter);
          if (dist < closestDist) {
            closestDist = dist;
            closest = i;
          }
        }
        if (closest !== currentIndex) {
          currentIndex = closest;
          updateState();
        }
      },
      { passive: true }
    );

    updateState();

    viewport.appendChild(track);
    wrapper.appendChild(prevBtn);
    wrapper.appendChild(viewport);
    wrapper.appendChild(nextBtn);
    wrapper.appendChild(dotsEl);
    container.appendChild(wrapper);
  }

  // Render products to container
  function renderProducts() {
    const container = document.getElementById("product-list-root");

    if (!container) {
      console.error("Product container #product-list-root not found");
      return;
    }

    container.innerHTML = "";

    const isIndexPage =
      window.location.pathname.endsWith("index.html") ||
      window.location.pathname === "/" ||
      window.location.pathname.endsWith("/");

    if (isIndexPage) {
      renderCarousel(container);
    } else {
      renderGrid(container);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderProducts);
  } else {
    renderProducts();
  }
})();
