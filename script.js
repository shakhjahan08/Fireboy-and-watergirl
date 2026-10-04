const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const roomOverlay = document.getElementById('room-overlay');
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');
const hostCodeDisplay = document.getElementById('host-code-display');
const roomCodeVal = document.getElementById('room-code-val');
const joinCodeInput = document.getElementById('join-code-input');
const statusText = document.getElementById('status-text');

const myRoleBadge = document.getElementById('my-role-badge');
const levelDisplay = document.getElementById('level-display');
const levelMenuBtn = document.getElementById('btn-level-menu');
const levelSelectModal = document.getElementById('level-select-modal');
const levelGridContainer = document.getElementById('level-grid-container');

let peer = null, conn = null;
let myRole = 'fire';
let currentLevel = 1, unlockedLevel = 1;

const TOTAL_LEVELS = 40;
const TILE_SIZE = 30;
const COLS = 27, ROWS = 12;

const inputs = { left: false, right: false, jump: false };

function bindTouch(btnId, key) {
    const btn = document.getElementById(btnId);
    const start = (e) => { e.preventDefault(); inputs[key] = true; };
    const end = (e) => { e.preventDefault(); inputs[key] = false; };
    btn.addEventListener('touchstart', start); 
    btn.addEventListener('touchend', end);
    btn.addEventListener('mousedown', start); 
    btn.addEventListener('mouseup', end);
}
bindTouch('btn-left', 'left'); 
bindTouch('btn-right', 'right'); 
bindTouch('btn-jump', 'jump');

// Keyboard controls
window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') inputs.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd') inputs.right = true;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') inputs.jump = true;
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') inputs.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd') inputs.right = false;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') inputs.jump = false;
});

// --- P2P WebRTC NETWORKING ---
btnCreateRoom.addEventListener('click', () => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    peer = new Peer('FW-' + roomCode);

    peer.on('open', () => {
        myRole = 'fire'; 
        setupRoleUI();
        roomCodeVal.textContent = roomCode;
        hostCodeDisplay.style.display = 'block'; 
        statusText.textContent = '';
    });
    peer.on('connection', (c) => { conn = c; initConnection(); });
    peer.on('error', () => { statusText.textContent = 'Room creation error. Try again.'; });
});

btnJoinRoom.addEventListener('click', () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (code.length < 6) { statusText.textContent = 'Enter a valid 6-char room code!'; return; }

    peer = new Peer();
    peer.on('open', () => {
        myRole = 'water'; 
        setupRoleUI();
        conn = peer.connect('FW-' + code);
        initConnection();
    });
    peer.on('error', () => { statusText.textContent = 'Room code not found!'; });
});

function setupRoleUI() {
    myRoleBadge.textContent = myRole.toUpperCase();
    myRoleBadge.className = `role-badge role-${myRole}`;
    const btns = document.querySelectorAll('.btn');
    btns.forEach(b => b.className = `btn ${myRole === 'water' ? 'water-bg' : 'fire-bg'}`);
}

function initConnection() {
    conn.on('open', () => {
        roomOverlay.classList.add('hidden');
        generateLevel(currentLevel);
    });
    conn.on('data', (data) => {
        if (data.type === 'move') {
            remotePlayerPos.x = data.x;
            remotePlayerPos.y = data.y;
            remotePlayerPos.vx = data.vx;
            remotePlayerPos.escaped = data.escaped;
        } else if (data.type === 'level') {
            currentLevel = data.level;
            if (currentLevel > unlockedLevel) unlockedLevel = currentLevel;
            generateLevel(currentLevel);
        }
    });
}

// --- LEVEL SELECTOR ---
levelMenuBtn.addEventListener('click', () => { renderLevelGrid(); levelSelectModal.classList.toggle('hidden'); });

function renderLevelGrid() {
    levelGridContainer.innerHTML = '';
    for (let i = 1; i <= TOTAL_LEVELS; i++) {
        const btn = document.createElement('div');
        btn.className = `level-btn ${i === currentLevel ? 'current' : i <= unlockedLevel ? 'unlocked' : ''}`;
        btn.textContent = i;
        if (i <= unlockedLevel) {
            btn.addEventListener('click', () => {
                currentLevel = i; 
                generateLevel(currentLevel);
                levelSelectModal.classList.add('hidden');
                if (conn) conn.send({ type: 'level', level: currentLevel });
            });
        }
        levelGridContainer.appendChild(btn);
    }
}

// --- PARTICLE & VISUAL EFFECTS ENGINE ---
let particles = [];
function addParticle(x, y, color, speed, size, life) {
    particles.push({
        x, y,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed - 0.5,
        color, size, life, maxLife: life
    });
}

function updateAndDrawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx; p.y += p.vy;
        p.life--;
        let alpha = p.life / p.maxLife;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (p.life <= 0) particles.splice(i, 1);
    }
}

// --- GAME STATE ---
let map = [];
let remotePlayerPos = { x: 0, y: 0, vx: 0, escaped: false };
let animFrame = 0;

