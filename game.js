// ===== Constants for Scaling =====
const BLOCK_SIZE = 20;
const PLAYER_WIDTH = BLOCK_SIZE;
const PLAYER_HEIGHT = BLOCK_SIZE * 2;
const ANIMAL_SIZE = Math.round(BLOCK_SIZE * 1.2);

// ===== Global Variables =====
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const totalRows = 100;
const gravity = 0.3;
const moveSpeed = 2;
const jumpStrength = 8;
let gameMode;
let biome; // "forest", "desert", "tundra", or random
let world = {};
let selectedBlock = null;
let cutTrees = [];
const dayDuration = 300000;
let gameStartTime = Date.now();
const textureCache = {};
let gameOverFlag = false;
let keys = {};
let paused = false;
let lastAnimalSpawnTime = Date.now();
let lastRegenTime = Date.now();
let wasOnGround = true;
let minYInAir;
let animals = [];
let mobs = [];

// ===== Load Images =====
const animalImages = {
  cow: new Image(),
  pig: new Image(),
  chicken: new Image(),
  polarbear: new Image()
};
animalImages.cow.src = "assets/cow.png";
animalImages.pig.src = "assets/pig.png";
animalImages.chicken.src = "assets/chicken.png";
animalImages.polarbear.src = "assets/polarbear.png";

const playerImage = new Image();
playerImage.src = "assets/noah.png";

// ===== Noise Function =====
function fract(val) { return val - Math.floor(val); }
function caveNoise(col, row) {
  function hash2D(x, y) {
    const n = x * 12.9898 + y * 78.233;
    return fract(Math.sin(n) * 43758.5453);
  }
  let x0 = Math.floor(col), x1 = x0 + 1;
  let y0 = Math.floor(row), y1 = y0 + 1;
  let sx = col - x0, sy = row - y0;
  let n0 = hash2D(x0, y0);
  let n1 = hash2D(x1, y0);
  let ix0 = n0 + (n1 - n0) * sx;
  n0 = hash2D(x0, y1);
  n1 = hash2D(x1, y1);
  let ix1 = n0 + (n1 - n0) * sx;
  return ix0 + (ix1 - ix0) * sy;
}
const caveThreshold = 0.3;

// ===== World Generation with Three Biomes =====
function generateColumn(col) {
  if (world[col] !== undefined) return;
  let colArray = [];
  const baseLevel = 20;
  const amplitude = 15;
  let noiseVal = caveNoise(col * 0.1, 0);
  let sineVal = Math.sin(col * 0.05) * 5;
  let ground = Math.floor(baseLevel + amplitude * (noiseVal - 0.5) + sineVal);
  ground = Math.max(5, Math.min(ground, totalRows - 10));
  
  let surfaceBlock, subSurfaceBlock;
  switch (biome) {
    case "forest":
      surfaceBlock = ground > 25 ? "rock" : "grass";
      subSurfaceBlock = surfaceBlock === "grass" ? "dirt" : "stone";
      break;
    case "desert":
      surfaceBlock = "sand";
      subSurfaceBlock = "sandstone";
      break;
    case "tundra":
      surfaceBlock = ground > 25 ? "ice" : "snow";
      subSurfaceBlock = "stone";
      break;
  }
  
  for (let r = 0; r < totalRows; r++) {
    if (r < ground) colArray[r] = "air";
    else if (r === ground) colArray[r] = surfaceBlock;
    else if (r <= ground + 3) colArray[r] = subSurfaceBlock;
    else colArray[r] = "stone";
  }
  
  for (let r = ground + 1; r < totalRows - 3; r++) {
    if (caveNoise(col * 0.2, r * 0.2) < caveThreshold) colArray[r] = "air";
  }
  
  for (let r = ground + 4; r < 70; r++) {
    if (colArray[r] === "stone" && caveNoise(col * 0.2 + 1000, r * 0.2) < 0.1) colArray[r] = "coal ore";
    else if (colArray[r] === "stone" && Math.random() < 0.005) colArray[r] = "mossy stone";
  }
  for (let r = 40; r < 70; r++) {
    if (colArray[r] === "stone" && caveNoise(col * 0.15 + 2000, r * 0.15) < 0.05) colArray[r] = "iron ore";
  }
  for (let r = 60; r < 90; r++) {
    if (colArray[r] === "stone" && caveNoise(col * 0.1 + 3000, r * 0.1) < 0.03) colArray[r] = "gold ore";
  }
  for (let r = 80; r < 95; r++) {
    if (colArray[r] === "stone" && caveNoise(col * 0.05 + 4000, r * 0.05) < 0.02) colArray[r] = "diamond ore";
  }
  
  if (surfaceBlock === "grass" && Math.random() < (world[col - 1] && world[col - 1][ground - 1] === "wood" ? 0.6 : 0.1)) {
    colArray[ground - 1] = "wood";
    colArray[ground - 2] = "wood";
    if (ground - 3 >= 0) colArray[ground - 3] = "leaves";
  } else if (surfaceBlock === "sand" && Math.random() < 0.05) {
    colArray[ground - 1] = "wood"; // Sparse desert trees
  } else if (surfaceBlock === "snow" && Math.random() < 0.08) {
    colArray[ground - 1] = "spruce wood";
    colArray[ground - 2] = "spruce wood";
    if (ground - 3 >= 0) colArray[ground - 3] = "spruce leaves";
  }
  
  colArray.modified = false;
  world[col] = colArray;
}

function ensureWorldForVisibleRange() {
  let camX = camera.x;
  let startCol = Math.floor(camX / BLOCK_SIZE) - 5;
  let endCol = Math.floor((camX + canvas.width) / BLOCK_SIZE) + 5;
  for (let col = startCol; col <= endCol; col++) generateColumn(col);
  for (let col in world) {
    let c = parseInt(col);
    if (!world[col].modified && (c < startCol - 5 || c > endCol + 5)) delete world[col];
  }
}

