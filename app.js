/**
 * Cube Move アプリケーション (更新版)
 * － 10×10 床グリッド上で、縦横高さが同じ立方体を配置・移動するサンプル －
 * 
 * ・新規ブロックは＋ボタン押下時、初期ブロックから固定で5セル離れた位置に配置する。
 * ・配置済みのブロックをタップ／クリックすると、移動状態に入りカーソルが "grabbing" になり、
 *   移動中はブロックの色が黄色（選択状態用カラー）に変わる。
 * ・ドラッグ中は、候補位置として配置されるブロックの上面・左面・右面の3面すべてを赤枠でハイライト。
 *   ※隠れている部分は、既存ブロックにより自然に隠されます。
 */

//#region 定数・初期設定

const canvas      = document.getElementById('gameCanvas');
const ctx         = canvas.getContext('2d');

const blockCountEl = document.getElementById('blockCount');
const resetBtn    = document.getElementById('resetBtn');
const paletteBlock = document.getElementById('draggableBlock');

let canvasWidth  = window.innerWidth;
let canvasHeight = window.innerHeight;
canvas.width  = canvasWidth;
canvas.height = canvasHeight;

// アイソメトリック投影用パラメータ
const tileWidth   = 32;    // セルの横幅補正
const tileHeight  = 16;    // セルの縦幅補正
const blockHeight = 32;    // ブロックの高さ（垂直方向の間隔）

// 床グリッドサイズ（10×10）
const GRID_COLS = 10;
const GRID_ROWS = 10;

// 表示用オフセット（床グリッド全体が画面内に収まるよう調整）
// ユーザ視点では、(0,0) が一番奥（遠い位置＝底辺）になるように
const offsetX = canvasWidth / 2;
const offsetY = 80;

//#endregion

//#region ブロック配置状態・ドラッグ状態

// 各ブロックは {x, y, z} （x,y: 床セル座標, z: 積層数）で管理
let blocks = [];
// 初期ブロックを床の一部として固定。ここでは (0,0,0) を用いる
const initialBlock = { x: 0, y: 0, z: 0 };
blocks.push(initialBlock);

// ドラッグ状態の管理
let dragging      = false;        // ドラッグ中かどうか
let dragPos       = { x: 0, y: 0 };  // 現在のマウス／タッチ座標
let draggingBlock = null;           // 移動対象。既存ブロックの場合はそのオブジェクト、または新規の場合は null

//#endregion

//#region ユーティリティ関数

function updateBlockCount() {
  blockCountEl.textContent = blocks.length;
}

/**
 * アイソメトリック投影
 * (x, y, z) からキャンバス上の「上面の左頂点」位置を算出する
 */
function isoProject(x, y, z) {
  const screenX = offsetX + (x - y) * tileWidth;
  const screenY = offsetY + (x + y) * tileHeight - z * blockHeight;
  return { x: screenX, y: screenY };
}

/**
 * 画面座標からグリッド座標への逆投影（大雑把な計算）
 */
function screenToGrid(screenX, screenY) {
  const dx = screenX - offsetX;
  const dy = screenY - offsetY;
  let x = (dx / tileWidth + (2 * dy) / tileHeight) / 2;
  let y = ((2 * dy) / tileHeight - dx / tileWidth) / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * computeValidCandidates()
 * － 既存ブロックから、隣接して支持があるセルのみを候補として算出する
 *   ※支持チェック：もし nz > 0（床以外）なら、同一セルの (nz-1) ブロックが必要
 */
function computeValidCandidates() {
  let valid = [];
  const directions = [
    { dx: -1, dy: 0, dz: 0 },
    { dx: 1,  dy: 0, dz: 0 },
    { dx: 0,  dy: -1, dz: 0 },
    { dx: 0,  dy: 1,  dz: 0 },
    { dx: 0,  dy: 0, dz: 1 }  // 上積み
  ];
  blocks.forEach(b => {
    directions.forEach(dir => {
      const nx = b.x + dir.dx;
      const ny = b.y + dir.dy;
      const nz = b.z + dir.dz;
      if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) return;
      if (nz < 0) return;
      if (nz > 0) {
        const supported = blocks.some(block => block.x === nx && block.y === ny && block.z === nz - 1);
        if (!supported) return;
      }
      const exists = blocks.some(block => block.x === nx && block.y === ny && block.z === nz);
      if (!exists) {
        if (!valid.some(c => c.x === nx && c.y === ny && c.z === nz)) {
          valid.push({ x: nx, y: ny, z: nz });
        }
      }
    });
  });
  return valid;
}

