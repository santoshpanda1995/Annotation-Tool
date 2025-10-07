// Annotation Tool JS
const canvas = document.getElementById('canvas'), ctx = canvas.getContext('2d');
const canvasWrap = document.getElementById('canvasWrap'), coordBox = document.getElementById('coordBox');

let images = [], currentIndex = -1;
let annotations = {};
let labels = [], colors = {}, activeLabel = null;
let mode = 'box';

let isDrawing = false, startX = 0, startY = 0, lastX = 0, lastY = 0;
let polyPoints = []; // in-progress polygon points (normalized)

// Selection state
let selectedBox = null;
let selectedHandle = null;
let selectedPoly = null;        // finalized polygon selected
let selectedVertex = null;      // vertex index while drawing polygon

// ---- Helpers ----
function randColor() {
  return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
}
function setActiveLabel(l) {
  activeLabel = l;
  document.getElementById('activeLabelText').textContent = l || 'None';
}
function getCurrentImage() {
  return currentIndex >= 0 ? images[currentIndex] : null;
}
function ensureAnn(img) {
  if (!annotations[img.name]) annotations[img.name] = { mode: mode, shapes: [] };
  return annotations[img.name];
}
function hexToRgba(hex, a) {
  const n = parseInt(hex?.slice(1) || 'e11d48', 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
function denormBox(s) {
  const w = canvas.width, h = canvas.height;
  const bw = s.w * w, bh = s.h * h;
  const x = (s.xc * w) - bw / 2, y = (s.yc * h) - bh / 2;
  return [x, y, bw, bh];
}
function buildPolyPath(pointsNorm, toCtx = true) {
  // pointsNorm = [x1n,y1n,x2n,y2n,...] normalized [0..1]
  const w = canvas.width, h = canvas.height;
  const pts = [];
  for (let i = 0; i < pointsNorm.length; i += 2) {
    pts.push([pointsNorm[i] * w, pointsNorm[i + 1] * h]);
  }
  if (toCtx) {
    ctx.beginPath();
    if (pts.length) ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }
  return pts;
}
function isPointInPoly(pointsNorm, px, py) {
  // Use canvas path for reliable hit-test
  buildPolyPath(pointsNorm, true);
  return ctx.isPointInPath(px, py);
}

// ---- Drawing ----
function fitAndDraw() {
  const item = getCurrentImage();
  if (!item) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pt = document.getElementById("progressText");
    if (pt) pt.textContent = "";
    return;
  }

  // Sizing
  const wrapW = canvasWrap.clientWidth - 20, wrapH = canvasWrap.clientHeight - 20;
  const ratio = Math.min(wrapW / item.w, wrapH / item.h);
  const dispW = Math.max(1, Math.floor(item.w * ratio)), dispH = Math.max(1, Math.floor(item.h * ratio));
  canvas.width = dispW; canvas.height = dispH;
  ctx.clearRect(0, 0, dispW, dispH);
  ctx.drawImage(item.imgEl, 0, 0, dispW, dispH);

  // 🔢 Progress text
  const pt = document.getElementById("progressText");
  if (pt) pt.textContent = `Image ${currentIndex + 1} of ${images.length}`;

  // Draw existing shapes
  const ann = annotations[item.name];
  if (ann) {
    ann.shapes.forEach(a => {
      if (a.type === 'box') {
        const [x, y, w, h] = denormBox(a);
        ctx.strokeStyle = colors[a.label] || '#e11d48';
        ctx.lineWidth = (a === selectedBox) ? 2.5 : 2;
        if (a === selectedBox) {
          ctx.setLineDash([6, 4]);
        }
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);

        // Fill
        ctx.fillStyle = (colors[a.label] || '#e11d48') + "55";
        ctx.fillRect(x, y, w, h);

        // Label
        ctx.fillStyle = colors[a.label] || '#e11d48';
        ctx.font = "bold 15px Inter";
        ctx.fillText(a.label, x + 2, y - 6 < 10 ? y + 15 : y - 6);

        // Handles
        if (a === selectedBox) drawBoxHandles(x, y, w, h, colors[a.label]);
      } else if (a.type === 'poly') {
        // polygon
        ctx.fillStyle = hexToRgba(colors[a.label] || '#e11d48', 0.25);
        ctx.strokeStyle = (a === selectedPoly) ? '#1d4ed8' : (colors[a.label] || '#e11d48');
        ctx.lineWidth = (a === selectedPoly) ? 2.5 : 2;

        buildPolyPath(a.points, true);
        ctx.fill();
        ctx.stroke();

        // Label near first point
        const pts = buildPolyPath(a.points, false);
        if (pts.length) {
          ctx.fillStyle = colors[a.label] || '#e11d48';
          ctx.font = "bold 15px Inter";
          ctx.fillText(a.label, pts[0][0] + 2, pts[0][1] - 6);
        }
      }
    });
  }

  // Box preview while drawing
  if (mode === 'box' && isDrawing && !selectedHandle) {
    ctx.setLineDash([6, 4]); ctx.strokeStyle = '#22c55e';
    ctx.strokeRect(startX, startY, lastX - startX, lastY - startY);
    ctx.setLineDash([]);
  }

  // Polygon being drawn: preview + vertex handles
  if (mode === 'poly' && polyPoints.length > 0) {
    ctx.fillStyle = hexToRgba('#22c55e', 0.15);
    ctx.strokeStyle = '#22c55e';
    // path with preview to cursor
    ctx.beginPath();
    ctx.moveTo(polyPoints[0] * dispW, polyPoints[1] * dispH);
    for (let i = 2; i < polyPoints.length; i += 2) {
      ctx.lineTo(polyPoints[i] * dispW, polyPoints[i + 1] * dispH);
    }
    ctx.lineTo(lastX, lastY);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // Draw vertex handles (circles)
    for (let i = 0; i < polyPoints.length; i += 2) {
      const vx = polyPoints[i] * dispW;
      const vy = polyPoints[i + 1] * dispH;
      ctx.beginPath();
      ctx.fillStyle = "#f59e0b";
      ctx.arc(vx, vy, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#874f00";
      ctx.stroke();
    }
  }

  // Crosshair
  if (coordBox.style.display !== 'none') {
    ctx.beginPath();
    ctx.moveTo(lastX, 0); ctx.lineTo(lastX, dispH);
    ctx.moveTo(0, lastY); ctx.lineTo(dispW, lastY);
    ctx.strokeStyle = 'rgba(37,99,235,0.5)';
    ctx.stroke();
  }
}

function drawBoxHandles(x, y, w, h, color) {
  const size = 6;
  const points = [
    [x, y], [x + w/2, y], [x + w, y],
    [x, y + h/2], [x + w, y + h/2],
    [x, y + h], [x + w/2, y + h], [x + w, y + h]
  ];
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = color || '#000';
  points.forEach(([px, py]) => {
    ctx.fillRect(px - size/2, py - size/2, size, size);
    ctx.strokeRect(px - size/2, py - size/2, size, size);
  });
}
function hitHandle(mx, my, x, y, w, h) {
  const handles = [
    {pos:"tl", px:x, py:y},
    {pos:"tm", px:x+w/2, py:y},
    {pos:"tr", px:x+w, py:y},
    {pos:"ml", px:x, py:y+h/2},
    {pos:"mr", px:x+w, py:y+h/2},
    {pos:"bl", px:x, py:y+h},
    {pos:"bm", px:x+w/2, py:y+h},
    {pos:"br", px:x+w, py:y+h}
  ];
  return handles.find(hd => Math.abs(mx - hd.px) <= 4 && Math.abs(my - hd.py) <= 4);
}

// ---- Labels ----
function addLabelUI(l) {
  const w = document.createElement('div'); w.className = 'label-item';
  const left = document.createElement('div'); left.className = 'pill';
  const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = colors[l];
  const nm = document.createElement('span'); nm.textContent = l;
  left.appendChild(sw); left.appendChild(nm);

  const acts = document.createElement('div'); acts.className = 'label-actions';
  const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'activeLabel';
  radio.className = 'radio'; radio.onclick = () => setActiveLabel(l);
  const del = document.createElement('button'); del.className = 'delete-label'; del.textContent = '✕';
  del.onclick = () => { deleteLabel(l, w); };
  acts.appendChild(radio); acts.appendChild(del);

  w.appendChild(left); w.appendChild(acts);
  document.getElementById('labelsList').appendChild(w);
}
function deleteLabel(label, element) {
  labels = labels.filter(l => l !== label);
  delete colors[label];
  Object.values(annotations).forEach(a => { a.shapes = a.shapes.filter(s => s.label !== label); });
  if (activeLabel === label) setActiveLabel(null);
  element.remove(); fitAndDraw(); refreshThumbs();
}

// ---- Thumbnails ----
function refreshThumbs() {
  const t = document.getElementById('thumbs'); t.innerHTML = '';
  images.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'thumb' + (i === currentIndex ? ' active' : '');
    // ✅ mark as done if any shapes
    if (annotations[it.name] && annotations[it.name].shapes.length > 0) d.classList.add('done');

    const im = document.createElement('img'); im.src = it.src;
    const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = it.name;
    d.appendChild(im); d.appendChild(nm);
    d.onclick = () => { 
      currentIndex = i; 
      // clear selections
      selectedBox = null; selectedHandle = null; selectedPoly = null; selectedVertex = null; polyPoints = [];
      fitAndDraw(); refreshThumbs(); 
    };
    t.appendChild(d);
  });
}

