/**
 * Cube Move アプリケーション (最終版)
 * ・10×10 床グリッド上で、縦横高さが同じ立方体を配置・移動
 * ・新規ブロックは既存ブロックの支持があるセルにのみ配置可能（支持がない場所には配置不可）
 * ・ドラッグ中は有効候補の底面を赤枠でハイライトし、候補算出は computeValidCandidates() に基づく
 * ・同一セル内では最高層のみが選択可能（上に載っているブロックのみ動かせる）
 */

//////////////////////////////
// 定数・初期設定
//////////////////////////////

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
const blockHeight = 32;    // ブロックの高さ

// 床グリッドサイズ（10×10）
// ※各セルには初期状態ではブロックがなく、ブロックは既存の構造からのみ拡張可能
const GRID_COLS = 10;
const GRID_ROWS = 10;

// 表示用オフセット（床グリッド全体が画面内に収まるよう設定）  
// ユーザ視点では、(0,0) が一番奥（遠い位置＝底辺）になるように調整
const offsetX = canvasWidth / 2;
const offsetY = 80;

//////////////////////////////////
// ブロックの状態管理
//////////////////////////////////

// 各ブロックは {x, y, z} （x,y: 床セル座標, z: 積層数）で管理
let blocks = [];
// 初期ブロックは「床」そのものとして固定。ここでは (0,0,0) とする。
const initialBlock = { x: 0, y: 0, z: 0 };
blocks.push(initialBlock);

//////////////////////////////////
// ドラッグ状態の管理
//////////////////////////////////

let dragging      = false;        // ドラッグ中かどうか
let dragPos       = { x: 0, y: 0 };  // 現在のマウス／タッチ座標
let draggingBlock = null;           // 移動対象。既存ブロックの場合はそのオブジェクト、または新規の場合は null

//////////////////////////////
// ユーティリティ関数
//////////////////////////////

// ブロック数の更新
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
 * ・既存ブロックから、隣接する有効な配置候補セルを算出する
 * ・候補は、壁などとは異なり、同一セル内にすでにブロックが存在する場合のみその上に新規ブロックを置ける（サポートがある）とする
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
      // サポートチェック：もし nz > 0、つまり地面ではない場合、
      // 同じセルの下層 (nz - 1) のブロックが必ず存在する必要がある。
      if (nz > 0) {
        const supported = blocks.some(block => block.x === nx && block.y === ny && block.z === nz - 1);
        if (!supported) return;
      }
      // そのセルに既にブロックがあるかチェック（無い場合はサポートがないので新規ブロック配置不可）
      const exists = blocks.some(block => block.x === nx && block.y === ny && block.z === nz);
      if (!exists) {
        // 重複回避して候補として登録
        if (!valid.some(c => c.x === nx && c.y === ny && c.z === nz)) {
          valid.push({ x: nx, y: ny, z: nz });
        }
      }
    });
  });
  return valid;
}

/**
 * getCandidateContactPolygon(candidate)
 * ・候補位置の「接触面」（実際にブロックが置かれる底面）のポリゴン（頂点座標の配列）を返す
 * ・床の場合はそのセルのダイヤモンド形、上積みの場合は上面の形状を blockHeight 分下げたもの
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
 * getNearestCandidateFromValidCandidates(screenX, screenY)
 * ・computeValidCandidates() で得られる候補のうち、画面座標に最も近い候補を返す
 */