// ===== Player Setup =====
const player = {
  width: PLAYER_WIDTH,
  height: PLAYER_HEIGHT,
  vx: 0,
  vy: 0,
  onGround: false,
  x: 0,
  y: 0,
  health: 100,
  maxHealth: 100,
  invuln: 0
};
function getGroundLevel(col) {
  generateColumn(col);
  const colArray = world[col];
  for (let r = 0; r < totalRows; r++) if (colArray[r] !== "air") return r;
  return totalRows;
}

// ===== Inventory, Tools & Crafting =====
let currentTool = "hand";
const tools = ["hand", "wooden pickaxe", "stone pickaxe", "iron pickaxe", "diamond pickaxe"];
const requiredTools = {
  "stone": "wooden pickaxe",
  "coal ore": "stone pickaxe",
  "iron ore": "stone pickaxe",
  "gold ore": "iron pickaxe",
  "diamond ore": "iron pickaxe",
  "sandstone": "wooden pickaxe",
  "ice": "wooden pickaxe"
};
const blockDrops = {
  "stone": "cobblestone",
  "coal ore": "coal",
  "iron ore": "iron ingot",
  "gold ore": "gold ingot",
  "diamond ore": "diamond",
  "wood": "wood",
  "spruce wood": "spruce wood",
  "leaves": "leaves",
  "spruce leaves": "spruce leaves",
  "brick": "brick",
  "fence": "fence",
  "glass": "glass",
  "mossy stone": "mossy stone",
  "cobblestone": "cobblestone",
  "flower": "flower",
  "crafting table": "crafting table",
  "sand": "sand",
  "sandstone": "sandstone",
  "snow": "snow",
  "ice": "ice"
};
const toolTiers = {
  "hand": 0,
  "wooden pickaxe": 1,
  "stone pickaxe": 2,
  "iron pickaxe": 3,
  "diamond pickaxe": 4
};
const basicRecipes = { "crafting table": { "wood": 4 } };
const tableRecipes = {
  "wooden pickaxe": { "wood": 5 },
  "stone pickaxe": { "wood": 5, "cobblestone": 3 },
  "iron pickaxe": { "wood": 5, "iron ingot": 3 },
  "diamond pickaxe": { "wood": 5, "diamond": 3 },
  "brick": { "wood": 2, "stone": 2 },
  "fence": { "wood": 4 },
  "glass": { "sand": 3 },
  "mossy stone": { "stone": 4, "coal": 1 }
};
let inventory = {
  grass: 0, dirt: 0, stone: 0, wood: 0, "spruce wood": 0, leaves: 0, "spruce leaves": 0, cobblestone: 0,
  flower: 0, coal: 0, "iron ingot": 0, "gold ingot": 0, diamond: 0,
  brick: 0, fence: 0, glass: 0, "mossy stone": 0,
  "crafting table": 0,
  meat: 0, sand: 0, sandstone: 0, snow: 0, ice: 0
};
const placeableBlocks = ["grass", "dirt", "stone", "wood", "spruce wood", "leaves", "spruce leaves", "cobblestone", "flower", "brick", "glass", "fence", "mossy stone", "crafting table", "sand", "sandstone", "snow", "ice"];

function updateInventoryUI() {
  const invDiv = document.getElementById("inventory");
  const toolDisplay = tools.map(tool => {
    if (tool === "hand") return `<span class="${currentTool === 'hand' ? 'selected' : ''}" onclick="equipTool('hand')">hand</span>`;
    const count = inventory[tool] || 0;
    return count > 0 ? `<span class="${currentTool === tool ? 'selected' : ''}" onclick="equipTool('${tool}')">${tool}: ${count}</span>` : '';
  }).filter(str => str).join(" | ");
  const placeable = placeableBlocks.map(type => {
    const count = inventory[type] || 0;
    const selected = type === selectedBlock ? "selected" : "";
    return `<span class="${selected}" onclick="selectBlock('${type}')">${type}: ${count}</span>`;
  }).join(" | ");
  const craftingItems = Object.entries(inventory)
    .filter(([type]) => !placeableBlocks.includes(type) && !tools.includes(type) && inventory[type] > 0)
    .map(([type, count]) => `${type}: ${count}`)
    .join(" | ");
  invDiv.innerHTML = `Inventory:<br>Tools: ${toolDisplay}<br>Placeable: ${placeable}<br>Other: ${craftingItems || 'None'}`;
  document.getElementById("toolStatus").innerHTML = `Tool: ${currentTool} | Health: ${player.health} | Biome: ${biome}`;
}

function selectBlock(type) {
  if (placeableBlocks.includes(type) && inventory[type] > 0) {
    selectedBlock = type;
    updateInventoryUI();
  }
}

function equipTool(tool) {
  if (tool === "hand" || inventory[tool] > 0) {
    currentTool = tool;
    updateInventoryUI();
  }
}

// ===== Crafting UI Functions =====
function openCraftingTableUI() {
  paused = true;
  const craftDiv = document.getElementById("craftingMenu");
  let html = `<h2>Crafting Table</h2><div>Select a recipe:</div>`;
  for (let recipe in tableRecipes) {
    const reqs = tableRecipes[recipe];
    const canCraft = Object.entries(reqs).every(([item, needed]) => (inventory[item] || 0) >= needed);
    html += `<div class="recipe ${canCraft ? 'canCraft' : ''}" onclick="craftFromTable('${recipe}')">${recipe} (${Object.entries(reqs).map(([item, num]) => `${item}: ${num}`).join(", ")})</div>`;
  }
  html += `<h3>Basic Recipes</h3>`;
  for (let recipe in basicRecipes) {
    const reqs = basicRecipes[recipe];
    const canCraft = Object.entries(reqs).every(([item, needed]) => (inventory[item] || 0) >= needed);
    html += `<div class="recipe ${canCraft ? 'canCraft' : ''}" onclick="craftFromTable('${recipe}', true)">${recipe} (${Object.entries(reqs).map(([item, num]) => `${item}: ${num}`).join(", ")})</div>`;
  }
  html += `<button onclick="closeCraftingTableUI()">Close</button>`;
  craftDiv.innerHTML = html;
  craftDiv.style.display = "block";
}

