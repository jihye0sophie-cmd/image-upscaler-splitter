# AI 이미지 업스케일 · 분할

GitHub Pages에서 바로 실행할 수 있는 브라우저 기반 이미지 도구입니다.

## 주요 기능
- Real-ESRGAN 4× AI 고화질 업스케일
- 일러스트/애니메이션 모델, 사진/범용 모델 선택
- WebGPU 우선, 미지원 환경은 WASM(CPU) 자동 전환
- 큰 이미지 타일 처리 + 겹침(Overlap)
- 2×2 / 4×4 이미지 분할
- scene_01.png ~ scene_16.png 자동 파일명
- 개별 PNG 저장
- 전체 ZIP 저장
- 가장자리 여백 제거(px)
- 이미지 처리는 브라우저 로컬에서 수행

## GitHub Pages 배포
1. 새 GitHub 저장소를 만듭니다.
2. 이 폴더의 `index.html`, `style.css`, `app.js`를 저장소 루트에 업로드합니다.
3. GitHub 저장소의 **Settings → Pages**로 이동합니다.
4. **Build and deployment → Source**에서 `Deploy from a branch`를 선택합니다.
5. Branch를 `main`, 폴더를 `/(root)`로 지정하고 Save 합니다.
6. 잠시 후 표시되는 Pages 주소로 접속합니다.

## 권장 설정
- iPhone/iPad: 타일 64 또는 96
- PC Chrome/Edge: 타일 96~160
- 경계선이 보이면 Overlap을 16px로 올려보세요.

## 모델
- 일러스트/애니메이션: RealESRGAN_x4plus_anime_6B (ONNX)
- 사진/범용: realesr-general-x4v3 (ONNX)

모델은 실행 시 Hugging Face에서 다운로드됩니다. 모델 라이선스/저작권은 각 원본 모델 저장소를 따릅니다.

## 주의
- iOS Safari는 현재 ONNX Runtime Web에서 WebGPU가 지원되지 않아 WASM(CPU)으로 실행됩니다. 따라서 4× 업스케일은 PC보다 느릴 수 있습니다.
- 아주 큰 원본 이미지는 4× 출력 시 메모리 사용량이 크게 증가합니다. 오류가 나면 타일 크기를 낮추거나 PC에서 처리하세요.
