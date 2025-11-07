// --- DOM and canvas setup (full window) ---
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const startUI = document.getElementById("startUI");
const restartBtn = document.getElementById("restartBtn");
const playBtn = document.getElementById("playBtn");


const dpr = window.devicePixelRatio;
const rect = canvas.getBoundingClientRect();
canvas.width = rect.width * dpr;
canvas.height = rect.height * dpr;
ctx.scale(dpr, dpr);
canvas.style.width = `${rect.width}px`;
canvas.style.height = `${rect.height}px`;


// World settings
const WORLD_WIDTH = 8000; // Much wider world
const VISIBLE_MARGIN = 200; // How far beyond screen edges to render
let cameraX = 0; // Camera position for scrolling

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// --- Load sprites ---
const images = {
    plane: { img: new Image(), src: "plane.png" },
    bomb: { img: new Image(), src: "bomb.png" },
    terrain: { img: new Image(), src: "terrain.png" },
    explosion: { img: new Image(), src: "explosion.png" },
    tank: { img: new Image(), src: "tank.png" },
    fuelcan: { img: new Image(), src: "fuelcan.png" },
    tower: { img: new Image(), src: "tower.png" },
    heart: { img: new Image(), src: "heart.png" },
    kills: { img: new Image(), src: "kills.png" },
    key: { img: new Image(), src: "key.png" }
};

// Wait for all images to load before starting
let loadedImages = 0;
const totalImages = Object.keys(images).length;

function startGameWhenLoaded() {
    loadedImages++;
    if (loadedImages === totalImages) {
        console.log("All images loaded, starting game...");
        gameLoop();
    }
}

// Load all images
Object.values(images).forEach(img => {
    img.img.onload = startGameWhenLoaded;
    img.img.onerror = (e) => console.error("Failed to load image:", img.src);
    img.img.src = img.src;
});

// --- Game states ---
let gameState = "start"; // "start", "playing", "gameover"
let keys = {};
let mouse = {x: 0, y: 0};
let useMouse = false;

// --- Plane physics: throttle and tilt controls ---
function makePlane() {
  return {
    x: canvas.width/2,
    y: canvas.height/3,
    vx: 4, vy: 0,
    angle: 0,  // angle in radians, 0 = pointing right
    speed: 4,  // current speed
    minSpeed: 3,  // minimum flying speed
    maxSpeed: 7,  // maximum flying speed
    throttleResponse: 0.1,  // how quickly speed changes
    turnRate: 0.045,  // how quickly the plane rotates
    drag: 0.995,  // air resistance
    alive: true,
    fuel: 200,
    lives: 3,
    kills: 0,
    startTime: Date.now(), // for survival timer
    endTime: null // will store time of death
  };
}

let plane = makePlane();
let bombs = [], explosions = [], tanks = [], fuelCans = [], hearts = [], bullets = [];

// Tower setup
const TOWER_WIDTH = 48;
const TOWER_HEIGHT = 96;
const BULLET_SPEED = 5;
const TOWER_FIRE_RATE = 60; // frames between shots
let towers = [];

function setupTowers() {
  // Place towers at regular intervals throughout the world
  const towerSpacing = WORLD_WIDTH / 8; // 8 towers total in the world
  for (let i = 0; i < 8; i++) {
    towers.push({
      x: towerSpacing * i + towerSpacing/2, // Evenly spaced
      y: 0, // will be adjusted to ground level
      lastShot: 0,
      alive: true,
      side: i % 2 === 0 ? 'left' : 'right'
    });
  }
}

function fireBullet(tower) {
  const angle = Math.atan2(plane.y - tower.y, plane.x - tower.x);
  bullets.push({
    x: tower.x + TOWER_WIDTH/2,
    y: tower.y + TOWER_WIDTH/2,
    vx: Math.cos(angle) * BULLET_SPEED,
    vy: Math.sin(angle) * BULLET_SPEED
  });
  tower.lastShot = 0;
}

// Power-up properties
const POWERUP_FLOAT_SPEED = .75;  // pixels per frame
const FUEL_SPAWN_CHANCE = 0.5; // 50% chance on tank destroy
const HEART_SPAWN_CHANCE = 0.25; // 20% chance on tank destroy