// ---- File handling ----
document.getElementById('fileInput').addEventListener('change', e => {
  const files = Array.from(e.target.files);
  files.forEach(f => {
    const r = new FileReader();
    r.onload = ev => {
      const im = new Image();
      im.onload = () => {
        images.push({ name: f.name, src: ev.target.result, imgEl: im, w: im.naturalWidth, h: im.naturalHeight });
        if (!annotations[f.name]) annotations[f.name] = { mode: mode, shapes: [] };
        if (currentIndex === -1) currentIndex = 0;
        refreshThumbs(); fitAndDraw();
      };
      im.src = ev.target.result;
    };
    r.readAsDataURL(f);
  });
  e.target.value = '';
});
document.getElementById('deleteImageBtn').onclick = () => {
  if (currentIndex < 0) return;
  const img = images[currentIndex];
  images.splice(currentIndex, 1);
  delete annotations[img.name];
  if (currentIndex >= images.length) currentIndex = images.length - 1;
  // reset selections
  selectedBox = null; selectedPoly = null; selectedHandle = null; selectedVertex = null; polyPoints = [];
  fitAndDraw(); refreshThumbs();
};

// ---- Navigation ----
document.getElementById('prevBtn').onclick = () => { if (currentIndex > 0) { currentIndex--; clearSelections(); fitAndDraw(); refreshThumbs(); } };
document.getElementById('nextBtn').onclick = () => { if (currentIndex < images.length - 1) { currentIndex++; clearSelections(); fitAndDraw(); refreshThumbs(); } };
function clearSelections() {
  selectedBox = null; selectedHandle = null; selectedPoly = null; selectedVertex = null; polyPoints = [];
}