function openBasicCraftingUI() {
  paused = true;
  const craftDiv = document.getElementById("craftingMenu");
  let html = `<h2>Basic Crafting</h2><div>Select a basic recipe:</div>`;
  for (let recipe in basicRecipes) {
    const reqs = basicRecipes[recipe];
    const canCraft = Object.entries(reqs).every(([item, needed]) => (inventory[item] || 0) >= needed);
    html += `<div class="recipe ${canCraft ? 'canCraft' : ''}" onclick="craftFromTable('${recipe}', true)">${recipe} (${Object.entries(reqs).map(([item, num]) => `${item}: ${num}`).join(", ")})</div>`;
  }
  html += `<button onclick="closeCraftingTableUI()">Close</button>`;
  craftDiv.innerHTML = html;
  craftDiv.style.display = "block";
}

function closeCraftingTableUI() {
  document.getElementById("craftingMenu").style.display = "none";
  paused = false;
}

function craftFromTable(recipe, isBasic) {
  let reqs = isBasic ? basicRecipes[recipe] : tableRecipes[recipe];
  if (!reqs) return;
  const canCraft = Object.entries(reqs).every(([item, needed]) => (inventory[item] || 0) >= needed);
  if (!canCraft) {
    showMessage(`Not enough materials for ${recipe}!`);
    return;
  }
  for (let [item, needed] of Object.entries(reqs)) inventory[item] -= needed;
  inventory[recipe] = (inventory[recipe] || 0) + 1;
  showMessage(`Crafted ${recipe}!`);
  updateInventoryUI();
}

document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "t" && !paused) {
    if (hasCraftingTableInWorld() || inventory["crafting table"] > 0) openCraftingTableUI();
    else openBasicCraftingUI();
  }
});

function hasCraftingTableInWorld() {
  for (let c in world) for (let r = 0; r < totalRows; r++) if (world[c][r] === "crafting table") return true;
  return false;
}

// ===== Camera =====
const camera = {
  x: player.x - canvas.width / 2,
  y: player.y - canvas.height / 2
};

// ===== Collision Logic for Player =====
function checkIfOnGround() {
  const footRow = Math.floor((player.y + player.height + 1) / BLOCK_SIZE);
  const pColStart = Math.floor(player.x / BLOCK_SIZE);
  const pColEnd = Math.floor((player.x + player.width - 1) / BLOCK_SIZE);
  let onGround = false;
  for (let col = pColStart; col <= pColEnd; col++) {
    generateColumn(col);
    if (world[col][footRow] !== "air") {
      onGround = true;
      break;
    }
  }
  player.onGround = onGround;
}

function resolveCollisions() {
  let bbox = { left: player.x, right: player.x + player.width, top: player.y, bottom: player.y + player.height };
  let startCol = Math.floor(bbox.left / BLOCK_SIZE);
  let endCol = Math.floor((bbox.right - 1) / BLOCK_SIZE);
  let startRow = Math.floor(bbox.top / BLOCK_SIZE);
  let endRow = Math.floor((bbox.bottom - 1) / BLOCK_SIZE);
  for (let col = startCol; col <= endCol; col++) {
    generateColumn(col);
    for (let row = startRow; row <= endRow; row++) {
      let block = world[col][row];
      if (block === "air") continue;
      let cellLeft = col * BLOCK_SIZE;
      let cellRight = cellLeft + BLOCK_SIZE;
      let cellTop = row * BLOCK_SIZE;
      let cellBottom = cellTop + BLOCK_SIZE;
      if (bbox.right > cellLeft && bbox.left < cellRight && bbox.bottom > cellTop && bbox.top < cellBottom) {
        let overlapX = Math.min(bbox.right - cellLeft, cellRight - bbox.left);
        let overlapY = Math.min(bbox.bottom - cellTop, cellBottom - bbox.top);
        if (overlapX < overlapY) {
          if (player.x + player.width / 2 < cellLeft + BLOCK_SIZE / 2) player.x -= overlapX;
          else player.x += overlapX;
          player.vx = 0;
          bbox.left = player.x;
          bbox.right = player.x + player.width;
        } else {
          if (player.y + player.height / 2 < cellTop + BLOCK_SIZE / 2) {
            player.y = cellTop - player.height;
            player.vy = 0;
            player.onGround = true;
          } else {
            player.y = cellBottom;
            player.vy = 0;
          }
          bbox.top = player.y;
          bbox.bottom = player.y + player.height;
        }
      }
    }
  }
}

function snapToGround() {
  const pColStart = Math.floor(player.x / BLOCK_SIZE);
  const pColEnd = Math.floor((player.x + player.width - 1) / BLOCK_SIZE);
  for (let col = pColStart; col <= pColEnd; col++) {
    generateColumn(col);
    let cellTop = getGroundLevel(col) * BLOCK_SIZE;
    if ((cellTop - (player.y + player.height)) >= 0 && (cellTop - (player.y + player.height)) < 5) {
      player.y = cellTop - player.height;
      player.vy = 0;
      player.onGround = true;
    }
  }
}