function spawnPowerupsFromTank(x, y) {
  // Try to spawn a fuel can
  if (Math.random() < FUEL_SPAWN_CHANCE) {
    fuelCans.push({
      x: x,
      y: y,
      alive: true,
      vy: -POWERUP_FLOAT_SPEED // negative y velocity = upward movement
    });
  }
  
  // Try to spawn a heart
  if (Math.random() < HEART_SPAWN_CHANCE) {
    hearts.push({
      x: x,
      y: y,
      alive: true,
      vy: -POWERUP_FLOAT_SPEED // negative y velocity = upward movement
    });
  }
}

let terrain = [];
function genTerrain(width, height, segments) {
  let arr = [];
  let lastY = Math.max(height - 210, height/1.2);
  for (let i = 0; i <= segments; i++) {
    let nY = lastY + (Math.random()-0.5)*120; // Increased variation
    // Allow more extreme heights but keep within playable range
    nY = Math.max(height-440, Math.min(height-60, nY));
    arr.push({x: i*(width/segments), y:nY});
    lastY = nY;
  }
  return arr;
}

function terrainY(x) {
  for (let i = 0; i < terrain.length-1; i++) {
    let p0 = terrain[i], p1 = terrain[i+1];
    if (x >= p0.x && x <= p1.x)
      return p0.y + (p1.y-p0.y)*((x-p0.x)/(p1.x-p0.x));
  }
  return canvas.height-50;
}

function drawTerrain(arr) {
  for (let i=0; i<arr.length-1; i++) {
    let p0=arr[i], p1=arr[i+1];
    let w=p1.x-p0.x, h=canvas.height-p0.y;
    ctx.drawImage(images.terrain.img, p0.x, p0.y, w, h);
  }
}

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function resetGame(fullReset=true) {
  plane = makePlane();
  bombs = []; explosions = []; tanks = []; fuelCans = []; hearts = []; bullets = [];
  terrain = genTerrain(WORLD_WIDTH, canvas.height, Math.floor(WORLD_WIDTH/32));
  cameraX = 0;
  // Setup towers and adjust their Y position to ground level
  towers = [];
  setupTowers();
  towers.forEach(tower => {
    tower.y = terrainY(tower.x) - TOWER_HEIGHT;
  });
  if (fullReset) gameState="playing";
}

playBtn.onclick = () => {
  // hide start UI (container) and start the game
  startUI.style.display = "none";
  resetGame();
};

restartBtn.onclick = () => {
  restartBtn.style.display = "none";
  resetGame(false);
  gameState = "playing";
};

canvas.addEventListener("mousemove", e => {
  mouse.x=e.clientX; mouse.y=e.clientY;
});

canvas.addEventListener("keydown", e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === "m") useMouse = !useMouse;
  if (e.key === " " && plane.alive && gameState==="playing") dropBomb();
});

canvas.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

canvas.addEventListener("click", e => {
  if (gameState==="playing") dropBomb();
});

canvas.tabIndex = 0;
canvas.focus();

function dropBomb() {
  bombs.push({
    x: plane.x,  // drop from plane's center
    y: plane.y,  // drop from plane's center
    vx: plane.vx*0.7, 
    vy: plane.vy*0.7+6, 
    exploded: false
  });
}

function respawnTank() {
  // Count tanks in visible area
  const visibleTanks = tanks.filter(t => 
    t.x >= cameraX - VISIBLE_MARGIN && 
    t.x <= cameraX + canvas.width + VISIBLE_MARGIN
  ).length;

  // Only spawn if we have less than 4 tanks in visible area
  if (visibleTanks < 4) {
    // Spawn tanks within visible area plus margin
    const minX = Math.max(0, cameraX - VISIBLE_MARGIN);
    const maxX = Math.min(WORLD_WIDTH, cameraX + canvas.width + VISIBLE_MARGIN);
    let x = minX + Math.random() * (maxX - minX);
    tanks.push({x:x, y:terrainY(x)-26, alive:true});
  }
}

