const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const MODELS = {
  anime: 'https://huggingface.co/skillsafe-ai/realesrgan-x4plus-anime-6b/resolve/main/model.onnx',
  general: 'https://huggingface.co/Heliosoph/realesrgan-onnx/resolve/main/realesr-general-x4v3.onnx'
};

const state = {
  originalBitmap: null,
  originalCanvas: null,
  upscaledCanvas: null,
  previewMode: 'original',
  session: null,
  sessionModel: null,
  sessionTileSignature: null,
  backend: 'wasm',
  graphCapture: false,
  splitCanvases: [],
  guideCols: 0,
  guideRows: 0,
  verticalGuides: [],
  horizontalGuides: [],
  selectedGuide: { axis: 'vertical', index: 0 },
  guidesVisible: false
};

const fileInput = $('#fileInput');
const workspace = $('#workspace');
const previewCanvas = $('#previewCanvas');
const pctx = previewCanvas.getContext('2d');
const backendBadge = $('#backendBadge');

function setProgress(label, percent) {
  $('#progressWrap').classList.remove('hidden');
  $('#progressLabel').textContent = label;
  $('#progressPercent').textContent = `${Math.round(percent)}%`;
  $('#progressBar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
}
function hideProgress() { setTimeout(() => $('#progressWrap').classList.add('hidden'), 700); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function detectBackend() {
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        state.backend = 'webgpu';
        backendBadge.textContent = 'WebGPU · GPU 가속';
        $('#engineHint').textContent = 'GPU 가속 감지됨 · 자동 모드는 큰 타일을 사용합니다.';
        return;
      }
    }
  } catch (_) {}
  state.backend = 'wasm';
  backendBadge.textContent = 'WASM · CPU 모드';
  $('#engineHint').textContent = 'GPU 가속이 없어 CPU로 처리됩니다. 속도가 크게 느릴 수 있습니다.';
}
detectBackend();

async function loadFile(file) {
  if (!file) return;
  const bmp = await createImageBitmap(file);
  state.originalBitmap = bmp;
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d', {willReadFrequently:true}).drawImage(bmp,0,0);
  state.originalCanvas = c;
  state.upscaledCanvas = null;
  state.splitCanvases = [];
  state.guideCols = 0;
  state.guideRows = 0;
  state.verticalGuides = [];
  state.horizontalGuides = [];
  state.guidesVisible = false;
  $('#guideLayer').classList.add('hidden');
  state.previewMode = 'original';
  $('.tab[data-preview="original"]').classList.add('active');
  $('.tab[data-preview="upscaled"]').classList.remove('active');
  workspace.classList.remove('hidden');
  $('#resultsSection').classList.add('hidden');
  $('#fileMeta').classList.remove('hidden');
  $('#fileMeta').textContent = `${file.name} · ${bmp.width} × ${bmp.height}px · ${(file.size/1024/1024).toFixed(2)}MB`;
  drawPreview();
}

fileInput.addEventListener('change', e => loadFile(e.target.files[0]));
const dropzone = $('#dropzone');
['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => {e.preventDefault(); dropzone.style.borderColor='#ffd400';}));
['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => {e.preventDefault(); dropzone.style.borderColor='';}));
dropzone.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));

$$('.tab').forEach(btn => btn.addEventListener('click', () => {
  const mode = btn.dataset.preview;
  if (mode === 'upscaled' && !state.upscaledCanvas) return alert('먼저 전체 이미지 AI 업스케일을 실행해주세요.');
  state.previewMode = mode;
  $$('.tab').forEach(x=>x.classList.toggle('active',x===btn));
  drawPreview();
}));

function drawPreview() {
  const src = state.previewMode === 'upscaled' ? state.upscaledCanvas : state.originalCanvas;
  if (!src) return;
  const maxW = 1000, maxH = 900;
  const scale = Math.min(maxW/src.width, maxH/src.height, 1);
  previewCanvas.width = Math.max(1, Math.round(src.width*scale));
  previewCanvas.height = Math.max(1, Math.round(src.height*scale));
  pctx.clearRect(0,0,previewCanvas.width,previewCanvas.height);
  pctx.drawImage(src,0,0,previewCanvas.width,previewCanvas.height);
  layoutGuideLayer();
  renderGuideLines();
}

