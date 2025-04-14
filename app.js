/**
 * Cube Move アプリケーション (更新版)
 * ・10×10の床グリッド上で、縦横高が同じ立方体を配置・移動するサンプル
 * ・画面座標からグリッド座標への逆投影（screenToGrid）を利用して drop 候補を求め、
 *   getCandidateFromScreen() を drop イベントで呼び出します。
 * ・同一セルに複数ブロックがある場合、最高層（z の値が最大）のブロックのみが移動可能です。
 */

/////////////////////
// 定数・初期設定 //
/////////////////////
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const blockCountEl = document.getElementById('blockCount');
const resetBtn = document.getElementById('resetBtn');
const paletteBlock = document.getElementById('draggableBlock');

let canvasWidth = window.innerWidth;
let canvasHeight = window.innerHeight;
canvas.width  = canvasWidth;
canvas.height = canvasHeight;

// アイソメトリック投影パラメータ
const tileWidth = 32;      // 横方向の補正（セルの横幅）
const tileHeight = 16;     // 縦方向の補正（セルの高さ）
const blockHeight = 32;    // ブロックの高さ

// 床グリッドサイズ：10×10
const GRID_COLS = 10;
const GRID_ROWS = 10;

// 表示オフセット（床グリッド全体が画面内に収まるように調整）
// ユーザ視点では、グリッドの (0,0) が一番奥（遠い位置）になるよう設定
const offsetX = canvasWidth / 2;
const offsetY = 80;

//////////////////////////
// ブロック配置の管理 //
//////////////////////////
// 各ブロックは {x, y, z}（x,y: 床セル座標、z: 積層数）で管理
let blocks = [];
// 初期ブロックは一番奥の角、すなわち (0,0,0)
const initialBlock = { x: 0, y: 0, z: 0 };
blocks.push(initialBlock);

//////////////////////////
// ドラッグ状態の管理 //
//////////////////////////
let dragging = false;          // ドラッグ中かどうか
let dragPos = { x: 0, y: 0 };    // 現在のマウス／タッチ座標
let draggingBlock = null;      // 移動対象（既存ブロックの場合、そのブロックオブジェクト。新規の場合は null）

//////////////////////////
// ユーティリティ関数   //
//////////////////////////
/**
 * ブロック数を更新して表示
 */
function updateBlockCount() {
  blockCountEl.textContent = blocks.length;
}

/**
 * アイソメトリック投影：入力 (x, y, z) から、キャンバス上の「上面の左頂点」位置を計算する
 */
function isoProject(x, y, z) {
  const screenX = offsetX + (x - y) * tileWidth;
  const screenY = offsetY + (x + y) * tileHeight - z * blockHeight;
  return { x: screenX, y: screenY };
}

/**
 * 画面座標からグリッド座標を逆算する関数
 * ※ 逆投影の大まかな計算。オフセットやタイル比率に合わせて調整。
 */
