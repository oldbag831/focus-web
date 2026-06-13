import {
    FaceLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.getElementById("video");
const scoreText = document.getElementById("score");
const statusText = document.getElementById("status");
const gaugeFill = document.getElementById("gaugeFill");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const downloadBtn = document.getElementById("downloadBtn");
const drowsyAlert = document.getElementById("drowsyAlert");

let stream = null;
let faceLandmarker;
let isAnalyzing = false; // 분석 중복 실행을 방지하기 위한 플래그
let focusData = [];
let lastChartUpdateTime = 0; // 차트 업데이트 주기 조절용 변수

/* =========================
   카메라 시작
========================= */
async function startCamera() {
    // 이미 분석 중이면 중복 실행 방지
    if (isAnalyzing) return;

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: true
        });

        video.srcObject = stream;
        statusText.textContent = "ANALYZING";
        isAnalyzing = true;

        // 프레임 분석 시작
        analyzeFrame();

    } catch (error) {
        alert("카메라 접근이 거부되었습니다.");
        console.error(error);
    }
}

startBtn.addEventListener("click", startCamera);

/* =========================
   차트 설정
========================= */
const ctx = document.getElementById("focusChart");
const chart = new Chart(ctx, {
    type: "line",
    data: {
        labels: [],
        datasets: [{
            label: "Focus Score",
            data: [],
            borderColor: "#3b82f6",
            tension: 0.1
        }]
    },
    options: {
        responsive: true,
        scales: {
            y: {
                min: 0,
                max: 100
            }
        }
    }
});

function updateChart(score) {
    chart.data.labels.push(new Date().toLocaleTimeString());
    chart.data.datasets[0].data.push(score);

    if (chart.data.labels.length > 30) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
    }

    chart.update();
}

/* =========================
   CSV 다운로드
========================= */
downloadBtn.addEventListener("click", () => {
    if (focusData.length === 0) {
        alert("저장된 분석 데이터가 없습니다.");
        return;
    }

    let csv = "timestamp,focus_score,status\n";
    focusData.forEach(row => {
        csv += `${row.timestamp},${row.score},${row.status}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "focus_data.csv";
    link.click();
});

/* =========================
   분석 중지
========================= */
stopBtn.addEventListener("click", stopAnalysis);

function stopAnalysis() {
    isAnalyzing = false;

    // 카메라 종료
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    video.srcObject = null;
    drowsyAlert.classList.add("hidden");

    // UI 초기화
    statusText.textContent = "STOPPED";
    scoreText.textContent = "0";
    gaugeFill.style.width = "0%";
}

/* =========================
   FaceLandmarker 생성 함수 (홍채 옵션 추가 필수!)
========================= */
async function createFaceLandmarker() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(
        vision,
        {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
            },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false,
            outputIrisLandmarks: true // ★ 핵심: 홍채 랜드마크 활성화 옵션 추가!
        }
    );
    console.log("MediaPipe FaceLandmarker 로드 완료");
}

/* =========================
   랜드마크 분석 함수
========================= */
async function analyzeFrame() {
    if (!isAnalyzing) return; // 분석 중지 상태면 루프 종료

    if (!faceLandmarker || !video.videoWidth) {
        requestAnimationFrame(analyzeFrame);
        return;
    }

    const results = faceLandmarker.detectForVideo(video, performance.now());

    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        calculateFocus(landmarks);
    }

    requestAnimationFrame(analyzeFrame);
}

/* =========================
   홍채 좌표 추출 및 비율 계산
========================= */
function calculateFocus(landmarks) {
    // 468, 473번은 outputIrisLandmarks: true 일 때만 존재합니다.
    const leftIris = landmarks[468];      
    const leftEyeLeft = landmarks[33];    
    const leftEyeRight = landmarks[133];  

    const rightIris = landmarks[473];     
    const rightEyeLeft = landmarks[362];   
    const rightEyeRight = landmarks[263]; 

    // 눈 구석 대비 홍채 위치 비율 계산 (0.0 ~ 1.0)
    const leftRatio = (leftIris.x - leftEyeLeft.x) / (leftEyeRight.x - leftEyeLeft.x);
    const rightRatio = (rightIris.x - rightEyeLeft.x) / (rightEyeRight.x - rightEyeLeft.x);

    const gaze = (leftRatio + rightRatio) / 2;

    // 질문하신 '홍채 좌표 출력'을 콘솔창(F12)에서 실시간으로 확인할 수 있도록 로그 추가
    console.log(`실시간 홍채 비율(Gaze): ${gaze.toFixed(4)}`);

    updateFocus(gaze);
}

/* =========================
   집중도 계산 및 시각화 업데이트
========================= */
function updateFocus(gaze) {
    let score;
    let status;

    // 판정 범위를 모니터 시선 이동에 맞게 0.46 ~ 0.54로 세분화 및 감도 상향
    if (gaze > 0.46 && gaze < 0.54) {
        score = 100;
        status = "HIGH FOCUS";
        gaugeFill.style.background = "green";
    } else if (gaze > 0.41 && gaze < 0.59) {
        score = 70;
        status = "MEDIUM FOCUS";
        gaugeFill.style.background = "orange";
    } else {
        score = 30;
        status = "LOW FOCUS";
        gaugeFill.style.background = "red";
    }

    // 실시간 UI 텍스트 및 게이지바 연동
    scoreText.textContent = score;
    statusText.textContent = status;
    gaugeFill.style.width = score + "%";

    // DROWSY(졸음 및 시선 이탈) 경고 활성화 조절 (점수가 30점일 때 알림 활성화)
    if (score <= 30) {
        drowsyAlert.classList.remove("hidden");
    } else {
        drowsyAlert.classList.add("hidden");
    }

    // 데이터 저장과 차트 업데이트는 초당 1번만 실행 (성능 과부하 방지)
    const now = Date.now();
    if (now - lastChartUpdateTime > 1000) {
        focusData.push({
            timestamp: new Date().toLocaleTimeString(),
            score: score,
            status: status
        });
        updateChart(score);
        lastChartUpdateTime = now;
    }
}

/* =========================
   페이지 로드시 모델 준비
========================= */
createFaceLandmarker();
