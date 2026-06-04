/* AuraTrade - Physics-based Lava Lamp Blob Engine */

class LavaBlob {
  constructor(elementId, size, colorVar) {
    this.el = document.getElementById(elementId);
    this.size = size;
    this.radius = size / 2;
    this.colorVar = colorVar;

    // Start in random position within screen limits
    this.x = Math.random() * (window.innerWidth - this.size);
    this.y = Math.random() * (window.innerHeight - this.size);

    // Random initial velocities
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 0.8; // base speed
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;

    // Apply initial sizes
    this.el.style.width = `${this.size}px`;
    this.el.style.height = `${this.size}px`;
  }

  update(speedMultiplier) {
    // Apply velocity
    this.x += this.vx * speedMultiplier;
    this.y += this.vy * speedMultiplier;

    const width = window.innerWidth;
    const height = window.innerHeight;

    // Bounce off left / right bounds
    if (this.x < -this.radius) {
      this.x = -this.radius;
      this.vx = Math.abs(this.vx) * (0.9 + Math.random() * 0.2); // slight random bounce energy
    } else if (this.x > width - this.radius) {
      this.x = width - this.radius;
      this.vx = -Math.abs(this.vx) * (0.9 + Math.random() * 0.2);
    }

    // Bounce off top / bottom bounds
    if (this.y < -this.radius) {
      this.y = -this.radius;
      this.vy = Math.abs(this.vy) * (0.9 + Math.random() * 0.2);
    } else if (this.y > height - this.radius) {
      this.y = height - this.radius;
      this.vy = -Math.abs(this.vy) * (0.9 + Math.random() * 0.2);
    }

    // Apply transformation
    this.el.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
  }
}

// Instantiate and run loop
let blobs = [];

function initLavaLamp() {
  // Clear any existing animation styling to override with JS physics
  const blobStyles = document.createElement("style");
  blobStyles.textContent = `
    .blob {
      animation: none !important;
      will-change: transform;
    }
  `;
  document.head.appendChild(blobStyles);

  // Initialize 4 blobs with varied sizes
  blobs = [
    new LavaBlob("blob1", 550, "--blob-1-color"),
    new LavaBlob("blob2", 480, "--blob-2-color"),
    new LavaBlob("blob3", 600, "--blob-3-color"),
    new LavaBlob("blob4", 420, "--blob-4-color")
  ];

  // Request Animation Frame loop
  function animate() {
    // Fetch current speed multiplier from custom property
    const speedStr = getComputedStyle(document.documentElement).getPropertyValue("--blob-speed-multiplier") || "1.0";
    const speedMultiplier = parseFloat(speedStr) || 1.0;

    blobs.forEach(blob => blob.update(speedMultiplier * 1.5));
    requestAnimationFrame(animate);
  }

  animate();
}

// Initialize on load and adjust positions on resize
window.addEventListener("load", initLavaLamp);
window.addEventListener("resize", () => {
  // Recenter if viewport changed significantly
  blobs.forEach(blob => {
    if (blob.x > window.innerWidth) blob.x = window.innerWidth / 2;
    if (blob.y > window.innerHeight) blob.y = window.innerHeight / 2;
  });
});