function equalGuides(n) {
  return Array.from({length:n-1}, (_,i)=>(i+1)/n);
}

function getSplitCounts(){
  return {
    cols: Math.max(1, Math.min(4, Number($('#colsSelect').value) || 1)),
    rows: Math.max(1, Math.min(4, Number($('#rowsSelect').value) || 1))
  };
}

function ensureGuides(force=false) {
  const {cols, rows} = getSplitCounts();
  if (force || state.guideCols !== cols || state.guideRows !== rows || state.verticalGuides.length !== cols-1 || state.horizontalGuides.length !== rows-1) {
    state.guideCols = cols;
    state.guideRows = rows;
    state.verticalGuides = equalGuides(cols);
    state.horizontalGuides = equalGuides(rows);
    if (state.verticalGuides.length) state.selectedGuide = {axis:'vertical', index:0};
    else if (state.horizontalGuides.length) state.selectedGuide = {axis:'horizontal', index:0};
    else state.selectedGuide = {axis:'vertical', index:-1};
  }
  populateGuideSelect();
}

function layoutGuideLayer(){
  const layer=$('#guideLayer');
  if(!previewCanvas.width || !previewCanvas.height) return;
  const stage=$('.preview-stage');
  const sr=stage.getBoundingClientRect();
  const cr=previewCanvas.getBoundingClientRect();
  layer.style.left=`${cr.left-sr.left}px`;
  layer.style.top=`${cr.top-sr.top}px`;
  layer.style.width=`${cr.width}px`;
  layer.style.height=`${cr.height}px`;
}

function guideName(axis,index){
  return `${axis==='vertical'?'세로':'가로'} 분할선 ${index+1}`;
}

function populateGuideSelect(){
  const select=$('#guideSelect');
  if(!select) return;
  const prev=`${state.selectedGuide.axis}:${state.selectedGuide.index}`;
  select.innerHTML='';
  state.verticalGuides.forEach((_,i)=>{ const o=document.createElement('option'); o.value=`vertical:${i}`; o.textContent=`세로선 ${i+1}`; select.appendChild(o); });
  state.horizontalGuides.forEach((_,i)=>{ const o=document.createElement('option'); o.value=`horizontal:${i}`; o.textContent=`가로선 ${i+1}`; select.appendChild(o); });
  if (!select.options.length) {
    const o=document.createElement('option'); o.value=''; o.textContent='분할선 없음'; select.appendChild(o); select.disabled=true;
    state.selectedGuide={axis:'vertical',index:-1};
  } else {
    select.disabled=false;
    const exists=[...select.options].some(o=>o.value===prev);
    select.value=exists?prev:(select.options[0]?.value||'');
    if(select.value){ const [axis,idx]=select.value.split(':'); state.selectedGuide={axis,index:Number(idx)}; }
  }
  updateGuideControls();
}

function renderGuideLines(){
  ensureGuides(false);
  const layer=$('#guideLayer');
  layoutGuideLayer();
  layer.innerHTML='';
  const make=(axis,pos,index)=>{
    const line=document.createElement('div');
    line.className=`guide-line ${axis}${state.selectedGuide.axis===axis&&state.selectedGuide.index===index?' selected':''}`;
    line.dataset.axis=axis; line.dataset.index=String(index);
    if(axis==='vertical') line.style.left=`${pos*100}%`; else line.style.top=`${pos*100}%`;
    line.title=`${guideName(axis,index)} · 드래그해서 이동`;
    line.addEventListener('pointerdown',startGuideDrag);
    line.addEventListener('click',()=>selectGuide(axis,index));
    layer.appendChild(line);
  };
  state.verticalGuides.forEach((p,i)=>make('vertical',p,i));
  state.horizontalGuides.forEach((p,i)=>make('horizontal',p,i));
  layer.classList.toggle('hidden',!state.guidesVisible);
  updateGuideControls();
}

function selectGuide(axis,index){
  state.selectedGuide={axis,index};
  const select=$('#guideSelect'); if(select) select.value=`${axis}:${index}`;
  renderGuideLines();
}

function clampGuide(axis,index,value){
  const arr=axis==='vertical'?state.verticalGuides:state.horizontalGuides;
  const src=state.previewMode==='upscaled'&&state.upscaledCanvas?state.upscaledCanvas:state.originalCanvas;
  const dim=axis==='vertical'?(src?.width||1000):(src?.height||1000);
  const minGap=Math.max(2/dim,0.002);
  const low=index===0?minGap:arr[index-1]+minGap;
  const high=index===arr.length-1?1-minGap:arr[index+1]-minGap;
  return Math.max(low,Math.min(high,value));
}