/**
 * getNearestCandidateFromValidCandidates(screenX, screenY)
 * － computeValidCandidates() で得られた候補のうち、画面座標に最も近い候補を返す
 */
function getNearestCandidateFromValidCandidates(screenX, screenY) {
  const candidates = computeValidCandidates();
  let nearest = null;
  let minDist = Infinity;
  candidates.forEach(candidate => {
    const poly = getCandidateContactPolygon(candidate);
    const cx = poly.reduce((sum, p) => sum + p.x, 0) / poly.length;
    const cy = poly.reduce((sum, p) => sum + p.y, 0) / poly.length;
    const dist = Math.hypot(screenX - cx, screenY - cy);
    if (dist < minDist) {
      minDist = dist;
      nearest = candidate;
    }
  });
  return nearest;
}

/**
 * getCandidateContactPolygon(candidate)
 * － 候補位置の「接触面」（実際にブロックが置かれる底面）のポリゴンを返す
 */
function getCandidateContactPolygon(candidate) {
  const pos = isoProject(candidate.x, candidate.y, candidate.z);
  let poly = [];
  if (candidate.z === 0) {
    poly.push({ x: pos.x, y: pos.y });
    poly.push({ x: pos.x + tileWidth, y: pos.y + tileHeight });
    poly.push({ x: pos.x, y: pos.y + tileHeight * 2 });
    poly.push({ x: pos.x - tileWidth, y: pos.y + tileHeight });
  } else {
    poly.push({ x: pos.x, y: pos.y + blockHeight });
    poly.push({ x: pos.x + tileWidth, y: pos.y + tileHeight + blockHeight });
    poly.push({ x: pos.x, y: pos.y + tileHeight * 2 + blockHeight });
    poly.push({ x: pos.x - tileWidth, y: pos.y + tileHeight + blockHeight });
  }
  return poly;
}

/**
 * drawCandidateFullOutline(candidate)
 * － 候補ブロックのすべての面（上面・左面・右面）のアウトラインを赤で描画する
 */