function planeHitTerrain(p, arr) {
  const px = p.x+Math.cos(p.angle+Math.PI/2)*24, py = p.y+Math.sin(p.angle+Math.PI/2)*24; // Reduced from 32 to 24
  for (let i = 0; i < arr.length-1; i++) {
    let p0 = arr[i], p1 = arr[i+1];
    if (px >= p0.x && px <= p1.x) {
      let ty = p0.y + (p1.y-p0.y)*((px-p0.x)/(p1.x-p0.x));
      if (py > ty) return true;
    }
  }
  return false;
}

function updatePlanePhysics() {
  if (gameState==="playing" && plane.alive) {
    // Throttle control (W/S or Up/Down)
    if (plane.fuel > 0) {
      // Throttle control with up/down
      if (keys["arrowup"]||keys["w"]) {
        plane.speed = Math.min(plane.maxSpeed, plane.speed + plane.throttleResponse);
      }
      if (keys["arrowdown"]||keys["s"]) {
        plane.speed = Math.max(plane.minSpeed, plane.speed - plane.throttleResponse);
      }
      
      // Constant fuel consumption based on speed
      // Consume more fuel at higher speeds (linear scaling)
      const speedFactor = (plane.speed - plane.minSpeed) / (plane.maxSpeed - plane.minSpeed);
      plane.fuel -= 0.08 + (speedFactor * 0.12); // 0.08-0.20 fuel/frame based on speed
    } else {
      // No fuel - force minimum speed
      plane.speed = Math.max(plane.minSpeed, plane.speed - plane.throttleResponse * 2);
    }

    // Turning (Left/Right changes angle)
    if (keys["arrowright"]||keys["d"]) {
      plane.angle += plane.turnRate;
    }
    if (keys["arrowleft"]||keys["a"]) {
      plane.angle -= plane.turnRate;
    }

    // Apply velocity based on angle and speed
    plane.vx = Math.cos(plane.angle) * plane.speed;
    plane.vy = Math.sin(plane.angle) * plane.speed;

    // Update position with drag
    plane.vx *= plane.drag;
    plane.vy *= plane.drag;
    plane.x += plane.vx;
    plane.y += plane.vy;

    // Keep plane in world bounds and update camera
    plane.x = Math.max(0, Math.min(WORLD_WIDTH, plane.x));
    plane.y = Math.max(15, Math.min(canvas.height-42, plane.y));
    
    // Update camera to follow plane
    cameraX = Math.max(0, Math.min(WORLD_WIDTH - canvas.width, plane.x - canvas.width/2));

    // Normalize speed after drag
    plane.speed = Math.hypot(plane.vx, plane.vy);
    if (plane.speed < plane.minSpeed) plane.speed = plane.minSpeed;
  }
}

