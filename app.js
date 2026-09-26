const $ = (id) => document.getElementById(id);
const fileInput = $('fileInput');
const dropzone = $('dropzone');
const fileMeta = $('fileMeta');
const workspace = $('workspace');
const previewCanvas = $('previewCanvas');
const previewStage = $('previewStage');
const guideLayer = $('guideLayer');
const colsSelect = $('colsSelect');
const rowsSelect = $('rowsSelect');
const trimInput = $('trimInput');
const formatSelect = $('formatSelect');
const resetGuidesBtn = $('resetGuidesBtn');
const guideSelect = $('guideSelect');
const guidePositionMeta = $('guidePositionMeta');
const splitBtn = $('splitBtn');
const resultsSection = $('resultsSection');
const resultMeta = $('resultMeta');
const resultGrid = $('resultGrid');
const downloadZipBtn = $('downloadZipBtn');
const nudgeLeftBtn = $('nudgeLeftBtn');
const nudgeRightBtn = $('nudgeRightBtn');
const nudgeUpBtn = $('nudgeUpBtn');
const nudgeDownBtn = $('nudgeDownBtn');

let sourceImage = null;
let sourceName = 'image';
let verticalGuides = [];
let horizontalGuides = [];
let selectedGuide = null; // {axis:'v'|'h', index}
let splitResults = [];

function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function baseName(name){return name.replace(/\.[^.]+$/,'') || 'image';}
function formatExt(){return formatSelect.value === 'jpeg' ? 'jpg' : formatSelect.value;}
function mimeType(){return formatSelect.value === 'jpeg' ? 'image/jpeg' : `image/${formatSelect.value}`;}

async function loadFile(file){
  if(!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    sourceImage = img;
    sourceName = baseName(file.name);
    drawPreview();
    resetGuides();
    fileMeta.textContent = `${file.name} · ${img.naturalWidth}×${img.naturalHeight}px`;
    fileMeta.classList.remove('hidden');
    workspace.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

fileInput.addEventListener('change', e => loadFile(e.target.files[0]));
['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, e => {e.preventDefault(); dropzone.classList.add('drag');}));
['dragleave','drop'].forEach(evt => dropzone.addEventListener(evt, e => {e.preventDefault(); dropzone.classList.remove('drag');}));
dropzone.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));

function drawPreview(){
  if(!sourceImage) return;
  const maxW = Math.min(900, previewStage.clientWidth || 900);
  const maxH = Math.min(window.innerHeight * .68, 760);
  const s = Math.min(maxW/sourceImage.naturalWidth, maxH/sourceImage.naturalHeight, 1);
  previewCanvas.width = Math.max(1, Math.round(sourceImage.naturalWidth*s));
  previewCanvas.height = Math.max(1, Math.round(sourceImage.naturalHeight*s));
  const ctx = previewCanvas.getContext('2d');
  ctx.clearRect(0,0,previewCanvas.width,previewCanvas.height);
  ctx.drawImage(sourceImage,0,0,previewCanvas.width,previewCanvas.height);
  alignGuideLayer();
  renderGuides();
}

function alignGuideLayer(){
  const stageRect = previewStage.getBoundingClientRect();
  const canvasRect = previewCanvas.getBoundingClientRect();
  guideLayer.style.left = `${canvasRect.left-stageRect.left}px`;
  guideLayer.style.top = `${canvasRect.top-stageRect.top}px`;
  guideLayer.style.width = `${canvasRect.width}px`;
  guideLayer.style.height = `${canvasRect.height}px`;
  guideLayer.style.right = 'auto';
  guideLayer.style.bottom = 'auto';
}

function resetGuides(){
  const cols = Number(colsSelect.value);
  const rows = Number(rowsSelect.value);
  verticalGuides = Array.from({length:Math.max(0,cols-1)},(_,i)=>(i+1)/cols);
  horizontalGuides = Array.from({length:Math.max(0,rows-1)},(_,i)=>(i+1)/rows);
  selectedGuide = verticalGuides.length ? {axis:'v',index:0} : (horizontalGuides.length ? {axis:'h',index:0}:null);
  renderGuides();
  buildGuideSelect();
  clearResults();
}

function clearResults(){splitResults=[]; resultsSection.classList.add('hidden'); resultGrid.innerHTML='';}

function renderGuides(){
  guideLayer.innerHTML='';
  verticalGuides.forEach((pos,i)=>guideLayer.appendChild(makeGuide('v',i,pos)));
  horizontalGuides.forEach((pos,i)=>guideLayer.appendChild(makeGuide('h',i,pos)));
  updateGuideMeta();
}

function makeGuide(axis,index,pos){
  const el=document.createElement('div');
  el.className=`guide ${axis==='v'?'vertical':'horizontal'}`;
  if(selectedGuide && selectedGuide.axis===axis && selectedGuide.index===index) el.classList.add('active');
  if(axis==='v') el.style.left=`${pos*100}%`; else el.style.top=`${pos*100}%`;
  el.dataset.axis=axis; el.dataset.index=index;
  el.addEventListener('pointerdown', startDrag);
  el.addEventListener('click',()=>{selectedGuide={axis,index}; buildGuideSelect(); renderGuides();});
  return el;
}

function startDrag(e){
  e.preventDefault();
  const axis=e.currentTarget.dataset.axis;
  const index=Number(e.currentTarget.dataset.index);
  selectedGuide={axis,index};
  buildGuideSelect();
  const move=(ev)=>{
    const r=guideLayer.getBoundingClientRect();
    let p=axis==='v' ? (ev.clientX-r.left)/r.width : (ev.clientY-r.top)/r.height;
    const arr=axis==='v'?verticalGuides:horizontalGuides;
    const prev=index===0?0:arr[index-1];
    const next=index===arr.length-1?1:arr[index+1];
    const minGap=(axis==='v'?1/sourceImage.naturalWidth:1/sourceImage.naturalHeight);
    arr[index]=clamp(p,prev+minGap,next-minGap);
    renderGuides(); clearResults();
  };
  const up=()=>{window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up);};
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up);
}