class Player {
    constructor(x, y, type) {
        this.x = x; this.y = y;
        this.width = 18; this.height = 24;
        this.type = type;
        this.vx = 0; this.vy = 0;
        this.speed = 3.2; this.jumpStrength = -8.5;
        this.grounded = false; this.escaped = false;
    }

    reset(x, y) {
        this.x = x; this.y = y;
        this.vx = 0; this.vy = 0;
        this.grounded = false; this.escaped = false;
    }

    update() {
        if (this.escaped) return;

        if (inputs.left) this.vx = -this.speed;
        else if (inputs.right) this.vx = this.speed;
        else this.vx *= 0.8;

        if (inputs.jump && this.grounded) {
            this.vy = this.jumpStrength;
            this.grounded = false;
            for (let i = 0; i < 8; i++) {
                addParticle(this.x + 9, this.y + 24, this.type === 'fire' ? '#ffaa00' : '#00ccff', 2, 3, 20);
            }
        }

        this.vy += 0.45;
        this.x += this.vx; this.checkHorizontalCollisions();
        this.y += this.vy; this.checkVerticalCollisions();
        this.checkTileInteractions();

        // Trail particles on move
        if (Math.abs(this.vx) > 0.5 && Math.random() < 0.4) {
            addParticle(
                this.x + 9 + (Math.random() - 0.5) * 8,
                this.y + 12 + (Math.random() - 0.5) * 12,
                this.type === 'fire' ? '#ff3300' : '#0099ff',
                1, 2.5, 18
            );
        }

        if (conn && conn.open) {
            conn.send({ type: 'move', x: this.x, y: this.y, vx: this.vx, escaped: this.escaped });
        }
    }

    checkHorizontalCollisions() {
        for (let r = 0; r < map.length; r++) {
            for (let c = 0; c < map[r].length; c++) {
                if (map[r][c] === 1) {
                    let tile = { x: c * TILE_SIZE, y: r * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE };
                    if (isColliding(this, tile)) {
                        if (this.vx > 0) this.x = tile.x - this.width;
                        else if (this.vx < 0) this.x = tile.x + tile.width;
                    }
                }
            }
        }
    }

    checkVerticalCollisions() {
        this.grounded = false;
        for (let r = 0; r < map.length; r++) {
            for (let c = 0; c < map[r].length; c++) {
                if (map[r][c] === 1) {
                    let tile = { x: c * TILE_SIZE, y: r * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE };
                    if (isColliding(this, tile)) {
                        if (this.vy > 0) {
                            this.y = tile.y - this.height; this.vy = 0; this.grounded = true;
                        } else if (this.vy < 0) {
                            this.y = tile.y + tile.height; this.vy = 0;
                        }
                    }
                }
            }
        }
    }

    checkTileInteractions() {
        for (let r = 0; r < map.length; r++) {
            for (let c = 0; c < map[r].length; c++) {
                let tileType = map[r][c];
                if (tileType > 1) {
                    let tile = { x: c * TILE_SIZE, y: r * TILE_SIZE + 10, width: TILE_SIZE, height: TILE_SIZE - 10 };
                    if (isColliding(this, tile)) {
                        // Hazard Deaths
                        if (tileType === 4 || (tileType === 2 && this.type === 'water') || (tileType === 3 && this.type === 'fire')) {
                            for (let i = 0; i < 20; i++) {
                                addParticle(this.x + 9, this.y + 12, '#ffffff', 4, 4, 30);
                            }
                            this.reset(this.type === 'fire' ? 60 : 100, 280);
                        }
                        // Door Escapes
                        if ((tileType === 5 && this.type === 'fire') || (tileType === 6 && this.type === 'water')) {
                            this.escaped = true;
                        }
                    }
                }
            }
        }
    }

    draw() {
        if (this.escaped) return;
        drawCharacter(this.x, this.y, this.type, this.vx);
    }
}

function drawCharacter(x, y, type, vx) {
    ctx.save();
    const isFire = type === 'fire';
    const colorPrimary = isFire ? '#ff3300' : '#00aaff';
    const colorGlow = isFire ? 'rgba(255, 85, 0, 0.6)' : 'rgba(0, 170, 255, 0.6)';

    ctx.shadowColor = colorGlow;
    ctx.shadowBlur = 12;

    // Body
    ctx.fillStyle = colorPrimary;
    ctx.beginPath();
    ctx.roundRect(x, y + 4, 18, 20, [6, 6, 4, 4]);
    ctx.fill();

    // Head Accent
    ctx.fillStyle = isFire ? '#ffaa00' : '#66e0ff';
    ctx.beginPath();
    if (isFire) {
        let flicker = Math.sin(animFrame * 0.2) * 2;
        ctx.moveTo(x + 2, y + 6);
        ctx.quadraticCurveTo(x + 9, y - 6 + flicker, x + 16, y + 6);
    } else {
        let wave = Math.cos(animFrame * 0.15) * 1.5;
        ctx.arc(x + 9, y + 4 + wave, 7, Math.PI, 0);
    }
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#ffffff';
    let eyeOffset = vx > 0.1 ? 2 : vx < -0.1 ? -2 : 0;
    ctx.fillRect(x + 4 + eyeOffset, y + 8, 3, 5);
    ctx.fillRect(x + 11 + eyeOffset, y + 8, 3, 5);

    ctx.restore();
}