function setGuidePosition(axis,index,value){
  const arr=axis==='vertical'?state.verticalGuides:state.horizontalGuides;
  arr[index]=clampGuide(axis,index,value);
  renderGuideLines();
}

function startGuideDrag(e){
  e.preventDefault();
  const line=e.currentTarget;
  const axis=line.dataset.axis, index=Number(line.dataset.index);
  state.selectedGuide={axis,index};
  line.setPointerCapture?.(e.pointerId);
  const move=(ev)=>{
    const rect=$('#guideLayer').getBoundingClientRect();
    const raw=axis==='vertical'?(ev.clientX-rect.left)/rect.width:(ev.clientY-rect.top)/rect.height;
    setGuidePosition(axis,index,raw);
  };
  const end=()=>{ window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',end); };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',end,{once:true});
  selectGuide(axis,index);
}

function updateGuideControls(){
  const {axis,index}=state.selectedGuide;
  const arr=axis==='vertical'?state.verticalGuides:state.horizontalGuides;
  const pos=arr[index];
  const src=state.previewMode==='upscaled'&&state.upscaledCanvas?state.upscaledCanvas:state.originalCanvas;
  if(Number.isFinite(pos) && src){
    const px=Math.round(pos*(axis==='vertical'?src.width:src.height));
    $('#guidePositionMeta').textContent=`${guideName(axis,index)} · ${px}px (${(pos*100).toFixed(2)}%)`;
  } else $('#guidePositionMeta').textContent='';
  const valid = Number.isInteger(index) && index >= 0 && Number.isFinite(pos);
  $('#nudgeLeftBtn').disabled=!valid || axis!=='vertical';
  $('#nudgeRightBtn').disabled=!valid || axis!=='vertical';
  $('#nudgeUpBtn').disabled=!valid || axis!=='horizontal';
  $('#nudgeDownBtn').disabled=!valid || axis!=='horizontal';
}

function nudgeSelected(delta){
  const {axis,index}=state.selectedGuide;
  const arr=axis==='vertical'?state.verticalGuides:state.horizontalGuides;
  if(!arr.length || !Number.isFinite(arr[index])) return;
  const src=state.previewMode==='upscaled'&&state.upscaledCanvas?state.upscaledCanvas:state.originalCanvas;
  const dim=axis==='vertical'?(src?.width||1):(src?.height||1);
  setGuidePosition(axis,index,arr[index]+delta/dim);
}

['#colsSelect','#rowsSelect'].forEach(sel => $(sel).addEventListener('change',()=>{ ensureGuides(true); state.guidesVisible=true; $('#showGridBtn').textContent='분할선 숨기기'; renderGuideLines(); }));
$('#showGridBtn').addEventListener('click',()=>{
  ensureGuides(false); state.guidesVisible=!state.guidesVisible;
  $('#showGridBtn').textContent=state.guidesVisible?'분할선 숨기기':'분할선 편집';
  renderGuideLines();
});
$('#resetGuidesBtn').addEventListener('click',()=>{ ensureGuides(true); state.guidesVisible=true; $('#showGridBtn').textContent='분할선 숨기기'; renderGuideLines(); });
$('#guideSelect').addEventListener('change',e=>{ if(!e.target.value) return; const [axis,idx]=e.target.value.split(':'); state.selectedGuide={axis,index:Number(idx)}; renderGuideLines(); });
$('#nudgeLeftBtn').addEventListener('click',()=>nudgeSelected(-1));
$('#nudgeRightBtn').addEventListener('click',()=>nudgeSelected(1));
$('#nudgeUpBtn').addEventListener('click',()=>nudgeSelected(-1));
$('#nudgeDownBtn').addEventListener('click',()=>nudgeSelected(1));
window.addEventListener('resize',()=>{ layoutGuideLayer(); renderGuideLines(); });

function selectedTileSize() {
  const value = $('#tileSelect').value;
  if (value !== 'auto') return Number(value);
  return state.backend === 'webgpu' ? 512 : 128;
}