// ---- Add Label ----
document.getElementById('addLabelBtn').onclick = () => {
  const v = document.getElementById('labelInput').value.trim();
  if (!v) return;
  if (!labels.includes(v)) { labels.push(v); colors[v] = randColor(); addLabelUI(v); }
  document.getElementById('labelInput').value = '';
};
document.getElementById('labelInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('addLabelBtn').click();
  }
});

// ---- Modes ----
function setMode(m) {
  if (mode === m) return;

  // Clear shapes of the other type for current image (as per your rule)
  const img = getCurrentImage();
  if (img && annotations[img.name]) {
    if (m === 'box') {
      annotations[img.name].shapes = annotations[img.name].shapes.filter(s => s.type !== 'poly');
    } else if (m === 'poly') {
      annotations[img.name].shapes = annotations[img.name].shapes.filter(s => s.type !== 'box');
    }
  }

  mode = m;
  document.getElementById('boxModeBtn').classList.toggle('active', m === 'box');
  document.getElementById('polyModeBtn').classList.toggle('active', m === 'poly');
  document.getElementById('exportCOCO').style.display = (m === 'poly') ? 'inline-block' : 'none';
  document.getElementById('exportMask').style.display = (m === 'poly') ? 'inline-block' : 'none';
  polyPoints = [];
  isDrawing = false;
  selectedBox = null; selectedHandle = null; selectedPoly = null; selectedVertex = null;
  fitAndDraw(); refreshThumbs();
}
document.getElementById('boxModeBtn').onclick = () => setMode('box');
document.getElementById('polyModeBtn').onclick = () => setMode('poly');