function drawCandidateFullOutline(candidate) {
  if (!candidate) return;
  const pos = isoProject(candidate.x, candidate.y, candidate.z);
  ctx.save();
  ctx.strokeStyle = '#f00';
  ctx.lineWidth = 3;
  // 上面（ダイヤモンド形）
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.lineTo(pos.x + tileWidth, pos.y + tileHeight);
  ctx.lineTo(pos.x, pos.y + tileHeight * 2);
  ctx.lineTo(pos.x - tileWidth, pos.y + tileHeight);
  ctx.closePath();
  ctx.stroke();
  // 左面
  ctx.beginPath();
  ctx.moveTo(pos.x - tileWidth, pos.y + tileHeight);
  ctx.lineTo(pos.x - tileWidth, pos.y + tileHeight + blockHeight);
  ctx.lineTo(pos.x, pos.y + tileHeight * 2 + blockHeight);
  ctx.lineTo(pos.x, pos.y + tileHeight * 2);
  ctx.closePath();
  ctx.stroke();
  // 右面
  ctx.beginPath();
  ctx.moveTo(pos.x + tileWidth, pos.y + tileHeight);
  ctx.lineTo(pos.x + tileWidth, pos.y + tileHeight + blockHeight);
  ctx.lineTo(pos.x, pos.y + tileHeight * 2 + blockHeight);
  ctx.lineTo(pos.x, pos.y + tileHeight * 2);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

//#endregion

//#region 描画関数

/**
 * drawFloorGrid()
 * － 10×10 の床グリッドをダイヤモンド形で描画する
 */
function drawFloorGrid() {
  ctx.strokeStyle = '#aaa';
  ctx.lineWidth = 1;
  for (let i = 0; i < GRID_COLS; i++) {
    for (let j = 0; j < GRID_ROWS; j++) {
      const pos = isoProject(i, j, 0);
      drawDiamond(pos.x, pos.y, tileWidth, tileHeight, false);
    }
  }
}

/**
 * drawDiamond(x, y, tWidth, tHeight, drawOutline)
 * － 指定位置からダイヤモンド形（セルの形）を描画する。drawOutline が true の場合は赤枠でハイライト
 */
function drawDiamond(x, y, tWidth, tHeight, drawOutline) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + tWidth, y + tHeight);
  ctx.lineTo(x, y + tHeight * 2);
  ctx.lineTo(x - tWidth, y + tHeight);
  ctx.closePath();
  if (drawOutline) {
    ctx.strokeStyle = '#f00';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * drawCube(screenX, screenY, isSelected)
 * － 立方体（ブロック）を上面・左面・右面に分けて描画する。
 *     isSelected が true の場合は、選択状態用（黄色系）のカラーで表示する。
 */
function drawCube(screenX, screenY, isSelected = false) {
  let topColor, leftColor, rightColor, strokeColor;
  if (isSelected) {
    topColor    = '#ffff99';    // 黄色系
    leftColor   = '#ffeb99';
    rightColor  = '#ffe066';
    strokeColor = '#f80';
  } else {
    topColor    = '#ddddff';
    leftColor   = '#ccccff';
    rightColor  = '#9999ff';
    strokeColor = '#333';
  }
  
  ctx.save();
  // 上面（ダイヤモンド形）
  ctx.beginPath();
  ctx.moveTo(screenX, screenY);
  ctx.lineTo(screenX + tileWidth, screenY + tileHeight);
  ctx.lineTo(screenX, screenY + tileHeight * 2);
  ctx.lineTo(screenX - tileWidth, screenY + tileHeight);
  ctx.closePath();
  ctx.fillStyle = topColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // 左面
  ctx.beginPath();
  ctx.moveTo(screenX - tileWidth, screenY + tileHeight);
  ctx.lineTo(screenX - tileWidth, screenY + tileHeight + blockHeight);
  ctx.lineTo(screenX, screenY + tileHeight * 2 + blockHeight);
  ctx.lineTo(screenX, screenY + tileHeight * 2);
  ctx.closePath();
  ctx.fillStyle = leftColor;
  ctx.fill();
  ctx.stroke();
  
  // 右面
  ctx.beginPath();
  ctx.moveTo(screenX + tileWidth, screenY + tileHeight);
  ctx.lineTo(screenX + tileWidth, screenY + tileHeight + blockHeight);
  ctx.lineTo(screenX, screenY + tileHeight * 2 + blockHeight);
  ctx.lineTo(screenX, screenY + tileHeight * 2);
  ctx.closePath();
  ctx.fillStyle = rightColor;
  ctx.fill();
  ctx.stroke();
  
  ctx.restore();
}

/**
 * drawBlock(block)
 * － 個々の既存ブロックを通常状態（非選択）で描画する
 */
function drawBlock(block) {
  const pos = isoProject(block.x, block.y, block.z);
  drawCube(pos.x, pos.y, false);
}

/**
 * drawCandidateFullOutline(candidate)
 * － ドラッグ中の候補位置に、配置される予定のブロックの3面（上・左・右）のアウトラインを赤枠で表示する
 */
function drawCandidateFullOutline(candidate) {
  if (!candidate) return;
  const pos = isoProject(candidate.x, candidate.y, candidate.z);
  ctx.save();
  ctx.strokeStyle = '#f00';
  ctx.lineWidth = 3;
  // 上面
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.lineTo(pos.x + tileWidth, pos.y + tileHeight);
  ctx.lineTo(pos.x, pos.y + tileHeight * 2);
  ctx.lineTo(pos.x - tileWidth, pos.y + tileHeight);
  ctx.closePath();
  ctx.stroke();
  // 左面
  ctx.beginPath();
  ctx.moveTo(pos.x - tileWidth, pos.y + tileHeight);
  ctx.lineTo(pos.x - tileWidth, pos.y + tileHeight + blockHeight);
  ctx.lineTo(pos.x, pos.y + tileHeight * 2 + blockHeight);
  ctx.lineTo(pos.x, pos.y + tileHeight * 2);
  ctx.closePath();
  ctx.stroke();
  // 右面
  ctx.beginPath();
  ctx.moveTo(pos.x + tileWidth, pos.y + tileHeight);
  ctx.lineTo(pos.x + tileWidth, pos.y + tileHeight + blockHeight);
  ctx.lineTo(pos.x, pos.y + tileHeight * 2 + blockHeight);
  ctx.lineTo(pos.x, pos.y + tileHeight * 2);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * draw()
 * － キャンバス全体をクリアし、床グリッド・既存ブロック・ドラッグ中ブロック・候補アウトラインを描画する
 */
function draw() {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  drawFloorGrid();
  blocks.forEach(block => {
    drawBlock(block);
  });
  if (dragging) {
    // ドラッグ中のブロックを仮表示する。既存ブロックの移動の場合は選択状態（黄色）で表示。
    drawCube(dragPos.x - tileWidth, dragPos.y - tileHeight, draggingBlock ? true : false);
    // 候補位置を算出して、全面アウトラインを表示
    const candidate = getNearestCandidateFromValidCandidates(dragPos.x, dragPos.y);
    drawCandidateFullOutline(candidate);
  }
}

//#endregion

//#region ヒットテスト

/**
 * isPointInDiamond(mx, my, pos)
 * － 指定点 (mx, my) が、pos を起点とするダイヤモンド形内にあるか判定する（ブロック上面用）
 */
function isPointInDiamond(mx, my, pos) {
  const p1 = { x: pos.x,             y: pos.y };
  const p2 = { x: pos.x + tileWidth, y: pos.y + tileHeight };
  const p3 = { x: pos.x,             y: pos.y + tileHeight * 2 };
  const p4 = { x: pos.x - tileWidth, y: pos.y + tileHeight };
  const poly = [p1, p2, p3, p4];
  return pointInPolygon({ x: mx, y: my }, poly);
}

/**
 * pointInPolygon(point, vs)
 * － Ray-casting アルゴリズムにより、点が多角形 vs 内にあるか判定する
 */
function pointInPolygon(point, vs) {
  let x = point.x, y = point.y;
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    let xi = vs[i].x, yi = vs[i].y;
    let xj = vs[j].x, yj = vs[j].y;
    let intersect = ((yi > y) !== (yj > y)) &&
                    (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * getBlockAtPoint(mx, my)
 * － キャンバス上の点 (mx, my) にヒットするブロック（同一セルであれば z が最大、つまり上にあるブロック）を返す
 */
function getBlockAtPoint(mx, my) {
  let candidate = null;
  blocks.forEach((block, index) => {
    const pos = isoProject(block.x, block.y, block.z);
    if (isPointInDiamond(mx, my, pos)) {
      if (!candidate || block.z > candidate.block.z) {
        candidate = { block, index };
      }
    }
  });
  return candidate;
}

//#endregion

//#region イベントハンドラー

//【既存ブロックの移動】（マウス）
document.addEventListener('mousedown', (e) => {
  const mx = e.clientX;
  const my = e.clientY;
  const hit = getBlockAtPoint(mx, my);
  if (hit) {
    dragging = true;
    draggingBlock = hit.block;
    blocks.splice(hit.index, 1);
    dragPos.x = mx;
    dragPos.y = my;
    canvas.style.cursor = 'grabbing';
  }
});
document.addEventListener('mousemove', (e) => {
  if (dragging) {
    dragPos.x = e.clientX;
    dragPos.y = e.clientY;
    draw();
  }
});
document.addEventListener('mouseup', (e) => {
  if (dragging) {
    const candidate = getNearestCandidateFromValidCandidates(e.clientX, e.clientY);
    if (candidate) {
      if (draggingBlock) {
        draggingBlock.x = candidate.x;
        draggingBlock.y = candidate.y;
        draggingBlock.z = candidate.z;
        blocks.push(draggingBlock);
      } else {
        blocks.push({ x: candidate.x, y: candidate.y, z: candidate.z });
      }
    } else {
      if (draggingBlock) {
        blocks.push(draggingBlock);
      }
    }
    dragging = false;
    draggingBlock = null;
    canvas.style.cursor = 'default';
    draw();
    updateBlockCount();
  }
});

//【新規ブロックの配置】（＋ボタン）
// タブレット向け対策として、＋ボタンをクリック／タップすると、初期ブロックから5セル離れた位置に配置する
paletteBlock.addEventListener('click', () => {
  // 例として、初期ブロックの (x,y) に対して x+5, y とする
  let newX = initialBlock.x + 5;
  let newY = initialBlock.y;
  if (newX >= GRID_COLS) { newX = GRID_COLS - 1; }
  // 初期ブロックが床にあるため、そこは支持済みとみなす
  blocks.push({ x: newX, y: newY, z: 0 });
  updateBlockCount();
  draw();
});

//【タッチ操作】（既存ブロックの移動＆新規ブロック配置）
document.addEventListener('touchstart', (e) => {
  if (e.touches.length > 0 && e.target !== paletteBlock) {
    const touch = e.touches[0];
    const hit = getBlockAtPoint(touch.clientX, touch.clientY);
    if (hit) {
      dragging = true;
      draggingBlock = hit.block;
      blocks.splice(hit.index, 1);
      dragPos.x = touch.clientX;
      dragPos.y = touch.clientY;
      canvas.style.cursor = 'grabbing';
    }
    e.preventDefault();
  }
});
document.addEventListener('touchmove', (e) => {
  if (dragging) {
    let touch = e.touches[0];
    dragPos.x = touch.clientX;
    dragPos.y = touch.clientY;
    draw();
    e.preventDefault();
  }
});
document.addEventListener('touchend', (e) => {
  if (dragging) {
    const candidate = getNearestCandidateFromValidCandidates(dragPos.x, dragPos.y);
    if (candidate) {
      if (draggingBlock) {
        draggingBlock.x = candidate.x;
        draggingBlock.y = candidate.y;
        draggingBlock.z = candidate.z;
        blocks.push(draggingBlock);
      } else {
        blocks.push({ x: candidate.x, y: candidate.y, z: candidate.z });
      }
    } else {
      if (draggingBlock) {
        blocks.push(draggingBlock);
      }
    }
    dragging = false;
    draggingBlock = null;
    canvas.style.cursor = 'default';
    draw();
    updateBlockCount();
    e.preventDefault();
  }
});

// リセットボタン
resetBtn.addEventListener('click', () => {
  blocks = [];
  blocks.push({ x: initialBlock.x, y: initialBlock.y, z: initialBlock.z });
  updateBlockCount();
  draw();
});

// ウィンドウリサイズ時の調整
window.addEventListener('resize', () => {
  canvasWidth  = window.innerWidth;
  canvasHeight = window.innerHeight;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  draw();
});

//#endregion

// 初期描画
updateBlockCount();
draw();
