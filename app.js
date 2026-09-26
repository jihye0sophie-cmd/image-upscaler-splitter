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

    // 중요: 숨겨진 상태에서는 previewStage의 실제 크기를 구할 수 없습니다.
    // 먼저 작업 영역을 표시한 뒤 브라우저 레이아웃이 끝난 다음 캔버스와 분할선을 그립니다.
    fileMeta.textContent = `${file.name} · ${img.naturalWidth}×${img.naturalHeight}px`;
    fileMeta.classList.remove('hidden');
    workspace.classList.remove('hidden');
    resultsSection.classList.add('hidden');

    // 기본 설정(예: 4×4)을 사용자가 한 번도 건드리지 않았더라도
    // 업로드 순간 분할선 데이터부터 먼저 준비합니다.
    seedGuidesFromSettings();

    // 작업 영역을 먼저 노출한 뒤 실제 레이아웃이 잡히는 시점에
    // 캔버스와 분할선을 함께 그립니다. 레이아웃 계산이 늦는 환경은
    // 짧게 재시도해서, 설정을 변경해야만 선이 나타나는 문제를 막습니다.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        drawPreview();
        ensureGuidesVisible();
        previewStage.scrollIntoView({behavior:'auto', block:'nearest'});
      });
    });

    URL.revokeObjectURL(url);
  };
  img.src = url;
}

fileInput.addEventListener('change', e => loadFile(e.target.files[0]));
['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, e => {e.preventDefault(); dropzone.classList.add('drag');}));
['dragleave','drop'].forEach(evt => dropzone.addEventListener(evt, e => {e.preventDefault(); dropzone.classList.remove('drag');}));
dropzone.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));


function seedGuidesFromSettings(){
  const cols = Number(colsSelect.value) || 1;
  const rows = Number(rowsSelect.value) || 1;
  verticalGuides = Array.from({length:Math.max(0,cols-1)},(_,i)=>(i+1)/cols);
  horizontalGuides = Array.from({length:Math.max(0,rows-1)},(_,i)=>(i+1)/rows);
  selectedGuide = verticalGuides.length ? {axis:'v',index:0} : (horizontalGuides.length ? {axis:'h',index:0}:null);
}

function ensureGuidesVisible(attempt=0){
  if(!sourceImage) return;
  const canvasRect = previewCanvas.getBoundingClientRect();
  const stageRect = previewStage.getBoundingClientRect();

  if(canvasRect.width > 0 && canvasRect.height > 0 && stageRect.width > 0){
    alignGuideLayer();
    renderGuides();
    buildGuideSelect();
    return;
  }

  // 모바일/느린 렌더링 환경에서 레이아웃이 아직 0px이면 다음 프레임에 재시도
  if(attempt < 12){
    requestAnimationFrame(() => ensureGuidesVisible(attempt+1));
  }
}

function drawPreview(){
  if(!sourceImage) return;

  // 현재 화면에 실제로 표시된 previewStage 너비를 기준으로 계산합니다.
  const stageWidth = previewStage.getBoundingClientRect().width;
  const maxW = Math.min(900, Math.max(1, stageWidth));
  const maxH = Math.min(window.innerHeight * .68, 760);
  const s = Math.min(maxW/sourceImage.naturalWidth, maxH/sourceImage.naturalHeight, 1);

  previewCanvas.width = Math.max(1, Math.round(sourceImage.naturalWidth*s));
  previewCanvas.height = Math.max(1, Math.round(sourceImage.naturalHeight*s));
  const ctx = previewCanvas.getContext('2d');
  ctx.clearRect(0,0,previewCanvas.width,previewCanvas.height);
  ctx.drawImage(sourceImage,0,0,previewCanvas.width,previewCanvas.height);

  // 캔버스 크기가 DOM에 반영된 다음 분할선 레이어를 정확히 맞춥니다.
  requestAnimationFrame(() => {
    ensureGuidesVisible();
  });
}

function alignGuideLayer(){
  if(!sourceImage || workspace.classList.contains('hidden')) return;
  const stageRect = previewStage.getBoundingClientRect();
  const canvasRect = previewCanvas.getBoundingClientRect();
  if(canvasRect.width <= 0 || canvasRect.height <= 0) return;

  guideLayer.style.left = `${canvasRect.left-stageRect.left}px`;
  guideLayer.style.top = `${canvasRect.top-stageRect.top}px`;
  guideLayer.style.width = `${canvasRect.width}px`;
  guideLayer.style.height = `${canvasRect.height}px`;
  guideLayer.style.right = 'auto';
  guideLayer.style.bottom = 'auto';
  guideLayer.classList.add('ready');
}

function resetGuides(){
  seedGuidesFromSettings();
  ensureGuidesVisible();
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

let resizeFrame = 0;
function refreshPreviewLayout(){
  if(!sourceImage) return;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    drawPreview();
    requestAnimationFrame(() => ensureGuidesVisible());
  });
}
window.addEventListener('resize', refreshPreviewLayout);