function fallbackTileSizes(start) {
  const all = state.backend === 'webgpu' ? [512,384,320,256,192,128,96,64] : [128,96,64];
  const idx = all.findIndex(v => v <= start);
  return idx >= 0 ? all.slice(idx) : all;
}

async function createSession(modelKey, tileSize, overlap, useGraphCapture) {
  setProgress('AI 모델 불러오는 중...', 1);
  if (ort?.env?.wasm) {
    ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
    ort.env.wasm.simd = true;
  }
  const options = {
    executionProviders: state.backend === 'webgpu'
      ? [{name:'webgpu', preferredLayout:'NCHW', validationMode:'disabled', storageBufferCacheMode:'bucket'}, 'wasm']
      : ['wasm'],
    graphOptimizationLevel: 'all',
    enableGraphCapture: !!(state.backend === 'webgpu' && useGraphCapture)
  };
  const session = await ort.InferenceSession.create(MODELS[modelKey], options);
  state.session = session;
  state.sessionModel = modelKey;
  state.sessionTileSignature = `${tileSize}:${overlap}:${options.enableGraphCapture}`;
  state.graphCapture = options.enableGraphCapture;
  setProgress(`AI 모델 준비 완료 · ${state.backend === 'webgpu' ? 'WebGPU' : 'WASM'}`, 4);
  return session;
}

async function ensureSession(tileSize, overlap, useGraphCapture=true) {
  const modelKey = $('#modelSelect').value;
  const signature = `${tileSize}:${overlap}:${!!(state.backend === 'webgpu' && useGraphCapture)}`;
  if (state.session && state.sessionModel === modelKey && state.sessionTileSignature === signature) return state.session;
  try {
    return await createSession(modelKey, tileSize, overlap, useGraphCapture);
  } catch (err) {
    console.error(err);
    throw new Error('AI 모델을 불러오지 못했습니다. 인터넷 연결과 브라우저를 확인해주세요.');
  }
}

function canvasFromImageData(imgData){
  const c=document.createElement('canvas'); c.width=imgData.width; c.height=imgData.height;
  c.getContext('2d').putImageData(imgData,0,0); return c;
}

function imageDataToTensor(imageData){
  const {data,width,height}=imageData;
  const plane=width*height;
  const arr=new Float32Array(plane*3);
  for(let i=0;i<plane;i++){
    arr[i]=data[i*4]/255;
    arr[plane+i]=data[i*4+1]/255;
    arr[plane*2+i]=data[i*4+2]/255;
  }
  return new ort.Tensor('float32',arr,[1,3,height,width]);
}

function tensorToImageData(tensor, width, height){
  const out=new ImageData(width,height);
  const plane=width*height;
  const d=tensor.data;
  for(let i=0;i<plane;i++){
    out.data[i*4]=Math.max(0,Math.min(255,Math.round(d[i]*255)));
    out.data[i*4+1]=Math.max(0,Math.min(255,Math.round(d[plane+i]*255)));
    out.data[i*4+2]=Math.max(0,Math.min(255,Math.round(d[plane*2+i]*255)));
    out.data[i*4+3]=255;
  }
  return out;
}

async function upscaleTile(session, imageData){
  const input=imageDataToTensor(imageData);
  const feeds={};
  feeds[session.inputNames[0] || 'input']=input;
  const results=await session.run(feeds);
  const out=results[session.outputNames[0] || Object.keys(results)[0]];
  return tensorToImageData(out,out.dims[3],out.dims[2]);
}

// Fixed-size padded tile keeps the tensor shape constant, allowing WebGPU graph capture.
function getPaddedTile(srcCanvas, x, y, coreSize, pad) {
  const size = coreSize + pad*2;
  const t = document.createElement('canvas'); t.width=size; t.height=size;
  const ctx=t.getContext('2d',{willReadFrequently:true});
  const sw=srcCanvas.width, sh=srcCanvas.height;
  const sx=Math.max(0,x-pad), sy=Math.max(0,y-pad);
  const ex=Math.min(sw,x+coreSize+pad), ey=Math.min(sh,y+coreSize+pad);
  const dw=ex-sx, dh=ey-sy;
  const dx=sx-(x-pad), dy=sy-(y-pad);
  ctx.drawImage(srcCanvas,sx,sy,dw,dh,dx,dy,dw,dh);
  // Edge replication for padding outside the image.
  if (dx>0) ctx.drawImage(t,dx,0,1,size,0,0,dx,size);
  if (dy>0) ctx.drawImage(t,0,dy,size,1,0,0,size,dy);
  const right=size-(dx+dw); if(right>0) ctx.drawImage(t,dx+dw-1,0,1,size,dx+dw,0,right,size);
  const bottom=size-(dy+dh); if(bottom>0) ctx.drawImage(t,0,dy+dh-1,size,1,0,dy+dh,size,bottom);
  return ctx.getImageData(0,0,size,size);
}