function isColliding(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
           a.y < b.y + b.height && a.y + a.height > b.y;
}

let localPlayer = new Player(60, 280, 'fire');

function generateLevel(levelNum) {
    map = [];
    for (let r = 0; r < ROWS; r++) {
        let row = [];
        for (let c = 0; c < COLS; c++) {
            row.push((r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) ? 1 : 0);
        }
        map.push(row);
    }
    map[1][23] = 5; map[1][25] = 6;
    for (let c = 22; c <= 26; c++) map[2][c] = 1;

    const platRows = [3, 5, 7, 9];
    platRows.forEach((r, idx) => {
        let platformType = (levelNum + idx) % 4;
        for (let c = 1; c < COLS - 1; c++) {
            if ((c > 2 && c < 10) || (c > 12 && c < 20) || (c > 21 && c < 26)) map[r][c] = 1;
        }
        if (levelNum > 1) {
            if (platformType === 1) map[r][10] = map[r][11] = map[r][12] = 2;
            else if (platformType === 2) map[r][10] = map[r][11] = map[r][12] = 3;
            else if (platformType === 3 && levelNum > 5) map[r][10] = map[r][11] = map[r][12] = 4;
        }
    });
    levelDisplay.textContent = `LEVEL ${levelNum} / ${TOTAL_LEVELS}`;
    localPlayer = new Player(myRole === 'fire' ? 60 : 100, 280, myRole);
}

// --- ANIMATED TILE & MAP RENDERER ---
function drawMap() {
    for (let r = 0; r < map.length; r++) {
        for (let c = 0; c < map[r].length; c++) {
            let tile = map[r][c];
            let x = c * TILE_SIZE, y = r * TILE_SIZE;

            if (tile === 1) {
                ctx.fillStyle = '#1e2638';
                ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
                ctx.strokeStyle = '#2d3850';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);
            }
            else if (tile === 2) {
                ctx.fillStyle = '#ff2200';
                ctx.fillRect(x, y + 12, TILE_SIZE, TILE_SIZE - 12);
                ctx.fillStyle = '#ffaa00';
                let offset = Math.sin(animFrame * 0.1 + c) * 2;
                ctx.fillRect(x, y + 10 + offset, TILE_SIZE, 3);
                if (Math.random() < 0.05) addParticle(x + 15, y + 10, '#ffbb00', 1, 2, 15);
            }
            else if (tile === 3) {
                ctx.fillStyle = '#0066ff';
                ctx.fillRect(x, y + 12, TILE_SIZE, TILE_SIZE - 12);
                ctx.fillStyle = '#66ccff';
                let offset = Math.cos(animFrame * 0.1 + c) * 2;
                ctx.fillRect(x, y + 10 + offset, TILE_SIZE, 3);
                if (Math.random() < 0.05) addParticle(x + 15, y + 10, '#88e0ff', 0.8, 2, 15);
            }
            else if (tile === 4) {
                ctx.fillStyle = '#00cc44';
                ctx.fillRect(x, y + 12, TILE_SIZE, TILE_SIZE - 12);
                ctx.fillStyle = '#88ff00';
                let offset = Math.sin(animFrame * 0.15 + c) * 2.5;
                ctx.fillRect(x, y + 10 + offset, TILE_SIZE, 3);
                if (Math.random() < 0.05) addParticle(x + 15, y + 10, '#aaff00', 1, 2, 15);
            }
            else if (tile === 5) {
                ctx.save();
                ctx.fillStyle = '#3a1515';
                ctx.fillRect(x + 4, y, TILE_SIZE - 8, TILE_SIZE);
                ctx.strokeStyle = '#ff4400';
                ctx.shadowColor = '#ff4400'; ctx.shadowBlur = 10;
                ctx.lineWidth = 2;
                ctx.strokeRect(x + 4, y, TILE_SIZE - 8, TILE_SIZE);
                ctx.restore();
            }
            else if (tile === 6) {
                ctx.save();
                ctx.fillStyle = '#15253a';
                ctx.fillRect(x + 4, y, TILE_SIZE - 8, TILE_SIZE);
                ctx.strokeStyle = '#00aaff';
                ctx.shadowColor = '#00aaff'; ctx.shadowBlur = 10;
                ctx.lineWidth = 2;
                ctx.strokeRect(x + 4, y, TILE_SIZE - 8, TILE_SIZE);
                ctx.restore();
            }
        }
    }
}

// --- MAIN LOOP ---
function gameLoop() {
    animFrame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (map.length) drawMap();

    updateAndDrawParticles();

    localPlayer.update();
    localPlayer.draw();

    if (conn && conn.open && !remotePlayerPos.escaped) {
        drawCharacter(
            remotePlayerPos.x,
            remotePlayerPos.y,
            myRole === 'fire' ? 'water' : 'fire',
            remotePlayerPos.vx
        );
    }

    requestAnimationFrame(gameLoop);
}

gameLoop();