function buildGuideSelect(){
  guideSelect.innerHTML='';
  verticalGuides.forEach((_,i)=>addOption('v',i,`세로선 ${i+1}`));
  horizontalGuides.forEach((_,i)=>addOption('h',i,`가로선 ${i+1}`));
  if(!guideSelect.options.length){
    const o=document.createElement('option'); o.textContent='분할선 없음'; o.value=''; guideSelect.appendChild(o); selectedGuide=null;
  }
  if(selectedGuide) guideSelect.value=`${selectedGuide.axis}:${selectedGuide.index}`;
  updateGuideMeta();
}
function addOption(axis,index,label){const o=document.createElement('option');o.value=`${axis}:${index}`;o.textContent=label;guideSelect.appendChild(o);}
guideSelect.addEventListener('change',()=>{if(!guideSelect.value)return;const [axis,index]=guideSelect.value.split(':');selectedGuide={axis,index:Number(index)};renderGuides();});

function updateGuideMeta(){
  if(!selectedGuide || !sourceImage){guidePositionMeta.textContent='';return;}
  const arr=selectedGuide.axis==='v'?verticalGuides:horizontalGuides;
  const p=arr[selectedGuide.index];
  const px=Math.round(p*(selectedGuide.axis==='v'?sourceImage.naturalWidth:sourceImage.naturalHeight));
  guidePositionMeta.textContent=`현재 위치: ${px}px (${(p*100).toFixed(2)}%)`;
}

function nudge(dx,dy){
  if(!selectedGuide || !sourceImage) return;
  const axis=selectedGuide.axis, index=selectedGuide.index;
  const arr=axis==='v'?verticalGuides:horizontalGuides;
  const dim=axis==='v'?sourceImage.naturalWidth:sourceImage.naturalHeight;
  const delta=(axis==='v'?dx:dy)/dim;
  if(!delta) return;
  const prev=index===0?0:arr[index-1]; const next=index===arr.length-1?1:arr[index+1];
  const minGap=1/dim;
  arr[index]=clamp(arr[index]+delta,prev+minGap,next-minGap);
  renderGuides(); clearResults();
}
nudgeLeftBtn.onclick=()=>nudge(-1,0); nudgeRightBtn.onclick=()=>nudge(1,0); nudgeUpBtn.onclick=()=>nudge(0,-1); nudgeDownBtn.onclick=()=>nudge(0,1);

colsSelect.addEventListener('change',resetGuides); rowsSelect.addEventListener('change',resetGuides); resetGuidesBtn.addEventListener('click',resetGuides);
window.addEventListener('resize',()=>{if(sourceImage){drawPreview();}});

function boundaries(guides){return [0,...guides,1];}
function canvasToBlob(canvas,type,quality=.96){return new Promise(resolve=>canvas.toBlob(resolve,type,quality));}

async function makeSplitResults(){
  if(!sourceImage) return;
  const trim=Math.max(0,Number(trimInput.value)||0);
  const xs=boundaries(verticalGuides).map(p=>Math.round(p*sourceImage.naturalWidth));
  const ys=boundaries(horizontalGuides).map(p=>Math.round(p*sourceImage.naturalHeight));
  const rows=ys.length-1, cols=xs.length-1;
  const type=mimeType();
  const results=[];
  let idx=1;
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const sx=xs[c]+trim, sy=ys[r]+trim;
      const sw=Math.max(1,(xs[c+1]-xs[c])-trim*2);
      const sh=Math.max(1,(ys[r+1]-ys[r])-trim*2);
      const canvas=document.createElement('canvas'); canvas.width=sw; canvas.height=sh;
      canvas.getContext('2d').drawImage(sourceImage,sx,sy,sw,sh,0,0,sw,sh);
      const blob=await canvasToBlob(canvas,type);
      const name=`scene_${String(idx).padStart(2,'0')}.${formatExt()}`;
      results.push({name,blob,width:sw,height:sh,url:URL.createObjectURL(blob)});
      idx++;
    }
  }
  splitResults.forEach(x=>URL.revokeObjectURL(x.url));
  splitResults=results;
  renderResults(cols,rows);
}

function renderResults(cols,rows){
  resultGrid.innerHTML='';
  splitResults.forEach((item,i)=>{
    const card=document.createElement('article'); card.className='result-card';
    const img=document.createElement('img'); img.src=item.url; img.alt=item.name;
    const actions=document.createElement('div'); actions.className='result-actions';
    const label=document.createElement('strong'); label.textContent=`${item.name} · ${item.width}×${item.height}`;
    const btn=document.createElement('button'); btn.textContent='저장'; btn.onclick=()=>downloadBlob(item.blob,item.name);
    actions.append(label,btn); card.append(img,actions); resultGrid.appendChild(card);
  });
  resultMeta.textContent=`${cols}×${rows} · 총 ${splitResults.length}장`;
  resultsSection.classList.remove('hidden');
  resultsSection.scrollIntoView({behavior:'smooth',block:'start'});
}

function downloadBlob(blob,name){
  const a=document.createElement('a'); const url=URL.createObjectURL(blob); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

splitBtn.addEventListener('click',makeSplitResults);
downloadZipBtn.addEventListener('click',async()=>{
  if(!splitResults.length) return;
  const zip=new JSZip(); splitResults.forEach(x=>zip.file(x.name,x.blob));
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
  downloadBlob(blob,`${sourceName}_split.zip`);
});