function getNearestCandidateFromValidCandidates(screenX, screenY) {
  const candidates = computeValidCandidates();
  let nearest = null;
  let minDist = Infinity;
  candidates.forEach(candidate => {
    const poly = getCandidateContactPolygon(candidate);
    // 各候補の中心を計算
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

//////////////////////////////
// 描画関数
//////////////////////////////

/**
 * drawFloorGrid()
 * ・10×10 の床グリッドをダイヤモンド形で描画し、配置エリアを示す
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
 * drawDiamond()
 * ・x,y を起点として、ダイヤモンド形（セルの上面／床）を描画する
 * ・drawOutline が true の場合、赤枠でハイライト表示
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
 * ・立方体（ブロック）を、上面・左面・右面に分けて描画する
 * ・isSelected が true の場合は、選択状態用の色で描画して視認性を向上
 */
function drawCube(screenX, screenY, isSelected = false) {
  const topColor    = isSelected ? '#ffdddd' : '#ddddff';
  const leftColor   = isSelected ? '#ffcccc' : '#ccccff';
  const rightColor  = isSelected ? '#ffbbaa' : '#9999ff';
  const strokeColor = isSelected ? '#f80'   : '#333';
  
  ctx.save();
  // 上面（ダイヤモンド形）
  ctx.beginPath();
  ctx.moveTo(screenX, screenY);
  ctx.lineTo(screenX + tileWidth, screenY + tileHeight);
  ctx.lineTo(screenX, screenY + tileHeight * 2);
  ctx.lineTo(screenX - tileWidth, screenY + tileHeight);
  ctx.closePath();
  ctx.fillStyle   = topColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth   = 2;
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
 * ・個々の既存ブロックを通常状態で描画する
 */
function drawBlock(block) {
  const pos = isoProject(block.x, block.y, block.z);
  drawCube(pos.x, pos.y, false);
}

/**
 * drawCandidateHighlight(candidate)
 * ・ドラッグ中に、getNearestCandidateFromValidCandidates() で求めた候補の接触面（底面）を赤枠でハイライト
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
  ctx.lineWidth   = 3;
  ctx.stroke();
  ctx.restore();
}

/**
 * draw()
 * ・キャンバス全体をクリアして、床グリッド、既存ブロック、ドラッグ中ブロック、候補ハイライトを描画
 */
function draw() {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  drawFloorGrid();
  blocks.forEach(block => {
    drawBlock(block);
  });
  if (dragging) {
    // ドラッグ中のブロックを仮表示（既存ブロック移動の場合は選択状態表示）
    drawCube(dragPos.x - tileWidth, dragPos.y - tileHeight, (draggingBlock) ? true : false);
    // 候補位置は、getNearestCandidateFromValidCandidates() で算出
    const candidate = getNearestCandidateFromValidCandidates(dragPos.x, dragPos.y);
    drawCandidateHighlight(candidate);
  }
}

//////////////////////////////
// ヒットテスト関連
//////////////////////////////

/**
 * isPointInDiamond(mx, my, pos)
 * ・点 (mx, my) が、pos を起点とするダイヤモンド形（ブロックの上面）内にあるか判定
 */
function isPointInDiamond(mx, my, pos) {
  const p1 = { x: pos.x,               y: pos.y };
  const p2 = { x: pos.x + tileWidth,   y: pos.y + tileHeight };
  const p3 = { x: pos.x,               y: pos.y + tileHeight * 2 };
  const p4 = { x: pos.x - tileWidth,   y: pos.y + tileHeight };
  const poly = [p1, p2, p3, p4];
  return pointInPolygon({ x: mx, y: my }, poly);
}

/**
 * pointInPolygon(point, vs)
 * ・Ray-casting アルゴリズムにより、点が多角形 vs 内にあるか判定
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
 * ・キャンバス上の点 (mx, my) にヒットするブロックを返す（同一セルに複数ある場合は、z が最大のもの＝上に載っているブロックのみ）
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

//////////////////////////////
// イベントハンドラー
//////////////////////////////

// 【既存ブロックの移動】 マウス操作
document.addEventListener('mousedown', (e) => {
  const mx = e.clientX;
  const my = e.clientY;
  const hit = getBlockAtPoint(mx, my);
  if (hit) {
    dragging = true;
    draggingBlock = hit.block; // 上に載っているブロックのみ選択
    // 移動のため、一時的に blocks から削除
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
    // ドロップ時は、getNearestCandidateFromValidCandidates() を利用
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
      // 候補がない場合は、もし選択中ブロックがあれば元の位置に戻す
      if (draggingBlock) {
        blocks.push(draggingBlock);
      }
    }
    dragging      = false;
    draggingBlock = null;
    draw();
    updateBlockCount();
  }
});

// 【新規ブロックの配置】 パレット（＋ボタン）からの操作
// 例：＋ボタンを押したとき、初期ブロックからx方向に5セル離れた位置に配置する場合
paletteBlock.addEventListener('click', () => {
  // 新規ブロックを固定位置、例えば (initialBlock.x + 5, initialBlock.y, 0) に配置する
  let newX = initialBlock.x + 5;
  let newY = initialBlock.y;
  // もし固定位置がグリッド外またはサポートがない場合は、別の候補を出すか警告する
  if (newX >= GRID_COLS) {
    newX = GRID_COLS - 1; // グリッド内に収める
  }
  // サポートチェック：初期ブロックが床にあるため、(newX,newY,0) に配置できるか確認
  // ここでは初期ブロックがすでにある場所から離れたセルであればサポートはなくてもOKとする（新規配置用の特別処理）
  // ※サポートチェックが不要な場合、無条件で配置しても構いません
  blocks.push({ x: newX, y: newY, z: 0 });
  updateBlockCount();
  draw();
});


// マウスによる新規ブロックドラッグ（※ここでは getNearestCandidateFromValidCandidates を利用）
document.addEventListener('mousemove', (e) => {
  if (dragging === false && draggingBlock === null) return;
  // すでに既存ブロックの移動中の場合は、上記 mousedown で処理済み
  if (!dragging && draggingBlock === null) return;
  dragPos.x = e.clientX;
  dragPos.y = e.clientY;
  draw();
});
document.addEventListener('mouseup', (e) => {
  if (dragging === false && draggingBlock === null) return;
  const candidate = getNearestCandidateFromValidCandidates(e.clientX, e.clientY);
  if (candidate) {
    blocks.push({ x: candidate.x, y: candidate.y, z: candidate.z });
  }
  dragging = false;
  draw();
  updateBlockCount();
});

// 【タッチ操作】 既存ブロック選択と新規ブロック配置
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
    dragging      = false;
    draggingBlock = null;
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
  canvas.width  = canvasWidth;
  canvas.height = canvasHeight;
  draw();
});

// 初期描画
updateBlockCount();
draw();