// ===== Animal Collision Resolution =====
function resolveAnimalBlockCollision(animal) {
  let bbox = { left: animal.x, right: animal.x + ANIMAL_SIZE, top: animal.y, bottom: animal.y + ANIMAL_SIZE };
  let startCol = Math.floor(bbox.left / BLOCK_SIZE);
  let endCol = Math.floor((bbox.right - 1) / BLOCK_SIZE);
  let startRow = Math.floor(bbox.top / BLOCK_SIZE);
  let endRow = Math.floor((bbox.bottom - 1) / BLOCK_SIZE);
  for (let col = startCol; col <= endCol; col++) {
    generateColumn(col);
    for (let row = startRow; row <= endRow; row++) {
      let block = world[col][row];
      if (block !== "air") {
        let cellLeft = col * BLOCK_SIZE;
        let cellRight = cellLeft + BLOCK_SIZE;
        let cellTop = row * BLOCK_SIZE;
        let cellBottom = cellTop + BLOCK_SIZE;
        let overlapX = Math.min(bbox.right - cellLeft, cellRight - bbox.left);
        let overlapY = Math.min(bbox.bottom - cellTop, cellBottom - bbox.top);
        if (overlapX < overlapY) {
          if (animal.x + ANIMAL_SIZE / 2 < cellLeft + BLOCK_SIZE / 2) animal.x -= overlapX;
          else animal.x += overlapX;
        } else {
          if (animal.y + ANIMAL_SIZE / 2 < cellTop + BLOCK_SIZE / 2) animal.y -= overlapY;
          else animal.y += overlapY;
        }
        bbox.left = animal.x;
        bbox.right = animal.x + ANIMAL_SIZE;
        bbox.top = animal.y;
        bbox.bottom = animal.y + ANIMAL_SIZE;
      }
    }
  }
}

// ===== Animal System =====
function spawnAnimals(num) {
  const types = biome === "tundra" ? ["polarbear", "chicken"] : ["cow", "pig", "chicken"];
  for (let i = 0; i < num; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    let x = player.x + (Math.random() * 400 - 200);
    let col = Math.floor(x / BLOCK_SIZE);
    generateColumn(col);
    let groundRow = getGroundLevel(col);
    let y = groundRow * BLOCK_SIZE - ANIMAL_SIZE;
    let vx = (Math.random() < 0.5 ? -1 : 1) * Math.random();
    if (biome === "desert" && Math.random() < 0.7) continue; // Rarer animals in desert
    if (biome === "tundra" && Math.random() < 0.5) continue; // Slightly rarer in tundra
    animals.push({ type, x, y, vx });
  }
}

function updateAnimals() {
  for (let animal of animals) {
    animal.x += animal.vx;
    if (Math.random() < 0.01) animal.vx = -animal.vx;
    resolveAnimalBlockCollision(animal);
    let col = Math.floor(animal.x / BLOCK_SIZE);
    generateColumn(col);
    let groundRow = getGroundLevel(col);
    animal.y = groundRow * BLOCK_SIZE - ANIMAL_SIZE;
  }
}

function drawAnimal(animal) {
  const ax = animal.x - camera.x;
  const ay = animal.y - camera.y;
  let img = animalImages[animal.type];
  if (img.complete) ctx.drawImage(img, ax, ay, ANIMAL_SIZE, ANIMAL_SIZE);
  else {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(ax, ay, ANIMAL_SIZE, ANIMAL_SIZE);
  }
}

// ===== Hostile Mob System =====
const maxMobs = 5;
function spawnMobs() {
  if (getLightingFactor() < 0.3 && mobs.length < maxMobs) {
    let offset = (Math.random() * 600 + 200) * (Math.random() < 0.5 ? -1 : 1);
    let x = player.x + offset;
    let col = Math.floor(x / BLOCK_SIZE);
    generateColumn(col);
    let groundRow = getGroundLevel(col);
    let y = groundRow * BLOCK_SIZE - ANIMAL_SIZE;
    let vx = (player.x > x ? 1 : -1) * (0.5 + Math.random());
    mobs.push({ x, y, vx, damage: 10 });
  }
}

function updateMobs() {
  if (getLightingFactor() >= 0.5) {
    mobs = [];
    return;
  }
  if (Math.random() < 0.01) spawnMobs();
  for (let mob of mobs) {
    mob.vx = mob.x < player.x ? Math.abs(mob.vx) || 0.5 : -Math.abs(mob.vx) || -0.5;
    mob.x += mob.vx;
    let col = Math.floor(mob.x / BLOCK_SIZE);
    generateColumn(col);
    let groundRow = getGroundLevel(col);
    mob.y = groundRow * BLOCK_SIZE - ANIMAL_SIZE;
  }
}

function drawMob(mob) {
  const mx = mob.x - camera.x;
  const my = mob.y - camera.y;
  const lightingFactor = getLightingFactor();
  ctx.fillStyle = applyLighting("#AA0000", lightingFactor);
  ctx.fillRect(mx, my, ANIMAL_SIZE, ANIMAL_SIZE);
  ctx.fillStyle = applyLighting("#000000", lightingFactor);
  ctx.fillRect(mx + 4, my + 4, 3, 3);
  ctx.fillRect(mx + ANIMAL_SIZE - 7, my + 4, 3, 3);
}

