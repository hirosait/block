/**
 * Cube Move アプリケーション
 * － 10×10の床グリッド上で、縦横高が同じ立方体を配置・移動できるサンプル －
 */

// キャンバスとコンテキスト取得
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI 要素
const blockCountEl = document.getElementById('blockCount');
const resetBtn = document.getElementById('resetBtn');
const paletteBlock = document.getElementById('draggableBlock');

// キャンバスサイズ
let canvasWidth = window.innerWidth;
let canvasHeight = window.innerHeight;
canvas.width = canvasWidth;
canvas.height = canvasHeight;

// アイソメトリック用パラメータ
const tileWidth = 32;    // セル横幅（斜め表示時の補正）
const tileHeight = 16;   // セル縦幅
const blockHeight = 32;  // 垂直方向の高さ（ブロックの底面～上面の距離）

// 床グリッドサイズ（10×10）
const GRID_COLS = 10;
const GRID_ROWS = 10;

// 表示オフセット（床グリッド全体が画面内に収まるように設定）
// ユーザ視点から、一番奥（遠い位置）が (0,0) となるよう調整
const offsetX = canvasWidth / 2;
const offsetY = 80;  // 上寄せにして遠近感を出す

// ブロック配置情報：各ブロックは {x, y, z}（x,y: 床セル座標、z: 積層数）で管理
// 初期ブロックは、床グリッドの「一番奥の角」＝ (0, 0, 0)
let blocks = [];
const initialBlock = { x: 0, y: 0, z: 0 };
blocks.push(initialBlock);

// ドラッグ状態管理
let dragging = false;          // ドラッグ中か
let dragPos = { x: 0, y: 0 };    // マウス/タッチ座標
let draggingBlock = null;      // 既存ブロックを移動する場合、そのブロック（ドラッグ中は blocks から一時的に削除）

// ブロック数表示更新
function updateBlockCount() {
  blockCountEl.textContent = blocks.length;
}

/**
 * アイソメトリック投影
 * (x, y, z) からキャンバス上の「上面の左頂点」位置を返す
 */
function isoProject(x, y, z) {
  const screenX = offsetX + (x - y) * tileWidth;
  const screenY = offsetY + (x + y) * tileHeight - z * blockHeight;
  return { x: screenX, y: screenY };
}

/**
 * 床グリッド（10×10）の描画
 * 各セルをダイヤモンド形で表示して配置エリアを明示
 */
function drawFloorGrid() {
  ctx.strokeStyle = '#aaa';
  ctx.lineWidth = 1;
  for (let i = 0; i < GRID_COLS; i++) {
    for (let j = 0; j < GRID_ROWS; j++) {
      // 床セルは z = 0
      let pos = isoProject(i, j, 0);
      drawDiamond(pos.x, pos.y, tileWidth, tileHeight, false);
    }
  }
}

/**
 * ダイヤモンド形の描画（セルの上面／床セル）
 * drawOutline が true の場合、赤枠でハイライト表示
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
 * 立方体（ブロック）の描画
 * isSelected が true の場合、選択状態用の色で描画
 */