// ---- Canvas Events ----
canvas.addEventListener('mousemove', e => {
  if (currentIndex < 0) return;
  const r = canvas.getBoundingClientRect();
  lastX = Math.round(e.clientX - r.left);
  lastY = Math.round(e.clientY - r.top);

  // coord tooltip
  coordBox.style.left = (e.clientX - r.left + 10) + 'px';
  coordBox.style.top = (e.clientY - r.top + 10) + 'px';
  coordBox.textContent = `x:${lastX}, y:${lastY}`;
  coordBox.style.display = 'block';

  let cursor = "default";

  if (mode === 'box') {
    if (selectedBox) {
      const [x, y, w, h] = denormBox(selectedBox);
      const handle = hitHandle(lastX, lastY, x, y, w, h);
      if (handle) cursor = "pointer";
      else if (lastX >= x && lastX <= x+w && lastY >= y && lastY <= y+h) cursor = "move";
    }
    // If resizing with a handle:
    if (selectedBox && selectedHandle && isDrawing) {
      const [x, y, w, h] = denormBox(selectedBox);
      let nx = x, ny = y, nw = w, nh = h;

      if (selectedHandle.pos.includes("t")) { nh += (y - lastY); ny = lastY; }
      if (selectedHandle.pos.includes("b")) { nh = lastY - y; }
      if (selectedHandle.pos.includes("l")) { nw += (x - lastX); nx = lastX; }
      if (selectedHandle.pos.includes("r")) { nw = lastX - x; }

      // Prevent negative sizes
      nw = Math.max(1, nw); nh = Math.max(1, nh);

      selectedBox.xc = (nx + nw/2)/canvas.width;
      selectedBox.yc = (ny + nh/2)/canvas.height;
      selectedBox.w = nw/canvas.width;
      selectedBox.h = nh/canvas.height;
    }
  } else if (mode === 'poly') {
    // hover over vertex while drawing
    if (polyPoints.length > 0) {
      const dispW = canvas.width, dispH = canvas.height;
      for (let i = 0; i < polyPoints.length; i += 2) {
        const vx = polyPoints[i] * dispW;
        const vy = polyPoints[i + 1] * dispH;
        if (Math.abs(lastX - vx) < 6 && Math.abs(lastY - vy) < 6) {
          cursor = "pointer";
          break;
        }
      }
    }
    // dragging a vertex
    if (selectedVertex !== null && isDrawing) {
      polyPoints[selectedVertex] = lastX / canvas.width;
      polyPoints[selectedVertex + 1] = lastY / canvas.height;
    }
  }

  fitAndDraw();
  canvas.style.cursor = cursor;
});

canvas.addEventListener('mouseleave', () => {
  coordBox.style.display = 'none';
  if (!isDrawing) fitAndDraw();
});

canvas.addEventListener('mousedown', e => {
  if (currentIndex < 0) return;

  // Must have active label to annotate
  if (!activeLabel) {
    alert("⚠️ Please create and select a label before annotating.");
    return;
  }

  if (mode === 'box') {
    selectedPoly = null; selectedVertex = null; // clear poly selections

    // Hit test existing boxes (handles first)
    const img = getCurrentImage();
    const ann = annotations[img.name];
    if (ann) {
      for (const s of ann.shapes) {
        if (s.type !== 'box') continue;
        const [x, y, w, h] = denormBox(s);
        const handle = hitHandle(e.offsetX, e.offsetY, x, y, w, h);
        if (handle) {
          selectedBox = s;
          selectedHandle = handle;
          isDrawing = true;
          fitAndDraw();
          return;
        }
        if (e.offsetX >= x && e.offsetX <= x+w && e.offsetY >= y && e.offsetY <= y+h) {
          selectedBox = s; selectedHandle = null; isDrawing = false;
          fitAndDraw();
          return;
        }
      }
    }

    // start new box
    isDrawing = true;
    startX = e.offsetX; startY = e.offsetY;
    lastX = startX; lastY = startY;
    selectedBox = null; selectedHandle = null;

  } else if (mode === 'poly') {
    selectedBox = null; selectedHandle = null; selectedPoly = null;

    // 1) If clicking near an existing in-progress vertex → drag it
    const dispW = canvas.width, dispH = canvas.height;
    for (let i = 0; i < polyPoints.length; i += 2) {
      const vx = polyPoints[i] * dispW;
      const vy = polyPoints[i + 1] * dispH;
      if (Math.abs(e.offsetX - vx) < 6 && Math.abs(e.offsetY - vy) < 6) {
        selectedVertex = i;
        isDrawing = true;
        return;
      }
    }

    // 2) Else add a new vertex at click position
    polyPoints.push(e.offsetX / canvas.width, e.offsetY / canvas.height);
    isDrawing = true;
    fitAndDraw();
  }
});