// ===== Main Interaction (Click Handler) =====
canvas.addEventListener("click", (e) => {
  if (paused) return;
  const rect = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left + camera.x;
  const clickY = e.clientY - rect.top + camera.y;
  
  for (let i = 0; i < mobs.length; i++) {
    let mob = mobs[i];
    if (clickX >= mob.x && clickX < mob.x + ANIMAL_SIZE && clickY >= mob.y && clickY < mob.y + ANIMAL_SIZE) {
      mobs.splice(i, 1);
      inventory.meat = (inventory.meat || 0) + 1;
      showMessage("Mob defeated! You got some meat.");
      updateInventoryUI();
      return;
    }
  }
  for (let i = 0; i < animals.length; i++) {
    let animal = animals[i];
    if (clickX >= animal.x && clickX < animal.x + ANIMAL_SIZE && clickY >= animal.y && clickY < animal.y + ANIMAL_SIZE) {
      animals.splice(i, 1);
      inventory.meat = (inventory.meat || 0) + 1;
      showMessage("Animal slain! You got some meat.");
      updateInventoryUI();
      return;
    }
  }
  
  const col = Math.floor(clickX / BLOCK_SIZE);
  const row = Math.floor(clickY / BLOCK_SIZE);
  generateColumn(col);
  const blockType = world[col][row];
  
  if (blockType === "crafting table") {
    openCraftingTableUI();
    return;
  }
  
  if (blockType === "air" && selectedBlock && inventory[selectedBlock] > 0) {
    world[col][row] = selectedBlock;
    world[col].modified = true;
    inventory[selectedBlock]--;
    updateInventoryUI();
    return;
  }
  if (blockType === "air") return;
  
  const requiredTool = requiredTools[blockType] || "hand";
  if (toolTiers[currentTool] < toolTiers[requiredTool]) {
    showMessage(`Requires ${requiredTool} to break ${blockType}!`);
    return;
  }
  const breakDistance = currentTool === "hand" ? BLOCK_SIZE * 1.5 : BLOCK_SIZE * 2.5;
  const blockCenterX = col * BLOCK_SIZE + BLOCK_SIZE / 2;
  const blockCenterY = row * BLOCK_SIZE + BLOCK_SIZE / 2;
  const playerCenterX = player.x + player.width / 2;
  const playerCenterY = player.y + player.height / 2;
  if (Math.abs(blockCenterX - playerCenterX) <= breakDistance && Math.abs(blockCenterY - playerCenterY) <= breakDistance) {
    if (blockType === "wood" || blockType === "spruce wood" || blockType === "leaves" || blockType === "spruce leaves") {
      const groundRow = getGroundLevel(col);
      if (world[col][groundRow] === "grass" || world[col][groundRow] === "snow") cutTrees.push({ col, row: groundRow, timestamp: Date.now() + 60000 });
    }
    world[col][row] = "air";
    world[col].modified = true;
    const drop = blockDrops[blockType] || blockType;
    inventory[drop] = (inventory[drop] || 0) + 1;
    updateInventoryUI();
  }
});

// ===== Day-Night Cycle =====
function getTimeOfDay() {
  const elapsed = Date.now() - gameStartTime;
  return (elapsed % dayDuration) / dayDuration;
}

function getLightingFactor() {
  const cycleProgress = getTimeOfDay();
  return (Math.sin(cycleProgress * Math.PI * 2) + 1) / 2;
}