function drawCube(screenX, screenY, isSelected = false) {
  const topColor   = isSelected ? '#ffdddd' : '#ddddff';
  const leftColor  = isSelected ? '#ffcccc' : '#ccccff';
  const rightColor = isSelected ? '#ffbbaa' : '#9999ff';
  const strokeColor = isSelected ? '#f80' : '#333';
  
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
 * 既存ブロックを描画（選択状態の場合は色変更）
 */
function drawBlock(block) {
  const pos = isoProject(block.x, block.y, block.z);
  // 既存ブロックは通常状態（※ドラッグ中のブロックは blocks から一時的に除外している）
  drawCube(pos.x, pos.y, false);
}

/**
 * 有効な配置候補の計算
 * 各候補は、隣接ブロックから算出するが、ここでの新ルール：
 * ・候補が床 (z = 0) なら OK。
 * ・候補が床以外の場合は、必ず候補の下（同じ x,y, z-1）にブロックが存在することが必要。
 */
function computeValidCandidates() {
  let valid = [];
  const directions = [
    { dx: -1, dy: 0, dz: 0 },
    { dx: 1,  dy: 0, dz: 0 },
    { dx: 0,  dy: -1, dz: 0 },
    { dx: 0,  dy: 1,  dz: 0 },
    { dx: 0,  dy: 0, dz: 1 }
  ];
  blocks.forEach(b => {
    directions.forEach(dir => {
      const nx = b.x + dir.dx;
      const ny = b.y + dir.dy;
      const nz = b.z + dir.dz;
      if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) return;
      if (nz < 0) return;
      // もし床以外（nz > 0）なら、下部が既に存在している必要がある
      if (nz > 0) {
        const supported = blocks.some(block => block.x === nx && block.y === ny && block.z === nz - 1);
        if (!supported) return;
      }
      // すでにブロックが存在していないかチェック
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
 * 候補位置の「接触面」（＝新ブロックの底面）が置かれる位置のポリゴンを返す。
 * ・床の場合はその床セルのダイヤモンド形
 * ・ブロック上の場合は、ブロックの上面ダイヤモンド形を blockHeight 分下げた位置
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
 * ドラッグ中の候補位置の接触面（底面）を赤枠でハイライト表示
 */
function drawCandidateHighlight(candidate) {
  if (!candidate) return;
  const poly = getCandidateContactPolygon(candidate);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i].x, poly[i].y);
  }
  ctx.closePath();
  ctx.strokeStyle = '#f00';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

/**
 * メイン描画ルーチン
 * ・床グリッド、既存ブロック、ドラッグ中（新規 or 移動）のブロック、
 *   そしてドラッグ候補のハイライトを描画
 */
function draw() {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  drawFloorGrid();
  
  // 既存ブロックの描画（ドラッグ中のブロックは blocks から除外しているため常に通常状態）
  blocks.forEach(block => {
    drawBlock(block);
  });
  
  // ドラッグ中の場合：ドラッグ中ブロックの仮表示と候補ハイライト
  if (dragging) {
    // ドラッグ中のブロックは、既存ブロックから移動させている場合は「選択状態」色で描画
    drawCube(dragPos.x - tileWidth, dragPos.y - tileHeight, draggingBlock ? true : false);
    const candidate = getNearestCandidate(dragPos.x, dragPos.y);
    drawCandidateHighlight(candidate);
  }
}

/**
 * 画面座標 (mx, my) がブロックの上面（ダイヤモンド形）内にあるかを判定
 */
function isPointInDiamond(mx, my, pos) {
  const p1 = { x: pos.x, y: pos.y };
  const p2 = { x: pos.x + tileWidth, y: pos.y + tileHeight };
  const p3 = { x: pos.x, y: pos.y + tileHeight * 2 };
  const p4 = { x: pos.x - tileWidth, y: pos.y + tileHeight };
  const poly = [p1, p2, p3, p4];
  return pointInPolygon({ x: mx, y: my }, poly);
}

/**
 * Ray-casting 法による、点が多角形内にあるかの判定
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
 * ブロック選択のヒットテスト：キャンバス上の点 (mx, my) にあるブロック（最前面優先）を返す
 */
function getBlockAtPoint(mx, my) {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const pos = isoProject(block.x, block.y, block.z);
    if (isPointInDiamond(mx, my, pos)) {
      return { block, index: i };
    }
  }
  return null;
}

/**
 * 有効な候補位置を、画面座標 (mx, my) から算出して返す
 */
function getNearestCandidate(mouseX, mouseY) {
  const candidates = computeValidCandidates();
  let nearest = null;
  let minDist = Infinity;
  candidates.forEach(candidate => {
    let poly = getCandidateContactPolygon(candidate);
    let cx = poly.reduce((sum, p) => sum + p.x, 0) / poly.length;
    let cy = poly.reduce((sum, p) => sum + p.y, 0) / poly.length;
    let dist = Math.hypot(mouseX - cx, mouseY - cy);
    if (dist < tileWidth && dist < minDist) {
      minDist = dist;
      nearest = candidate;
    }
  });
  return nearest;
}

/** 
 * イベント処理
 */

// 既存ブロックのクリック（またはタッチ）で、移動状態に入る
document.addEventListener('mousedown', (e) => {
  const mx = e.clientX;
  const my = e.clientY;
  const hit = getBlockAtPoint(mx, my);
  if (hit) {
    dragging = true;
    draggingBlock = hit.block;  // 選択状態となるブロック
    // 選択されたブロックは、再配置のため blocks から一時的に除去
    blocks.splice(hit.index, 1);
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
    const candidate = getNearestCandidate(e.clientX, e.clientY);
    if (candidate) {
      if (draggingBlock) {
        // 再配置時：候補位置にブロックをセット
        draggingBlock.x = candidate.x;
        draggingBlock.y = candidate.y;
        draggingBlock.z = candidate.z;
        blocks.push(draggingBlock);
      } else {
        // パレットからの新規ブロック配置
        blocks.push({ x: candidate.x, y: candidate.y, z: candidate.z });
      }
    } else {
      // 候補が無い場合、選択中ブロックがあれば元に戻す
      if (draggingBlock) {
        blocks.push(draggingBlock);
      }
    }
    dragging = false;
    draggingBlock = null;
    draw();
    updateBlockCount();
  }
});

// パレットからの新規ブロックドラッグ（マウス）
paletteBlock.addEventListener('mousedown', (e) => {
  dragging = true;
  draggingBlock = null;
});
document.addEventListener('mousemove', (e) => {
  if (dragging && draggingBlock === null) {
    dragPos.x = e.clientX;
    dragPos.y = e.clientY;
    draw();
  }
});
document.addEventListener('mouseup', (e) => {
  if (dragging && draggingBlock === null) {
    const candidate = getNearestCandidate(e.clientX, e.clientY);
    if (candidate) {
      blocks.push({ x: candidate.x, y: candidate.y, z: candidate.z });
    }
    dragging = false;
    draw();
    updateBlockCount();
  }
});

// タッチ操作対応（新規＆移動とも）
paletteBlock.addEventListener('touchstart', (e) => {
  dragging = true;
  draggingBlock = null;
  let touch = e.touches[0];
  dragPos.x = touch.clientX;
  dragPos.y = touch.clientY;
  e.preventDefault();
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
    const candidate = getNearestCandidate(dragPos.x, dragPos.y);
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
    draw();
    updateBlockCount();
    e.preventDefault();
  }
});

// リセットボタン：初期状態（初期ブロックのみ）に戻す
resetBtn.addEventListener('click', () => {
  blocks = [];
  blocks.push({ x: initialBlock.x, y: initialBlock.y, z: initialBlock.z });
  updateBlockCount();
  draw();
});

// ウィンドウリサイズ時のキャンバス調整
window.addEventListener('resize', () => {
  canvasWidth = window.innerWidth;
  canvasHeight = window.innerHeight;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  draw();
});

// 初期描画
updateBlockCount();
draw();