function update() {
  if (gameState==="start") return;
  if (gameState==="gameover") return;

  updatePlanePhysics();

  if (plane.fuel<=0) plane.alive=false;

  if (planeHitTerrain(plane, terrain) && plane.alive) {
    plane.alive = false;
  }

  // Bombs physics
  for (let bomb of bombs) {
    bomb.x += bomb.vx;
    bomb.y += bomb.vy;
    bomb.vy += 0.6; // gravity
    const by = terrainY(bomb.x);
    if (bomb.y > by-4 && !bomb.exploded) {
      bomb.exploded = true;
      explosions.push({x:bomb.x, y:by-2, radius:6, life:16});
      // Check for tank hits
      tanks.forEach(t=>{
        const dist = Math.hypot(t.x-bomb.x,t.y-bomb.y);
        if (dist < 38 && t.alive) {
          t.alive = false;
          plane.kills++; // Increment kills for tank destruction
          // Chance to spawn powerups from destroyed tank
          spawnPowerupsFromTank(t.x, t.y - 10); // spawn slightly above tank position
        }
      });
      
      // Check for tower hits
      towers.forEach(t => {
        const dist = Math.hypot(t.x-bomb.x, t.y-bomb.y);
        if (dist < 48 && t.alive) { // Slightly larger hit area for towers
          t.alive = false;
          plane.kills += 2; // Two kills for destroying a tower
          // Create explosion at tower location
          explosions.push({
            x: t.x + TOWER_WIDTH/2,
            y: t.y + TOWER_HEIGHT/2,
            radius: 12,
            life: 20
          });
        }
      });
    }
  }
  bombs = bombs.filter(b=>b.y < canvas.height && !b.exploded);

  // Explosions animate
  for (let ex of explosions) ex.radius += 2, ex.life--;
  explosions = explosions.filter(e=>e.life > 0);

  // Remove dead tanks and handle respawning
  tanks = tanks.filter(t => t.alive);
  // Try to maintain 4 tanks in the visible area
  for (let i = 0; i < 4; i++) {
    respawnTank();
  }

  // Update fuel cans: move upward and remove when off screen
  fuelCans = fuelCans.filter(f => {
    if (f.alive) {
      f.y += f.vy; // move upward (negative vy)
      // Check if fuel can is off screen (above)
      return f.y + 26 > 0; // keep if still on screen
    }
    return false;
  });

  // Update hearts: move upward and remove when off screen
  hearts = hearts.filter(h => {
    if (h.alive) {
      h.y += h.vy; // move upward (negative vy)
      // Check if heart is off screen (above)
      return h.y + 26 > 0; // keep if still on screen
    }
    return false;
  });

  // Update towers and bullets
  if (plane.alive) {
    // Tower shooting - only when tower is within visible range (camera view +/- margin)
    towers.forEach(tower => {
      const inView = tower.x >= (cameraX - VISIBLE_MARGIN) && tower.x <= (cameraX + canvas.width + VISIBLE_MARGIN);
      if (inView) {
        tower.lastShot++;
        if (tower.lastShot >= TOWER_FIRE_RATE) {
          fireBullet(tower);
        }
      } else {
        // Keep lastShot from growing unbounded while offscreen so towers don't immediately spam when entering view
        tower.lastShot = Math.min(tower.lastShot, Math.max(0, TOWER_FIRE_RATE - Math.floor(TOWER_FIRE_RATE/4)));
      }
    });

    // Update bullets
    bullets = bullets.filter(bullet => {
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      
      // Check collision with plane
      if (plane.alive) {
        const dist = Math.hypot(bullet.x - plane.x, bullet.y - plane.y);
        if (dist < 18) { // Hit! (Reduced from 24 to 18 to match smaller plane)
          // Create small explosion at bullet impact point
          explosions.push({
            x: bullet.x,
            y: bullet.y,
            radius: 3, // Start smaller than bomb explosions
            life: 8    // Shorter life than bomb explosions
          });
          plane.lives--;
          if (plane.lives <= 0) {
            plane.alive = false;
            // Create larger explosion when plane dies
            explosions.push({
              x: plane.x,
              y: plane.y,
              radius: 8,
              life: 16
            });
          }
          return false; // Remove bullet
        }
      }
      
      // Remove bullets that go out of world bounds (world x and canvas height)
      return bullet.x >= 0 && bullet.x <= WORLD_WIDTH && 
        bullet.y >= 0 && bullet.y <= canvas.height;
    });
  }

  fuelCans.forEach(f => {
    const dist = Math.hypot(f.x-plane.x, f.y-plane.y);
    if (dist < 32 && f.alive) { f.alive = false; plane.fuel += 120; }
  });

  // Check heart collection
  hearts.forEach(h => {
    const dist = Math.hypot(h.x-plane.x, h.y-plane.y);
    if (dist < 32 && h.alive) { 
      h.alive = false; 
      if (plane.lives < 5) { // Max 5 lives
        plane.lives++; 
      }
    }
  });

  // If dead, show restart and store death time
  if (!plane.alive && gameState==="playing") {
    gameState = "gameover";
    plane.endTime = Date.now();
    restartBtn.style.display = "block";
  }
}