// 패널 너비가 바뀌는 경우에도 분할선을 즉시 캔버스 위에 다시 맞춥니다.
if('ResizeObserver' in window){
  const previewObserver = new ResizeObserver(() => {
    if(sourceImage) refreshPreviewLayout();
  });
  previewObserver.observe(previewStage);
}

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
  resultGrid.style.setProperty('--result-cols', cols);
  splitResults.forEach((item,i)=>{
    const card=document.createElement('article'); card.className='result-card';
    const img=document.createElement('img'); img.src=item.url; img.alt=item.name;
    const actions=document.createElement('div'); actions.className='result-actions';
    const label=document.createElement('strong'); label.textContent=item.name;
    const dimensions=document.createElement('div'); dimensions.className='result-dimensions'; dimensions.textContent=`${item.width}×${item.height}px`;
    const btn=document.createElement('button'); btn.textContent='저장'; btn.onclick=()=>openSaveSheet(item);
    actions.append(label,dimensions,btn); card.append(img,actions); resultGrid.appendChild(card);
  });
  resultMeta.textContent=`${cols}×${rows} · 총 ${splitResults.length}장`;
  resultsSection.classList.remove('hidden');
  resultsSection.scrollIntoView({behavior:'smooth',block:'start'});
}

function downloadBlob(blob,name){
  const a=document.createElement('a'); const url=URL.createObjectURL(blob); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function closeSaveSheet(){
  const old=document.querySelector('.save-sheet-backdrop');
  if(old) old.remove();
}

function openSaveSheet(item){
  closeSaveSheet();
  const backdrop=document.createElement('div'); backdrop.className='save-sheet-backdrop';
  const sheet=document.createElement('div'); sheet.className='save-sheet'; sheet.setAttribute('role','dialog'); sheet.setAttribute('aria-modal','true');
  const title=document.createElement('h3'); title.textContent='저장 위치 선택';
  const fileName=document.createElement('p'); fileName.className='save-file-name'; fileName.textContent=item.name;
  const actions=document.createElement('div'); actions.className='save-sheet-actions';

  const fileBtn=document.createElement('button'); fileBtn.className='accent'; fileBtn.textContent='파일로 저장';
  fileBtn.onclick=async()=>{ closeSaveSheet(); await saveFileWithPicker(item.blob,item.name); };

  const albumBtn=document.createElement('button'); albumBtn.className='secondary'; albumBtn.textContent='앨범에 저장';
  albumBtn.onclick=async()=>{ closeSaveSheet(); await saveToAlbum(item.blob,item.name); };

  const cancelBtn=document.createElement('button'); cancelBtn.className='cancel'; cancelBtn.textContent='취소'; cancelBtn.onclick=closeSaveSheet;
  const note=document.createElement('p'); note.className='save-sheet-note';
  note.textContent='앨범 저장은 모바일의 공유 메뉴를 열어 “이미지 저장/사진에 저장”을 선택하는 방식입니다.';

  actions.append(fileBtn,albumBtn,cancelBtn); sheet.append(title,fileName,actions,note); backdrop.appendChild(sheet); document.body.appendChild(backdrop);
  backdrop.addEventListener('click',e=>{ if(e.target===backdrop) closeSaveSheet(); });
}

async function saveFileWithPicker(blob,name){
  if('showSaveFilePicker' in window){
    try{
      const ext=name.split('.').pop().toLowerCase();
      const mime=blob.type || mimeType();
      const handle=await window.showSaveFilePicker({suggestedName:name,types:[{description:'이미지 파일',accept:{[mime]:[`.${ext}`]}}]});
      const writable=await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }catch(err){
      if(err && err.name==='AbortError') return;
      console.warn('파일 저장 선택기를 사용할 수 없어 기본 다운로드로 전환합니다.',err);
    }
  }
  // iOS/Safari 등 File System Access API 미지원 환경은 브라우저 다운로드/파일 앱 저장 흐름 사용
  downloadBlob(blob,name);
}

async function saveToAlbum(blob,name){
  const file=new File([blob],name,{type:blob.type || mimeType()});
  if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
    try{
      await navigator.share({files:[file],title:name});
      return;
    }catch(err){
      if(err && err.name==='AbortError') return;
      console.warn('공유 메뉴를 열 수 없습니다.',err);
    }
  }
  // 웹페이지는 브라우저 보안상 사진 앨범에 직접 쓰기 권한이 없습니다.
  // 공유 API가 없는 환경에서는 새 탭으로 이미지를 열어 사용자가 직접 저장할 수 있게 합니다.
  const url=URL.createObjectURL(blob);
  const win=window.open(url,'_blank','noopener,noreferrer');
  if(!win) downloadBlob(blob,name);
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  alert('이 브라우저는 앨범 직접 저장을 지원하지 않습니다. 열린 이미지에서 기기의 “이미지 저장/사진에 저장” 기능을 사용해주세요.');
}

splitBtn.addEventListener('click',makeSplitResults);
downloadZipBtn.addEventListener('click',async()=>{
  if(!splitResults.length) return;
  const zip=new JSZip(); splitResults.forEach(x=>zip.file(x.name,x.blob));
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
  const zipName=`${sourceName}_split.zip`;
  if('showSaveFilePicker' in window){
    try{
      const handle=await window.showSaveFilePicker({suggestedName:zipName,types:[{description:'ZIP 파일',accept:{'application/zip':['.zip']}}]});
      const writable=await handle.createWritable(); await writable.write(blob); await writable.close(); return;
    }catch(err){ if(err && err.name==='AbortError') return; }
  }
  downloadBlob(blob,zipName);
});
