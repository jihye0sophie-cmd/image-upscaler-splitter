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
  backend: 'wasm',
  splitCanvases: []
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
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        state.backend = 'webgpu';
        backendBadge.textContent = 'WebGPU · GPU 가속';
        return;
      }
    }
  } catch (_) {}
  state.backend = 'wasm';
  backendBadge.textContent = 'WASM · CPU 모드';
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
  if (mode === 'upscaled' && !state.upscaledCanvas) return alert('먼저 AI 업스케일을 실행해주세요.');
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
  updateGridOverlay();
}

function updateGridOverlay(){
  const overlay = $('#gridOverlay');
  const n = Number($('#gridSelect').value);
  overlay.style.backgroundSize = `${100/n}% ${100/n}%`;
}
$('#gridSelect').addEventListener('change',updateGridOverlay);
$('#showGridBtn').addEventListener('click',()=>$('#gridOverlay').classList.toggle('hidden'));

async function ensureSession() {
  const modelKey = $('#modelSelect').value;
  if (state.session && state.sessionModel === modelKey) return state.session;
  setProgress('AI 모델 불러오는 중...', 1);
  const eps = state.backend === 'webgpu' ? ['webgpu','wasm'] : ['wasm'];
  try {
    if (ort?.env?.wasm) {
      ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
      ort.env.wasm.simd = true;
    }
    state.session = await ort.InferenceSession.create(MODELS[modelKey], {
      executionProviders: eps,
      graphOptimizationLevel: 'all'
    });
    state.sessionModel = modelKey;
    setProgress('AI 모델 준비 완료', 5);
    return state.session;
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
  const oh=out.dims[2], ow=out.dims[3];
  return tensorToImageData(out,ow,oh);
}

async function upscaleWithTiles(srcCanvas, tileSize, overlap) {
  const session=await ensureSession();
  const scale=4;
  const sw=srcCanvas.width, sh=srcCanvas.height;
  const out=document.createElement('canvas'); out.width=sw*scale; out.height=sh*scale;
  const octx=out.getContext('2d');
  const sctx=srcCanvas.getContext('2d',{willReadFrequently:true});
  const step=Math.max(16,tileSize-overlap*2);
  const xs=[]; for(let x=0;x<sw;x+=step) xs.push(x);
  const ys=[]; for(let y=0;y<sh;y+=step) ys.push(y);
  const total=xs.length*ys.length; let done=0;

  for(const y0 of ys){
    for(const x0 of xs){
      const x=Math.max(0,x0-overlap), y=Math.max(0,y0-overlap);
      const w=Math.min(tileSize,sw-x), h=Math.min(tileSize,sh-y);
      const img=sctx.getImageData(x,y,w,h);
      let up;
      try { up=await upscaleTile(session,img); }
      catch(err){
        console.error('tile failed',x,y,w,h,err);
        throw new Error(`AI 처리 중 메모리 오류가 발생했습니다. 타일 크기를 더 낮춰주세요. (${w}×${h})`);
      }
      const tc=canvasFromImageData(up);
      const leftCrop=(x0===0?0:overlap)*scale;
      const topCrop=(y0===0?0:overlap)*scale;
      const rightCrop=(x+w>=sw?0:overlap)*scale;
      const bottomCrop=(y+h>=sh?0:overlap)*scale;
      const sx=leftCrop, sy=topCrop;
      const sww=tc.width-leftCrop-rightCrop, shh=tc.height-topCrop-bottomCrop;
      const dx=(x*scale)+leftCrop, dy=(y*scale)+topCrop;
      octx.drawImage(tc,sx,sy,sww,shh,dx,dy,sww,shh);
      done++;
      setProgress(`AI 업스케일 처리 중 · ${done}/${total} 타일`,5+(done/total)*93);
      await sleep(0);
    }
  }
  return out;
}

$('#upscaleBtn').addEventListener('click', async () => {
  if(!state.originalCanvas) return;
  const btn=$('#upscaleBtn'); btn.disabled=true;
  try{
    const tile=Number($('#tileSelect').value), overlap=Number($('#overlapSelect').value);
    if(overlap*2>=tile) throw new Error('겹침 값이 타일 크기에 비해 너무 큽니다.');
    state.upscaledCanvas=await upscaleWithTiles(state.originalCanvas,tile,overlap);
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
    if(!state.upscaledCanvas) throw new Error('먼저 AI 업스케일을 실행하거나 분할 대상을 원본으로 변경해주세요.');
    return state.upscaledCanvas;
  }
  return state.originalCanvas;
}

function canvasToBlob(canvas,type='image/png',quality=1){
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('이미지 변환 실패')),type,quality));
}

async function splitImage(){
  const src=getSplitSource();
  const n=Number($('#gridSelect').value);
  const trim=Math.max(0,Number($('#trimInput').value)||0);
  const cellW=src.width/n, cellH=src.height/n;
  const pieces=[];
  for(let r=0;r<n;r++){
    for(let c=0;c<n;c++){
      const x0=Math.round(c*cellW), y0=Math.round(r*cellH);
      const x1=Math.round((c+1)*cellW), y1=Math.round((r+1)*cellH);
      const sx=x0+trim, sy=y0+trim;
      const sw=Math.max(1,(x1-x0)-trim*2), sh=Math.max(1,(y1-y0)-trim*2);
      const out=document.createElement('canvas'); out.width=sw; out.height=sh;
      out.getContext('2d').drawImage(src,sx,sy,sw,sh,0,0,sw,sh);
      pieces.push(out);
    }
  }
  state.splitCanvases=pieces;
  renderResults();
}

function renderResults(){
  const wrap=$('#resultGrid'); wrap.innerHTML='';
  const n=Number($('#gridSelect').value);
  wrap.style.gridTemplateColumns=`repeat(${Math.min(n,4)},minmax(0,1fr))`;
  state.splitCanvases.forEach((c,i)=>{
    const item=document.createElement('div'); item.className='result-item';
    const img=document.createElement('img'); img.src=c.toDataURL('image/jpeg',.88);
    const footer=document.createElement('div'); footer.className='result-footer';
    const name=`scene_${String(i+1).padStart(2,'0')}`;
    const label=document.createElement('span'); label.textContent=name;
    const b=document.createElement('button'); b.textContent='PNG';
    b.addEventListener('click',async()=>downloadBlob(await canvasToBlob(c),`${name}.png`));
    footer.append(label,b); item.append(img,footer); wrap.append(item);
  });
  $('#resultMeta').textContent=`${state.splitCanvases.length}장 · ${state.splitCanvases[0]?.width||0} × ${state.splitCanvases[0]?.height||0}px`;
  $('#resultsSection').classList.remove('hidden');
  $('#resultsSection').scrollIntoView({behavior:'smooth',block:'start'});
}

$('#splitBtn').addEventListener('click',()=>{try{splitImage()}catch(err){alert(err.message)}});

function downloadBlob(blob,name){
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
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