function drawSunAndMoon(lightingFactor) {
  if (lightingFactor > 0.5) {
    ctx.fillStyle = "#FFD700";
    ctx.beginPath();
    ctx.arc(canvas.width - 50, 50, 30, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "#F0E68C";
    ctx.beginPath();
    ctx.arc(50, 50, 25, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ===== Texture Generation & Lighting =====
function createTexture(type) {
  if (textureCache[type]) return textureCache[type];
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = BLOCK_SIZE;
  tempCanvas.height = BLOCK_SIZE;
  const tCtx = tempCanvas.getContext("2d");
  switch (type) {
    case "grass":
      tCtx.fillStyle = "#006600"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#00aa00";
      for (let i = 0; i < 20; i++) {
        let x = Math.random() * BLOCK_SIZE, y = Math.random() * BLOCK_SIZE;
        tCtx.beginPath(); tCtx.moveTo(x, y); tCtx.lineTo(x, y - Math.random() * 5); tCtx.stroke();
      }
      break;
    case "dirt":
      tCtx.fillStyle = "#8B4513"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#5C3317";
      for (let i = 0; i < 10; i++) tCtx.fillRect(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 2, 2);
      break;
    case "stone":
      tCtx.fillStyle = "#808080"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#505050";
      for (let i = 0; i < 8; i++) tCtx.fillRect(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 4, 4);
      break;
    case "cobblestone":
      tCtx.fillStyle = "#505050"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#303030";
      for (let i = 0; i < 8; i++) tCtx.fillRect(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 4, 4);
      break;
    case "wood":
      tCtx.fillStyle = "#8B4513"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.strokeStyle = "#5C4033";
      for (let i = 2; i < BLOCK_SIZE; i += 4) { tCtx.beginPath(); tCtx.arc(BLOCK_SIZE / 2, BLOCK_SIZE / 2, i, 0, Math.PI * 2); tCtx.stroke(); }
      break;
    case "spruce wood":
      tCtx.fillStyle = "#5C4033"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.strokeStyle = "#3C2F2F";
      for (let i = 2; i < BLOCK_SIZE; i += 4) { tCtx.beginPath(); tCtx.arc(BLOCK_SIZE / 2, BLOCK_SIZE / 2, i, 0, Math.PI * 2); tCtx.stroke(); }
      break;
    case "leaves":
      tCtx.fillStyle = "#006400"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#228B22";
      for (let i = 0; i < 15; i++) { tCtx.beginPath(); tCtx.arc(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 2, 0, Math.PI * 2); tCtx.fill(); }
      break;
    case "spruce leaves":
      tCtx.fillStyle = "#2F4F4F"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#4682B4";
      for (let i = 0; i < 15; i++) { tCtx.beginPath(); tCtx.arc(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 2, 0, Math.PI * 2); tCtx.fill(); }
      break;
    case "coal ore":
      tCtx.fillStyle = "#808080"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#333";
      for (let i = 0; i < 10; i++) tCtx.fillRect(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 2, 2);
      break;
    case "iron ore":
      tCtx.fillStyle = "#808080"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#D87F33";
      for (let i = 0; i < 10; i++) tCtx.fillRect(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 2, 2);
      break;
    case "gold ore":
      tCtx.fillStyle = "#808080"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#FFD700";
      for (let i = 0; i < 10; i++) tCtx.fillRect(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 2, 2);
      break;
    case "diamond ore":
      tCtx.fillStyle = "#808080"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#00FFFF";
      for (let i = 0; i < 10; i++) tCtx.fillRect(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 2, 2);
      break;
    case "flower":
      tCtx.fillStyle = "#FF69B4"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#FFD700"; tCtx.beginPath(); tCtx.arc(BLOCK_SIZE / 2, BLOCK_SIZE / 2, 3, 0, Math.PI * 2); tCtx.fill();
      tCtx.fillStyle = "#FF69B4";
      for (let i = 0; i < 4; i++) { tCtx.beginPath(); tCtx.arc(BLOCK_SIZE / 2 + Math.cos(i * Math.PI / 2) * 5, BLOCK_SIZE / 2 + Math.sin(i * Math.PI / 2) * 5, 2, 0, Math.PI * 2); tCtx.fill(); }
      break;
    case "brick":
      tCtx.fillStyle = "#B22222"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.strokeStyle = "#8B0000";
      for (let i = 2; i < BLOCK_SIZE; i += 4) { tCtx.beginPath(); tCtx.moveTo(0, i); tCtx.lineTo(BLOCK_SIZE, i); tCtx.stroke(); }
      break;
    case "fence":
      tCtx.fillStyle = "#8B4513"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.strokeStyle = "#5C4033";
      for (let i = 3; i < BLOCK_SIZE; i += 6) { tCtx.beginPath(); tCtx.moveTo(i, 0); tCtx.lineTo(i, BLOCK_SIZE); tCtx.stroke(); }
      break;
    case "glass":
      tCtx.fillStyle = "rgba(200,200,255,0.5)"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.strokeStyle = "rgba(200,200,255,0.8)"; tCtx.strokeRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      break;
    case "mossy stone":
      tCtx.fillStyle = "#808080"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#228B22";
      for (let i = 0; i < 5; i++) { tCtx.beginPath(); tCtx.arc(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 2, 0, Math.PI * 2); tCtx.fill(); }
      break;
    case "rock":
      tCtx.fillStyle = "#666666"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#555555";
      for (let i = 0; i < 8; i++) tCtx.fillRect(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 4, 4);
      break;
    case "crafting table":
      tCtx.fillStyle = "#8B4513"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.strokeStyle = "#FFD700"; tCtx.strokeRect(2, 2, BLOCK_SIZE - 4, BLOCK_SIZE - 4);
      tCtx.fillStyle = "#FFFFFF"; tCtx.font = "10px monospace"; tCtx.fillText("Craft", 2, BLOCK_SIZE - 2);
      break;
    case "sand":
      tCtx.fillStyle = "#F4A460"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#DEB887";
      for (let i = 0; i < 10; i++) tCtx.fillRect(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 2, 2);
      break;
    case "sandstone":
      tCtx.fillStyle = "#D2B48C"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.strokeStyle = "#F4A460";
      for (let i = 2; i < BLOCK_SIZE; i += 4) { tCtx.beginPath(); tCtx.moveTo(0, i); tCtx.lineTo(BLOCK_SIZE, i); tCtx.stroke(); }
      break;
    case "snow":
      tCtx.fillStyle = "#F0F8FF"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.fillStyle = "#FFFFFF";
      for (let i = 0; i < 10; i++) tCtx.fillRect(Math.random() * BLOCK_SIZE, Math.random() * BLOCK_SIZE, 2, 2);
      break;
    case "ice":
      tCtx.fillStyle = "#ADD8E6"; tCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      tCtx.strokeStyle = "#87CEEB";
      tCtx.strokeRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
      break;
  }
  textureCache[type] = tCtx.createPattern(tempCanvas, "repeat");
  return textureCache[type];
}

function applyLighting(color, factor) {
  if (typeof color === "string") {
    let r = parseInt(color.slice(1, 3), 16);
    let g = parseInt(color.slice(3, 5), 16);
    let b = parseInt(color.slice(5, 7), 16);
    r = Math.floor(r * factor);
    g = Math.floor(g * factor);
    b = Math.floor(b * factor);
    return `rgb(${r},${g},${b})`;
  }
  return color;
}

// ===== Render Function =====
function render() {
  const lightingFactor = getLightingFactor();
  const dayColor = [135, 206, 235];
  const nightColor = [0, 0, 139];
  const r = Math.floor(dayColor[0] + (nightColor[0] - dayColor[0]) * (1 - lightingFactor));
  const g = Math.floor(dayColor[1] + (nightColor[1] - dayColor[1]) * (1 - lightingFactor));
  const b = Math.floor(dayColor[2] + (nightColor[2] - dayColor[2]) * (1 - lightingFactor));
  canvas.style.background = `rgb(${r},${g},${b})`;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawSunAndMoon(lightingFactor);
  let startCol = Math.floor(camera.x / BLOCK_SIZE);
  let endCol = Math.floor((camera.x + canvas.width) / BLOCK_SIZE);
  for (let col = startCol; col <= endCol; col++) {
    generateColumn(col);
    let column = world[col];
    for (let row = 0; row < totalRows; row++) {
      const block = column[row];
      if (block === "air") continue;
      const xPos = col * BLOCK_SIZE - camera.x;
      const yPos = row * BLOCK_SIZE - camera.y;
      ctx.fillStyle = createTexture(block);
      ctx.fillRect(xPos, yPos, BLOCK_SIZE, BLOCK_SIZE);
      ctx.fillStyle = `rgba(0,0,0,${0.3 * (1 - lightingFactor)})`;
      ctx.fillRect(xPos, yPos, BLOCK_SIZE / 2, BLOCK_SIZE / 2);
      ctx.strokeStyle = applyLighting("#333", lightingFactor);
      ctx.strokeRect(xPos, yPos, BLOCK_SIZE, BLOCK_SIZE);
    }
  }
  animals.forEach(drawAnimal);
  mobs.forEach(drawMob);
  const px = player.x - camera.x;
  const py = player.y - camera.y;
  if (playerImage.complete) ctx.drawImage(playerImage, px, py, player.width, player.height);
  else {
    ctx.fillStyle = applyLighting("#FFD700", lightingFactor);
    ctx.fillRect(px, py, player.width, player.height);
  }
}

// ===== Update Loop =====
function update() {
  if (paused) return;
  
  if (keys["a"]) player.vx = -moveSpeed;
  else if (keys["d"]) player.vx = moveSpeed;
  else player.vx = 0;
  
  if (keys["w"] && player.onGround) {
    player.vy = -jumpStrength;
    player.onGround = false;
  }
  
  player.vy += gravity;
  player.x += player.vx;
  player.y += player.vy;
  
  let iterations = 0, prevY;
  do {
    prevY = player.y;
    resolveCollisions();
    iterations++;
  } while (Math.abs(player.y - prevY) > 0.001 && iterations < 10);
  
  snapToGround();
  checkIfOnGround();
  
  if (wasOnGround && !player.onGround) minYInAir = player.y;
  else if (!player.onGround) minYInAir = Math.min(minYInAir, player.y);
  if (!wasOnGround && player.onGround) {
    const fallDistance = (player.y - minYInAir) / BLOCK_SIZE;
    if (fallDistance > 8) {
      const damage = Math.floor((fallDistance - 8) * 5);
      player.health -= damage;
      showMessage(`Fell from height, took ${damage} damage. Health: ${player.health}`);
      updateInventoryUI();
    }
  }
  wasOnGround = player.onGround;
  
  camera.x = player.x - canvas.width / 2;
  camera.y = player.y - canvas.height / 2;
  
  ensureWorldForVisibleRange();
  cutTrees.forEach(tree => regrowTree(tree.col, tree.row, tree.timestamp));
  updateAnimals();
  updateMobs();
  if (player.invuln > 0) player.invuln--;
  
  for (let mob of mobs) {
    if (player.x < mob.x + ANIMAL_SIZE && player.x + player.width > mob.x &&
        player.y < mob.y + ANIMAL_SIZE && player.y + player.height > mob.y) {
      if (player.invuln === 0) {
        player.health -= mob.damage;
        player.invuln = 60;
        showMessage(`Hit by a mob! Health: ${player.health}`);
        updateInventoryUI();
      }
    }
  }
  
  if (animals.length < 20 && Date.now() - lastAnimalSpawnTime > 30000) {
    spawnAnimals(1);
    lastAnimalSpawnTime = Date.now();
  }
  
  if (Date.now() - lastRegenTime > 10000 && player.health < player.maxHealth) {
    player.health += 1;
    lastRegenTime = Date.now();
    updateInventoryUI();
  }
  
  if (player.health <= 0) {
    gameOverFlag = true;
    cancelAnimationFrame(gameLoopId);
    document.getElementById("gameOverScreen").style.display = "flex";
    document.getElementById("restartButton").onclick = resetGame;
  }
}

// ===== Game Loop =====
let gameLoopId;
function gameLoop() {
  if (!paused && !gameOverFlag) update();
  render();
  gameLoopId = requestAnimationFrame(gameLoop);
}

// ===== Save Game Functions =====
function saveGame() {
  const saveData = {
    gameMode,
    biome,
    world: JSON.parse(JSON.stringify(world)),
    player: { ...player },
    inventory: { ...inventory },
    animals: [...animals],
    mobs: [...mobs],
    cutTrees: [...cutTrees],
    gameStartTime,
    lastAnimalSpawnTime,
    lastRegenTime,
    currentTool,
    selectedBlock
  };
  let savedGames = JSON.parse(localStorage.getItem("savedGames")) || [];
  savedGames.unshift({
    data: saveData,
    timestamp: new Date().toLocaleString(),
    name: `${gameMode} - ${biome} - ${saveData.player.health} HP`
  });
  savedGames = savedGames.slice(0, 5); // Keep only the last 5 saves
  localStorage.setItem("savedGames", JSON.stringify(savedGames));
  showMessage("Game saved!");
  updateSavedGamesUI();
}

function loadGame(index) {
  const savedGames = JSON.parse(localStorage.getItem("savedGames")) || [];
  if (index < 0 || index >= savedGames.length) return;
  const save = savedGames[index].data;
  
  gameMode = save.gameMode;
  biome = save.biome;
  world = save.world;
  player.x = save.player.x;
  player.y = save.player.y;
  player.health = save.player.health;
  player.vx = save.player.vx;
  player.vy = save.player.vy;
  player.onGround = save.player.onGround;
  player.invuln = save.player.invuln;
  inventory = save.inventory;
  animals = save.animals;
  mobs = save.mobs;
  cutTrees = save.cutTrees;
  gameStartTime = save.gameStartTime;
  lastAnimalSpawnTime = save.lastAnimalSpawnTime;
  lastRegenTime = save.lastRegenTime;
  currentTool = save.currentTool;
  selectedBlock = save.selectedBlock;
  
  camera.x = player.x - canvas.width / 2;
  camera.y = player.y - canvas.height / 2;
  minYInAir = player.y;
  wasOnGround = true;
  
  document.getElementById("startScreen").style.display = "none";
  document.getElementById("gameCanvas").style.display = "block";
  document.getElementById("inventory").style.display = "block";
  document.getElementById("toolStatus").style.display = "block";
  document.getElementById("message").style.display = "block";
  document.getElementById("craftingMenu").style.display = "none";
  document.getElementById("gameOverScreen").style.display = "none";
  document.getElementById("exitButton").style.display = "block";
  
  updateInventoryUI();
  gameOverFlag = false;
  paused = false;
  gameLoop();
}

function updateSavedGamesUI() {
  const savedGamesDiv = document.getElementById("savedGames");
  const savedGames = JSON.parse(localStorage.getItem("savedGames")) || [];
  savedGamesDiv.innerHTML = savedGames.length ? savedGames.map((game, i) => 
    `<div>${game.name} (${game.timestamp}) <button onclick="loadGame(${i})">Load</button></div>`
  ).join("") : "No saved games.";
}

// ===== Start Game Function =====
function startGame(mode, selectedBiome) {
  gameMode = mode;
  biome = selectedBiome === "random" ? ["forest", "desert", "tundra"][Math.floor(Math.random() * 3)] : selectedBiome;
  
  player.x = (Math.floor(Math.random() * 50) - 25) * BLOCK_SIZE;
  let spawnCol = Math.floor(player.x / BLOCK_SIZE);
  generateColumn(spawnCol);
  let groundRow = getGroundLevel(spawnCol);
  player.y = groundRow * BLOCK_SIZE - player.height;
  minYInAir = player.y;
  
  document.getElementById("startScreen").style.display = "none";
  document.getElementById("gameCanvas").style.display = "block";
  document.getElementById("inventory").style.display = "block";
  document.getElementById("toolStatus").style.display = "block";
  document.getElementById("message").style.display = "block";
  document.getElementById("craftingMenu").style.display = "none";
  document.getElementById("gameOverScreen").style.display = "none";
  document.getElementById("exitButton").style.display = "block";
  
  ensureWorldForVisibleRange();
  spawnAnimals(3);
  updateInventoryUI();
  gameLoop();
}

// ===== Exit to Menu Function =====
function exitToMenu() {
  cancelAnimationFrame(gameLoopId);
  document.getElementById("gameCanvas").style.display = "none";
  document.getElementById("inventory").style.display = "none";
  document.getElementById("toolStatus").style.display = "none";
  document.getElementById("message").style.display = "none";
  document.getElementById("craftingMenu").style.display = "none";
  document.getElementById("gameOverScreen").style.display = "none";
  document.getElementById("exitButton").style.display = "none";
  document.getElementById("startScreen").style.display = "block";
  
  world = {};
  animals = [];
  mobs = [];
  cutTrees = [];
  paused = false;
  gameOverFlag = false;
  if (gameMode === "hardcore") {
    inventory = {
      grass: 0, dirt: 0, stone: 0, wood: 0, "spruce wood": 0, leaves: 0, "spruce leaves": 0, cobblestone: 0,
      flower: 0, coal: 0, "iron ingot": 0, "gold ingot": 0, diamond: 0,
      brick: 0, fence: 0, glass: 0, "mossy stone": 0,
      "crafting table": 0,
      meat: 0, sand: 0, sandstone: 0, snow: 0, ice: 0
    };
    player.health = player.maxHealth;
  }
  selectedBlock = null;
  currentTool = "hand";
  updateSavedGamesUI();
}

// ===== Helper: Tree Regrowth =====
function regrowTree(col, row, timestamp) {
  if (Date.now() >= timestamp) {
    if (biome === "forest" && world[col][row] === "grass") {
      world[col][row - 1] = "wood";
      world[col][row - 2] = "wood";
      if (row - 3 >= 0) world[col][row - 3] = "leaves";
    } else if (biome === "tundra" && world[col][row] === "snow") {
      world[col][row - 1] = "spruce wood";
      world[col][row - 2] = "spruce wood";
      if (row - 3 >= 0) world[col][row - 3] = "spruce leaves";
    }
    cutTrees = cutTrees.filter(tree => tree.col !== col || tree.row !== row);
  }
}

// ===== Helper: Display Messages =====
function showMessage(msg) {
  const messageDiv = document.getElementById("message");
  messageDiv.innerHTML = msg;
  setTimeout(() => messageDiv.innerHTML = "", 3000);
}

// ===== Reset Game Function =====
function resetGame() {
  player.x = (Math.floor(Math.random() * 50) - 25) * BLOCK_SIZE;
  let spawnCol = Math.floor(player.x / BLOCK_SIZE);
  generateColumn(spawnCol);
  let groundRow = getGroundLevel(spawnCol);
  player.y = groundRow * BLOCK_SIZE - player.height;
  player.health = player.maxHealth;
  player.invuln = 0;
  player.vx = 0;
  player.vy = 0;
  player.onGround = false;
  
  world = {};
  ensureWorldForVisibleRange();
  
  if (gameMode === "hardcore") {
    inventory = {
      grass: 0, dirt: 0, stone: 0, wood: 0, "spruce wood": 0, leaves: 0, "spruce leaves": 0, cobblestone: 0,
      flower: 0, coal: 0, "iron ingot": 0, "gold ingot": 0, diamond: 0,
      brick: 0, fence: 0, glass: 0, "mossy stone": 0,
      "crafting table": 0,
      meat: 0, sand: 0, sandstone: 0, snow: 0, ice: 0
    };
  }
  selectedBlock = null;
  currentTool = "hand";
  
  camera.x = player.x - canvas.width / 2;
  camera.y = player.y - canvas.height / 2;
  
  gameOverFlag = false;
  paused = false;
  cutTrees = [];
  animals = [];
  spawnAnimals(3);
  mobs = [];
  gameStartTime = Date.now();
  lastAnimalSpawnTime = Date.now();
  lastRegenTime = Date.now();
  wasOnGround = true;
  minYInAir = player.y;
  
  document.getElementById("gameOverScreen").style.display = "none";
  updateInventoryUI();
  gameLoop();
}

// ===== Event Listeners =====
document.getElementById("exitButton").addEventListener("click", exitToMenu);

document.addEventListener("keydown", (e) => {
  if (!paused) keys[e.key.toLowerCase()] = true;
  if (e.key === "Escape" && !gameOverFlag) exitToMenu();
  if (e.key.toLowerCase() === "s" && !paused && !gameOverFlag) saveGame();
});
document.addEventListener("keyup", (e) => keys[e.key.toLowerCase()] = false);

document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "e" && !paused && inventory.meat > 0) {
    inventory.meat--;
    player.health = Math.min(player.health + 20, player.maxHealth);
    showMessage("Ate meat, restored 20 health.");
    updateInventoryUI();
  }
});

// Initial UI Update
updateInventoryUI();
updateSavedGamesUI();