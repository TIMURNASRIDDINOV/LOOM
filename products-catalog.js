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
  function createProductCard(product) {
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

    // Price
    const priceDiv = document.createElement("div");
    priceDiv.className = "product-card__price";
    priceDiv.textContent = formatPrice(product.price);

    // Actions container
    const actions = document.createElement("div");
    actions.className = "product-card__actions";

    // Customize button
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

    // Add click event listener
    if (product.customizable) {
      button.addEventListener("click", function () {
        window.location.href = "configurator.html";
      });
    }

    actions.appendChild(button);

    // Assemble content
    content.appendChild(title);
    content.appendChild(description);
    content.appendChild(priceDiv);
    content.appendChild(actions);

    // Assemble card
    card.appendChild(imageContainer);
    card.appendChild(content);

    return card;
  }

  // Render products to container
  function renderProducts() {
    const container = document.getElementById("product-list-root");

    if (!container) {
      console.error("Product container #product-list-root not found");
      return;
    }

    // Clear existing content
    container.innerHTML = "";

    // Create grid container
    const grid = document.createElement("div");
    grid.className = "product-grid";

    // Check if we're on index.html - only show first 3 products
    const isIndexPage =
      window.location.pathname.endsWith("index.html") ||
      window.location.pathname === "/" ||
      window.location.pathname.endsWith("/");

    const productsToShow = isIndexPage ? products.slice(0, 3) : products;

    // Generate and append product cards
    productsToShow.forEach(function (product) {
      const card = createProductCard(product);
      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderProducts);
  } else {
    renderProducts();
  }
})();