function screenToGrid(screenX, screenY) {
  const dx = screenX - offsetX;
  const dy = screenY - offsetY;
  let x = (dx / tileWidth + (2 * dy) / tileHeight) / 2;
  let y = ((2 * dy) / tileHeight - dx / tileWidth) / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * 画面座標から落下候補セルを算出する
 * ・グリッド座標を直接求め、該当セルが床内であれば、そこに既存ブロックがあるかで z 座標を決定
 * ・もしセルにブロックがある場合は、最高の z に1を足した値を候補とする
 * ・なお、z > 0 の場合、同じセルで下の層があること（支持）が必須
 */
function getCandidateFromScreen(screenX, screenY) {
  const gridPos = screenToGrid(screenX, screenY);
  if (gridPos.x < 0 || gridPos.x >= GRID_COLS || gridPos.y < 0 || gridPos.y >= GRID_ROWS) {
    return null; // 配置可能エリア外
  }
  // 同一セルのブロックを調べる
  const sameCellBlocks = blocks.filter(b => b.x === gridPos.x && b.y === gridPos.y);
  let candidateZ = 0;
  if (sameCellBlocks.length > 0) {
    candidateZ = Math.max(...sameCellBlocks.map(b => b.z)) + 1;
  }
  // サポートチェック：もし candidateZ > 0 なら、必ず (x,y,candidateZ-1) のブロックがあるか確認
  if (candidateZ > 0) {
    const supported = blocks.some(b => b.x === gridPos.x && b.y === gridPos.y && b.z === candidateZ - 1);
    if (!supported) return null;
  }
  return { x: gridPos.x, y: gridPos.y, z: candidateZ };
}

/**
 * 床グリッド（10×10）の描画
 * 各セルはダイヤモンド形で描画して、配置エリアを明示する
 */
function drawFloorGrid() {
  ctx.strokeStyle = '#aaa';
  ctx.lineWidth = 1;
  for (let i = 0; i < GRID_COLS; i++) {
    for (let j = 0; j < GRID_ROWS; j++) {
      let pos = isoProject(i, j, 0);
      drawDiamond(pos.x, pos.y, tileWidth, tileHeight, false);
    }
  }
}

/**
 * ダイヤモンド形（セルの上面／床セル）の描画
 * drawOutline が true なら赤枠でハイライト
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
 * isSelected が true の場合は、選択状態用の色で描画する
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
 * 既存ブロックの描画（通常状態）
 */
function drawBlock(block) {
  const pos = isoProject(block.x, block.y, block.z);
  drawCube(pos.x, pos.y, false);
}

/**
 * 候補位置（落下位置）の「接触面」（ブロックが置かれる底面）のポリゴンを計算して返す
 */
function getCandidateContactPolygon(candidate) {
  const pos = isoProject(candidate.x, candidate.y, candidate.z);
  let poly = [];
  if (candidate.z === 0) {
    // 床セルの場合
    poly.push({ x: pos.x, y: pos.y });
    poly.push({ x: pos.x + tileWidth, y: pos.y + tileHeight });
    poly.push({ x: pos.x, y: pos.y + tileHeight * 2 });
    poly.push({ x: pos.x - tileWidth, y: pos.y + tileHeight });
  } else {
    // ブロック上の場合：上面ダイヤモンド形を blockHeight 分下げる
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
 * ・床グリッド、既存ブロック、そしてドラッグ中のブロックと候補ハイライトを描画する
 */
function draw() {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  drawFloorGrid();
  blocks.forEach(block => {
    drawBlock(block);
  });
  if (dragging) {
    // ドラッグ中は、ドラッグ対象ブロックを仮表示する。
    // draggingBlock がある場合（既存ブロックの再配置）は選択状態で表示
    drawCube(dragPos.x - tileWidth, dragPos.y - tileHeight, draggingBlock ? true : false);
    // ここで getCandidateFromScreen を利用して、配置候補を算出
    const candidate = getCandidateFromScreen(dragPos.x, dragPos.y);
    drawCandidateHighlight(candidate);
  }
}

/**
 * 点 (mx, my) がダイヤモンド形内にあるか判定（ブロックの上面判定）
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
 * Ray-casting アルゴリズムを用いて、点が多角形内にあるか判定
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
 * ブロック選択のためのヒットテスト
 * 同一セルに重なっている場合は、z が最も大きい（上に載っている）ブロックのみを返す
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

//////////////////////////
// イベントハンドラー   //
//////////////////////////

// マウスによる操作
document.addEventListener('mousedown', (e) => {
  const mx = e.clientX;
  const my = e.clientY;
  const hit = getBlockAtPoint(mx, my);
  if (hit) {
    dragging = true;
    draggingBlock = hit.block; // 選択された上にあるブロックのみ
    // 再配置のため、選択ブロックは一時的に除外
    blocks.splice(hit.index, 1);
    dragPos.x = mx;
    dragPos.y = my;
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
    // ドロップ時は getCandidateFromScreen を利用して候補を取得
    const candidate = getCandidateFromScreen(e.clientX, e.clientY);
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
      // 候補が無い場合は、選択中ブロックがあれば元に戻す
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
  draggingBlock = null;  // 新規ブロック
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
    const candidate = getCandidateFromScreen(e.clientX, e.clientY);
    if (candidate) {
      blocks.push({ x: candidate.x, y: candidate.y, z: candidate.z });
    }
    dragging = false;
    draw();
    updateBlockCount();
  }
});

// タッチ操作対応（既存ブロック選択）
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
    const candidate = getCandidateFromScreen(dragPos.x, dragPos.y);
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

// リセットボタン：初期状態に戻す
resetBtn.addEventListener('click', () => {
  blocks = [];
  blocks.push({ x: initialBlock.x, y: initialBlock.y, z: initialBlock.z });
  updateBlockCount();
  draw();
});

// ウィンドウリサイズ時にキャンバスを調整
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