canvas.addEventListener('mouseup', e => {
  if (mode === 'box') {
    // end resize
    if (selectedHandle && isDrawing) {
      isDrawing = false;
      selectedHandle = null;
      fitAndDraw(); refreshThumbs();
      return;
    }
    // finish new box
    // finish new box
if (isDrawing) {
  isDrawing = false;
  const dx = Math.abs(e.offsetX - startX);
  const dy = Math.abs(e.offsetY - startY);

  // ✅ Only create if dragged more than 5px
  if (dx > 3 && dy > 3) {
    const x1 = Math.min(startX, e.offsetX), y1 = Math.min(startY, e.offsetY);
    const x2 = Math.max(startX, e.offsetX), y2 = Math.max(startY, e.offsetY);
    const w = canvas.width, h = canvas.height;
    const xc = ((x1 + x2) / 2) / w, yc = ((y1 + y2) / 2) / h;
    const bw = (x2 - x1) / w, bh = (y2 - y1) / h;

    const newBox = { type: 'box', xc, yc, w: bw, h: bh, label: activeLabel };
    const ann = ensureAnn(getCurrentImage());

    ann.shapes.push(newBox);
    selectedBox = newBox; // auto-select so handles show immediately
    selectedHandle = null;

    fitAndDraw(); refreshThumbs();
  }
}

  } else if (mode === 'poly') {
    // stop dragging vertex
    if (selectedVertex !== null) {
      selectedVertex = null;
      isDrawing = false;
      fitAndDraw();
    } else {
      isDrawing = false;
    }
  }
});

canvas.addEventListener('dblclick', () => {
  if (mode === 'poly' && polyPoints.length >= 6) {
    // finalize polygon
    ensureAnn(getCurrentImage()).shapes.push({ type: 'poly', points: polyPoints.slice(), label: activeLabel });
    polyPoints = []; isDrawing = false; selectedVertex = null;
    fitAndDraw(); refreshThumbs();
  }
});

// ---- Undo / finalize / delete ----
window.addEventListener('keydown', e => {
  // Undo
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (mode === 'poly' && polyPoints.length > 0) {
      // undo last vertex while drawing
      polyPoints.pop(); polyPoints.pop(); fitAndDraw();
    } else {
      const img = getCurrentImage();
      if (!img) return;
      const arr = ensureAnn(img).shapes;
      if (arr.length) { arr.pop(); selectedBox = null; selectedPoly = null; fitAndDraw(); refreshThumbs(); }
    }
  }

  // Finalize polygon with Enter
  if (e.key === 'Enter' && mode === 'poly' && polyPoints.length >= 6) {
    ensureAnn(getCurrentImage()).shapes.push({ type: 'poly', points: polyPoints.slice(), label: activeLabel });
    polyPoints = []; isDrawing = false; selectedVertex = null;
    fitAndDraw(); refreshThumbs();
  }

  // Delete
  if (e.key === 'Delete') {
    const img = getCurrentImage(); if (!img) return;
    const arr = ensureAnn(img).shapes;

    if (mode === 'poly') {
      if (selectedVertex !== null && polyPoints.length >= 2) {
        // delete the selected vertex in in-progress polygon
        polyPoints.splice(selectedVertex, 2);
        selectedVertex = null;
        fitAndDraw();
        return;
      }
      if (selectedPoly) {
        const idx = arr.indexOf(selectedPoly);
        if (idx >= 0) arr.splice(idx, 1);
        selectedPoly = null;
        fitAndDraw(); refreshThumbs();
        return;
      }
    }
    if (selectedBox) {
      const idx = arr.indexOf(selectedBox);
      if (idx >= 0) arr.splice(idx, 1);
      selectedBox = null;
      fitAndDraw(); refreshThumbs();
    }
  }

  // Quick mode switches / nav (optional)
  if (e.key.toLowerCase() === 'b') setMode('box');
  if (e.key.toLowerCase() === 'p') setMode('poly');
  if (e.key === 'ArrowLeft') document.getElementById('prevBtn').click();
  if (e.key === 'ArrowRight') document.getElementById('nextBtn').click();
});

