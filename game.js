const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const startUI = document.getElementById("startUI");
const restartBtn = document.getElementById("restartBtn");
const playBtn = document.getElementById("playBtn");

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

// --- Plane physics ---
function makePlane() {
  return {
    x: canvas.width/2,
    y: canvas.height/3,
    vx: 4, vy: 0,
    angle: 0,
    speed: 4,
    minSpeed: 3,
    maxSpeed: 7,
    throttleResponse: 0.1,
    turnRate: 0.045,
    drag: 0.995,
    alive: true,
    fuel: 200,
    lives: 3,
    kills: 0,
    startTime: Date.now(),
    endTime: null
  };
}

let plane = makePlane();
let bombs = [], explosions = [], tanks = [], fuelCans = [], hearts = [], bullets = [];

// Tower constants
const TOWER_WIDTH = 48;
const TOWER_HEIGHT = 96;
const BULLET_SPEED = 5;
const TOWER_FIRE_RATE = 60;

// Tower setup with HP property (requires 2 bombs)
let towers = [];
function setupTowers() {
  const towerSpacing = WORLD_WIDTH / 8;
  towers = [];
  for (let i = 0; i < 8; i++) {
    towers.push({
      x: towerSpacing * i + towerSpacing / 2,
      y: 0,
      lastShot: 0,
      alive: true,
      side: i % 2 === 0 ? 'left' : 'right',
      hp: 2  // Two-hit tower health
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

// Powerup spawning, terrain, and other supporting functions...

// Adjust towers Y to ground and reset on a game reset
function resetGame(fullReset=true) {
  plane = makePlane();
  bombs = [];
  explosions = [];
  tanks = [];
  fuelCans = [];
  hearts = [];
  bullets = [];
  terrain = genTerrain(WORLD_WIDTH, canvas.height, Math.floor(WORLD_WIDTH/32));
  cameraX = 0;
  setupTowers();
  towers.forEach(tower => {
    tower.y = terrainY(tower.x) - TOWER_HEIGHT;
  });
  if (fullReset) gameState = "playing";
}

playBtn.onclick = () => {
  startUI.style.display = "none";
  resetGame();
};

restartBtn.onclick = () => {
  restartBtn.style.display = "none";
  resetGame(false);
  gameState = "playing";
};

// Bomb drop function and mouse/key event handlers...

function dropBomb() {
  bombs.push({
    x: plane.x,
    y: plane.y,
    vx: plane.vx * 0.7,
    vy: plane.vy * 0.7 + 6,
    exploded: false
  });
}

// Update loop including tower damage by bombs with HP logic
function update() {
  if (gameState === "start" || gameState === "gameover") return;

  updatePlanePhysics();

  if (plane.fuel <= 0) plane.alive = false;

  if (planeHitTerrain(plane, terrain) && plane.alive) {
    plane.alive = false;
  }

  // Bombs physics and collision
  for (let bomb of bombs) {
    bomb.x += bomb.vx;
    bomb.y += bomb.vy;
    bomb.vy += 0.6; // gravity
    const by = terrainY(bomb.x);

    if (bomb.y > by - 4 && !bomb.exploded) {
      bomb.exploded = true;
      explosions.push({x: bomb.x, y: by - 2, radius: 6, life: 16});

      // Check tanks hit
      tanks.forEach(t => {
        const dist = Math.hypot(t.x - bomb.x, t.y - bomb.y);
        if (dist < 38 && t.alive) {
          t.alive = false;
          plane.kills++;
          spawnPowerupsFromTank(t.x, t.y - 10);
        }
      });

      // Check tower hits with HP decrement
      towers.forEach(t => {
        const dist = Math.hypot(t.x - bomb.x, t.y - bomb.y);
        if (dist < 48 && t.alive) {
          t.hp--;
          if (t.hp <= 0) {
            t.alive = false;
            plane.kills += 2;
            explosions.push({
              x: t.x + TOWER_WIDTH/2,
              y: t.y + TOWER_HEIGHT/2,
              radius: 12,
              life: 20
            });
          } else {
            explosions.push({
              x: t.x + TOWER_WIDTH/2,
              y: t.y + TOWER_HEIGHT/2,
              radius: 8,
              life: 10
            });
          }
        }
      });
    }
  }
  bombs = bombs.filter(b => b.y < canvas.height && !b.exploded);

  // Rest of update logic: explosions, tanks, fuel cans, hearts, towers shooting, bullets, HUD etc...
}

// Drawing functions and game loop remain unchanged...

function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}