async function upscaleWithTilesAttempt(srcCanvas, coreSize, overlap, progressBase=4, progressSpan=94) {
  let session = await ensureSession(coreSize, overlap, true);
  const scale=4, sw=srcCanvas.width, sh=srcCanvas.height;
  const out=document.createElement('canvas'); out.width=sw*scale; out.height=sh*scale;
  const octx=out.getContext('2d');
  const xs=[]; for(let x=0;x<sw;x+=coreSize) xs.push(x);
  const ys=[]; for(let y=0;y<sh;y+=coreSize) ys.push(y);
  const total=xs.length*ys.length; let done=0;

  for(const y of ys){
    for(const x of xs){
      const tileData=getPaddedTile(srcCanvas,x,y,coreSize,overlap);
      let up;
      try {
        up=await upscaleTile(session,tileData);
      } catch(err) {
        // Some dynamic models do not support graph capture. Retry once without it.
        if (state.graphCapture) {
          console.warn('Graph capture failed; retrying without it.', err);
          state.session=null;
          session=await ensureSession(coreSize, overlap, false);
          up=await upscaleTile(session,tileData);
        } else {
          throw err;
        }
      }
      const tc=canvasFromImageData(up);
      const actualW=Math.min(coreSize,sw-x), actualH=Math.min(coreSize,sh-y);
      const crop=overlap*scale;
      octx.drawImage(tc,crop,crop,actualW*scale,actualH*scale,x*scale,y*scale,actualW*scale,actualH*scale);
      done++;
      setProgress(`AI 업스케일 · ${coreSize}px 타일 · ${done}/${total}`,progressBase+(done/total)*progressSpan);
      await sleep(0);
    }
  }
  return out;
}

async function upscaleWithAutoFallback(srcCanvas) {
  const preferred=selectedTileSize();
  const overlap=Number($('#overlapSelect').value);
  if(overlap*2>=preferred) throw new Error('겹침 값이 타일 크기에 비해 너무 큽니다.');
  const candidates = $('#tileSelect').value === 'auto' ? fallbackTileSizes(preferred) : [preferred];
  let lastError;
  for(let i=0;i<candidates.length;i++){
    const tile=candidates[i];
    try {
      $('#activePreset').textContent = `현재 처리: ${tile}px / ${overlap}px · ${state.backend.toUpperCase()}`;
      return await upscaleWithTilesAttempt(srcCanvas,tile,overlap);
    } catch(err) {
      console.warn(`Tile ${tile} failed`,err);
      lastError=err;
      state.session=null;
      if(i<candidates.length-1) setProgress(`메모리 부족 · ${candidates[i+1]}px로 자동 재시도`,3);
      await sleep(50);
    }
  }
  throw new Error(`AI 처리 중 메모리 오류가 발생했습니다. ${lastError?.message || ''}`);
}

$('#upscaleBtn').addEventListener('click', async () => {
  if(!state.originalCanvas) return;
  const btn=$('#upscaleBtn'); btn.disabled=true;
  try{
    state.upscaledCanvas=await upscaleWithAutoFallback(state.originalCanvas);
    state.previewMode='upscaled';
    $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.preview==='upscaled'));
    drawPreview();
    setProgress(`완료 · ${state.upscaledCanvas.width} × ${state.upscaledCanvas.height}px`,100);
    hideProgress();
  }catch(err){ alert(err.message || String(err)); $('#progressWrap').classList.add('hidden'); }
  finally{btn.disabled=false;}
});

function getSplitSource(){
  const choice=$('#sourceSelect').value;
  if(choice==='upscaled'){
    if(!state.upscaledCanvas) throw new Error('먼저 전체 AI 업스케일을 실행하거나 분할 대상을 원본으로 변경해주세요.');
    return state.upscaledCanvas;
  }
  return state.originalCanvas;
}