// ---- Click-to-select finalized polygon (for deletion)
canvas.addEventListener('click', e => {
  if (mode !== 'poly') return;
  if (polyPoints.length > 0) return; // while drawing, don't do selection

  const img = getCurrentImage(); if (!img) return;
  const ann = annotations[img.name]; if (!ann) return;

  // find topmost polygon containing point
  let found = null;
  for (let i = ann.shapes.length - 1; i >= 0; i--) {
    const s = ann.shapes[i];
    if (s.type !== 'poly') continue;
    if (isPointInPoly(s.points, e.offsetX, e.offsetY)) { found = s; break; }
  }
  selectedPoly = found;
  fitAndDraw();
});

// ---- Export YOLO & COCO ----

// ---- Export Binary Mask (selected polygon → white, rest black) ----
function exportBinaryMask() {
  const img = getCurrentImage(); 
  if (!img) return;

  const ann = annotations[img.name];
  if (!ann) return;

  // Collect all polygons (if none, do nothing)
  const polys = ann.shapes.filter(s => s.type === 'poly');
  if (polys.length === 0) return;

  const w = img.w, h = img.h;
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const octx = off.getContext('2d');

  // Fill background black
  octx.fillStyle = '#000';
  octx.fillRect(0, 0, w, h);

  // Fill each polygon white
  octx.fillStyle = '#fff';
  polys.forEach(poly => {
    octx.beginPath();
    octx.moveTo(poly.points[0] * w, poly.points[1] * h);
    for (let i = 2; i < poly.points.length; i += 2) {
      octx.lineTo(poly.points[i] * w, poly.points[i + 1] * h);
    }
    octx.closePath();
    octx.fill();
  });

  // Save as PNG
  off.toBlob(blob => {
    const base = img.name.replace(/\.[^.]+$/, '');
    saveAs(blob, `${base}_mask.png`);
  }, 'image/png');
}


function exportYoloOne() {
  const img = getCurrentImage(); if (!img) return;
  const ann = annotations[img.name]; if (!ann) return;
  let lines = '';
  ann.shapes.forEach(s => {
    if (s.type === 'box') {
      const idx = labels.indexOf(s.label);
      lines += `${idx} ${s.xc} ${s.yc} ${s.w} ${s.h}\n`;
    }
  });
  const blob = new Blob([lines], { type: 'text/plain' });
  const txtName = img.name.replace(/\.[^.]+$/, '') + ".txt";
  saveAs(blob, txtName);
}
function exportYoloAll() {
  const zip = new JSZip();
  images.forEach(img => {
    const ann = annotations[img.name]; if (!ann) return;
    let lines = '';
    ann.shapes.forEach(s => {
      if (s.type === 'box') {
        const idx = labels.indexOf(s.label);
        lines += `${idx} ${s.xc} ${s.yc} ${s.w} ${s.h}\n`;
      }
    });
    const txtName = img.name.replace(/\.[^.]+$/, '') + ".txt";
    zip.file(txtName, lines);
  });
  zip.generateAsync({ type: 'blob' }).then(c => saveAs(c, 'annotations.zip'));
}

function exportCOCO() {
  let coco = { images: [], annotations: [], categories: [] };
  labels.forEach((l, i) => coco.categories.push({ id: i + 1, name: l }));
  images.forEach((img, i) => {
    coco.images.push({ id: i + 1, file_name: img.name, width: img.w, height: img.h });
    const ann = annotations[img.name]; if (!ann) return;
    ann.shapes.forEach((s, j) => {
      if (s.type === 'poly') {
        coco.annotations.push({
          id: `${i + 1}_${j + 1}`,
          image_id: i + 1,
          category_id: labels.indexOf(s.label) + 1,
          segmentation: [s.points.map((v, idx) => idx % 2 === 0 ? v * img.w : v * img.h)],
          iscrowd: 0
        });
      }
    });
  });
  const blob = new Blob([JSON.stringify(coco, null, 2)], { type: 'application/json' });
  saveAs(blob, 'annotations_coco.json');
}
document.getElementById('exportOne').onclick = exportYoloOne;
document.getElementById('exportAll').onclick = exportYoloAll;
document.getElementById('exportCOCO').onclick = exportCOCO;
document.getElementById('exportMask').onclick = exportBinaryMask;