function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  
  // Apply camera transform for world scrolling
  ctx.save();
  ctx.translate(-cameraX, 0);

  if (gameState==="start") {
    // show start UI
    startUI.style.display = "flex";
    // Plane bobbing animation: place plane far to the right within the title area
    let t = Date.now()/520;
    let px = canvas.width * 0.82; // far right
    let py = canvas.height * 0.28 - Math.sin(t) * 30;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(2.5, 2.5);
    ctx.drawImage(images.plane.img, -24, -12, 48, 24); // Reduced from 64x32 to 48x24
    ctx.restore();
    return;
  } else {
    startUI.style.display = "none";
  }

  drawTerrain(terrain);

  // Draw towers (only if alive)
  for (let tower of towers) {
    if (tower.alive) {
      ctx.drawImage(images.tower.img, tower.x, tower.y, TOWER_WIDTH, TOWER_HEIGHT);
    }
  }

  // Draw bullets
  ctx.fillStyle = "#000";
  for (let bullet of bullets) {
    ctx.fillRect(bullet.x - 2, bullet.y - 2, 4, 4);
  }

  for (let tank of tanks)
    ctx.drawImage(images.tank.img, tank.x-18, tank.y-12, 36, 24);

  for (let f of fuelCans)
    ctx.drawImage(images.fuelcan.img, f.x-13, f.y-13, 26, 26);

  for (let h of hearts)
    ctx.drawImage(images.heart.img, h.x-13, h.y-13, 26, 26);

  for (let bomb of bombs)
    ctx.drawImage(images.bomb.img, bomb.x-8, bomb.y-8, 16, 16);

  for (let ex of explosions)
    ctx.drawImage(images.explosion.img, ex.x-ex.radius, ex.y-ex.radius, ex.radius*2, ex.radius*2);

  // Draw plane (with rotation)
  if (plane.alive) {
    ctx.save();
    ctx.translate(plane.x, plane.y);
    ctx.rotate(plane.angle);
    ctx.drawImage(images.plane.img, -24, -24, 48, 48); // Reduced from 64x32 to 48x24
    ctx.restore();
  }

  // Reset transform for UI elements
  ctx.restore();
  
  // --- HUD ---
  ctx.font = "bold 2.0vw monospace";
  ctx.fillStyle = "#fff";
  
  // Left-aligned HUD group (Fuel, Speed, Lives)
  // Order: Fuel (left), Speed (middle), Lives (rightmost of left group)
  ctx.fillText(`Fuel: ${plane.fuel.toFixed(0)}`, 40, 48);
  ctx.fillText(`Speed: ${((plane.speed/plane.maxSpeed)*100).toFixed(0)}%`, 220, 48);
  ctx.fillText(`Lives: ${"I".repeat(plane.lives)}`, 380, 48); // Moved 20px to the left
  
  // Time survived (top right)
  const currentTime = plane.endTime || Date.now();
  const timeAlive = currentTime - plane.startTime;
  ctx.textAlign = "right";
  ctx.fillText(`Time: ${formatTime(timeAlive)}`, canvas.width - 40, 48);
  ctx.textAlign = "left";

  // Draw kill counter (bottom left)
  ctx.save();
  ctx.drawImage(images.kills.img, 40, canvas.height - 200, 160, 160); // Draw kill icon 5x larger
  ctx.font = "bold 160px monospace"; // 5x larger font
  ctx.fillStyle = "#00ff00"; // Neon green
  ctx.fillText(`${plane.kills}`, 220, canvas.height - 80); // Adjusted position for larger elements
  ctx.restore();
  
  if (gameState==="gameover") {
    ctx.font = "bold 4vw monospace";
    ctx.fillStyle="#fad932";
    ctx.textAlign = "center";
    ctx.fillText("GAME OVER", canvas.width/2, canvas.height/2-50);
    ctx.font = "bold 2.5vw monospace";
    ctx.fillStyle = "#fff";
    const survivedTime = plane.endTime - plane.startTime;
    ctx.fillText(`Time Survived: ${formatTime(survivedTime)}`, canvas.width/2, canvas.height/2+18);
    
    // Draw the key image on the right side
    const keyWidth = 350; // Much bigger
    const keyHeight = 350; // Maintain aspect ratio assuming 750x500 source image
    const keyX = canvas.width - keyWidth - 40; // 40px from right edge
    const keyY = canvas.height/2 - keyHeight/2; // Centered vertically
    ctx.drawImage(images.key.img, keyX, keyY, keyWidth, keyHeight);
    
    ctx.textAlign = "left";
  }
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}