function splitCanvas(src){
  const {cols, rows}=getSplitCounts();
  ensureGuides(false);
  const trim=Math.max(0,Number($('#trimInput').value)||0);
  const xs=[0,...state.verticalGuides,1].map(v=>Math.round(v*src.width));
  const ys=[0,...state.horizontalGuides,1].map(v=>Math.round(v*src.height));
  const pieces=[];
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const x0=xs[c], y0=ys[r], x1=xs[c+1], y1=ys[r+1];
      const sx=Math.min(x1-1,x0+trim), sy=Math.min(y1-1,y0+trim);
      const sw=Math.max(1,(x1-x0)-trim*2), sh=Math.max(1,(y1-y0)-trim*2);
      const out=document.createElement('canvas'); out.width=sw; out.height=sh;
      out.getContext('2d').drawImage(src,sx,sy,sw,sh,0,0,sw,sh);
      pieces.push(out);
    }
  }
  return pieces;
}

async function splitImage(){
  state.splitCanvases=splitCanvas(getSplitSource());
  renderResults();
}

$('#splitBtn').addEventListener('click',()=>{try{state.guidesVisible=true; $('#showGridBtn').textContent='분할선 숨기기'; renderGuideLines(); splitImage()}catch(err){alert(err.message)}});

// Recommended workflow for 4x4 grids: split first, then upscale each scene.
$('#splitUpscaleBtn').addEventListener('click', async()=>{
  if(!state.originalCanvas) return;
  const btn=$('#splitUpscaleBtn'); btn.disabled=true;
  try{
    const pieces=splitCanvas(state.originalCanvas);
    const outputs=[];
    for(let i=0;i<pieces.length;i++){
      setProgress(`장면 ${i+1}/${pieces.length} 준비 중`,(i/pieces.length)*100);
      const up=await upscaleWithAutoFallback(pieces[i]);
      outputs.push(up);
    }
    state.splitCanvases=outputs;
    renderResults();
    setProgress(`완료 · ${outputs.length}장 고화질 업스케일`,100);
    hideProgress();
  }catch(err){ alert(err.message || String(err)); $('#progressWrap').classList.add('hidden'); }
  finally{btn.disabled=false;}
});

function renderResults(){
  const wrap=$('#resultGrid'); wrap.innerHTML='';
  const {cols, rows}=getSplitCounts();
  wrap.style.gridTemplateColumns=`repeat(${Math.min(cols,4)},minmax(0,1fr))`;
  state.splitCanvases.forEach((c,i)=>{
    const item=document.createElement('div'); item.className='result-item';
    const img=document.createElement('img'); img.src=c.toDataURL('image/jpeg',.86);
    const footer=document.createElement('div'); footer.className='result-footer';
    const name=`scene_${String(i+1).padStart(2,'0')}`;
    const label=document.createElement('span'); label.textContent=name;
    const b=document.createElement('button'); b.textContent='PNG';
    b.addEventListener('click',async()=>downloadBlob(await canvasToBlob(c),`${name}.png`));
    footer.append(label,b); item.append(img,footer); wrap.append(item);
  });
  $('#resultMeta').textContent=`${cols} × ${rows} · ${state.splitCanvases.length}장 · 첫 장 ${state.splitCanvases[0]?.width||0} × ${state.splitCanvases[0]?.height||0}px`;
  $('#resultsSection').classList.remove('hidden');
  $('#resultsSection').scrollIntoView({behavior:'smooth',block:'start'});
}

function canvasToBlob(canvas,type='image/png',quality=1){
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('이미지 변환 실패')),type,quality));
}
function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

$('#downloadZipBtn').addEventListener('click',async()=>{
  if(!state.splitCanvases.length) return;
  const btn=$('#downloadZipBtn'); btn.disabled=true; btn.textContent='ZIP 만드는 중...';
  try{
    const zip=new JSZip();
    for(let i=0;i<state.splitCanvases.length;i++){
      const name=`scene_${String(i+1).padStart(2,'0')}.png`;
      zip.file(name,await canvasToBlob(state.splitCanvases[i]));
    }
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:4}});
    downloadBlob(blob,`scenes_${state.splitCanvases.length}.zip`);
  }finally{btn.disabled=false;btn.textContent='전체 ZIP 저장';}
});
