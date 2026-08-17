# AI 학습 집중도 분석 시스템
웹캠 기반 시선 추적 및 졸음 감지 — MediaPipe Face Landmarker
## 기능
- MediaPipe Face Landmarker 실시간 얼굴 랜드마크
- 양안 홍채(468, 473) 추적 및 Canvas 시각화
- 상대적 홍채 위치 기반 시선 방향 분석
- 3초 Calibration (개인별 시선 기준점)
- EAR 기반 졸음 감지 (2초 이상 지속)
- Chart.js 실시간 그래프 (최대 5분)
- CSV 결과 다운로드
## 실행 방법
로컬에서 테스트 (ES Module + 카메라 권한 필요):
```bash
npx serve .
```
브라우저에서 `http://localhost:3000` 접속
> `file://`로 직접 열면 ES Module/CORS 문제가 발생할 수 있습니다.
## Cloudflare Pages 배포
- Build command: (없음)
- Build output directory: `/`
- GitHub 저장소 연결 후 자동 배포
## 연구 원칙
- 집중도 계산에 **얼굴 위치/머리 방향을 사용하지 않음**
- **양쪽 눈** 홍채 상대 위치로 시선 추정
- DROWSY는 EAR + 지속 시간으로 판단 (랜덤/점수 기반 아님)
